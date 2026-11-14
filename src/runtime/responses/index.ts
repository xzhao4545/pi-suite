import { createHash } from 'node:crypto';
import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI, ExtensionContext, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import type { SessionBinding, Binding } from '../binding.ts';
import { isolateIds, replayIds, replayPayload, resourceMismatch } from './payload.ts';

export const RECOVERY_ENTRY = 'pi-suite:responses-isolation';
type Isolation = { version: 1; scope: string; ids: string[] };
type Request = { generation: number; binding: Binding; scope: string; leaf: string | null; ids: string[]; signal?: AbortSignal };
type Failure = { request: Request; entryId: string; error: string };

/** Per-session request projection only; retries/backoff and their budgets belong to Pi.
 * The append-only branch record stores IDs and a hashed endpoint scope, never payload/auth.
 */
export class ResponsesRecovery {
  private isolated = new Map<string, Set<string>>();
  private request?: Request;
  private failure?: Failure;
  private recovering?: { generation: number; scope: string };
  private generation = 0;
  constructor(private binding: SessionBinding, private enabled: boolean) {}

  reset(ctx?: ExtensionContext): void {
    this.request = undefined; this.failure = undefined; this.recovering = undefined;
    this.isolated.clear(); this.generation++;
    if (!this.enabled || !ctx) return;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== RECOVERY_ENTRY) continue;
      const data = entry.data as Partial<Isolation> | undefined;
      if (!data || data.version !== 1 || typeof data.scope !== 'string' || !Array.isArray(data.ids) ||
          data.ids.some(id => typeof id !== 'string')) throw new Error('Invalid Responses isolation record');
      const ids = this.isolated.get(data.scope) ?? new Set<string>();
      for (const id of data.ids) ids.add(id);
      this.isolated.set(data.scope, ids);
    }
  }

  beforeRequest(payload: unknown, ctx: ExtensionContext): unknown {
    // A new final payload invalidates the last attempt, but not the recovery phase:
    // a native 429/5xx retry is still part of the same repair.
    this.request = undefined; this.failure = undefined;
    const active = this.binding.current, model = ctx.model;
    if (!this.enabled || !active || active.ctx.sessionManager !== ctx.sessionManager || model?.api !== 'openai-responses') return;
    const wire = replayPayload(payload, model.id);
    if (!wire) return;
    const scope = createHash('sha256').update(JSON.stringify([model.provider, model.api, model.id, model.baseUrl])).digest('hex');
    if (this.recovering && this.recovering.scope !== scope) this.recovering = undefined;
    const projected = isolateIds(wire, this.isolated.get(scope) ?? new Set());
    this.request = { generation: ++this.generation, binding: active, scope,
      leaf: ctx.sessionManager.getLeafId(), ids: replayIds(projected ?? wire), signal: ctx.signal };
    return projected;
  }

  turnEnd(event: TurnEndEvent, ctx: ExtensionContext): void {
    const request = this.request;
    this.failure = undefined;
    if (!request || !this.binding.isCurrent(request.binding)) return;
    const message = event.message, model = ctx.model;
    if (message.role !== 'assistant' || message.provider !== model?.provider || message.api !== model.api || message.model !== model.id) return;
    // Correlate the persisted source, not just the most recently observed error string.
    const source = ctx.sessionManager.getEntry(event.messageEntryId);
    if (source?.type !== 'message' || source.message !== message &&
        (source.message.role !== 'assistant' || source.message.timestamp !== message.timestamp)) return;
    const branch = ctx.sessionManager.getBranch(), sourceIndex = branch.findIndex(entry => entry.id === source.id);
    const leafIndex = request.leaf === null ? -1 : branch.findIndex(entry => entry.id === request.leaf);
    if (sourceIndex < 0 || request.leaf !== null && leafIndex < 0 || sourceIndex <= leafIndex ||
        branch.slice(leafIndex + 1, sourceIndex).some(entry => entry.type === 'message' && entry.message.role === 'assistant')) return;
    if (message.stopReason === 'error') {
      if (!message.content.length && message.errorMessage) this.failure = { request, entryId: source.id, error: message.errorMessage };
    } else if (message.stopReason !== 'aborted') this.recovering = undefined;
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const failure = this.failure;
    if (!failure || event.outcome !== 'error' || failure.request.signal?.aborted || !this.binding.isCurrent(failure.request.binding) ||
        failure.request.generation !== this.request?.generation || !failure.request.ids.length ||
        !resourceMismatch(failure.error, failure.request.ids)) return;
    // One repair phase may span many native attempts, but never opens a second budget
    // when those attempts finally exhaust. A successful turn permits a later new phase.
    if (this.recovering) return;
    const source = event.context.contextEntries.find(entry => entry.sourceEntry.id === failure.entryId);
    if (!source) return; // Compaction/another projection removed the source from this boundary.
    const visible = source.messages.length;
    if (!visible && event.continue) return; // A preceding extension already owns this failure.
    const { scope, ids, generation } = failure.request;
    const known = this.isolated.get(scope) ?? new Set<string>();
    const fresh = ids.filter(id => !known.has(id));
    if (!fresh.length) return;
    this.recovering = { generation, scope };
    for (const id of fresh) known.add(id);
    this.isolated.set(scope, known);
    return { continue: true, entries: [...event.entries,
      { type: 'custom', customType: RECOVERY_ENTRY, data: { version: 1, scope, ids: fresh } satisfies Isolation },
      ...(visible ? [{ type: 'context_edit' as const, targetId: failure.entryId, replacement: null }] : []),
    ] };
  }

  settled(): void { this.request = undefined; this.failure = undefined; this.recovering = undefined; }
}

/** The caller owns ordering with Goal and notifications at the actionable/final boundaries. */
export function registerResponsesRecovery(pi: ExtensionAPI, binding: SessionBinding, enabled: boolean): ResponsesRecovery {
  const recovery = new ResponsesRecovery(binding, enabled);
  if (enabled) {
    pi.on('before_provider_request', (event, ctx) => recovery.beforeRequest(event.payload, ctx));
    pi.on('turn_end', (event, ctx) => recovery.turnEnd(event, ctx));
  }
  return recovery;
}
