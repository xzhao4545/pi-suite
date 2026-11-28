import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI, ExtensionContext, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import type { SessionBinding, Binding } from '../binding.ts';
import { projectReplay, replayPayload, resourceMismatch, sha256, type ReplayReferences } from './payload.ts';

export const RECOVERY_ENTRY = 'pi-suite:responses-isolation';
type Isolation = { version: 2; scope: string; ids: string[]; ciphers: string[] };
type IsolationSets = { ids: Set<string>; ciphers: Set<string> };
type Request = ReplayReferences & { generation: number; binding: Binding; scope: string; leaf: string | null; signal?: AbortSignal };
type Failure = { request: Request; entryId: string; error: string };

/** Per-session request projection only; native retries/backoff and their budgets belong to Pi.
 * The append-only branch record stores IDs, cipher hashes and a hashed endpoint scope, never payload/auth.
 */
export class ResponsesRecovery {
  private isolated = new Map<string, IsolationSets>();
  private request?: Request;
  private failure?: Failure;
  private generation = 0;
  constructor(private binding: SessionBinding, private enabled: boolean) {}

  reset(ctx?: ExtensionContext): void {
    this.settled();
    this.isolated.clear(); this.generation++;
    if (!this.enabled || !ctx) return;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== RECOVERY_ENTRY) continue;
      const data = entry.data as Partial<Omit<Isolation, 'version'> & { version: 1 | 2 }> | undefined;
      // A v1 branch only isolated IDs. Don't treat a malformed v2 record as v1
      // or the next request could silently replay ciphertext already isolated.
      const ciphers = data?.version === 1 ? [] : data?.ciphers;
      if (!data || (data.version !== 1 && data.version !== 2) || typeof data.scope !== 'string' ||
          !Array.isArray(data.ids) || data.ids.some(id => typeof id !== 'string') ||
          !Array.isArray(ciphers) || ciphers.some(cipher => typeof cipher !== 'string' || !/^[a-f0-9]{64}$/.test(cipher))) {
        throw new Error('Invalid Responses isolation record');
      }
      this.addIsolation({ version: 2, scope: data.scope, ids: data.ids, ciphers });
    }
  }

  private addIsolation({ scope, ids, ciphers }: Isolation): void {
    const known = this.isolated.get(scope) ?? { ids: new Set<string>(), ciphers: new Set<string>() };
    for (const id of ids) known.ids.add(id);
    for (const cipher of ciphers) known.ciphers.add(cipher);
    this.isolated.set(scope, known);
  }

  beforeRequest(payload: unknown, ctx: ExtensionContext): unknown {
    // A new final payload invalidates the last attempt, not the branch isolation.
    this.settled();
    const active = this.binding.current, model = ctx.model;
    if (!this.enabled || !active || active.ctx.sessionManager !== ctx.sessionManager || model?.api !== 'openai-responses') return;
    const wire = replayPayload(payload, model.id);
    if (!wire) return;
    const scope = sha256(JSON.stringify([model.provider, model.api, model.id, model.baseUrl]));
    const { projected, ids, ciphers } = projectReplay(wire, this.isolated.get(scope));
    // Raw ciphertext is needed for fragment matching, but lives only in the in-flight request state.
    this.request = { generation: ++this.generation, binding: active, scope,
      leaf: ctx.sessionManager.getLeafId(), ids, ciphers, signal: ctx.signal };
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
    if (message.stopReason === 'error' && !message.content.length && message.errorMessage) {
      this.failure = { request, entryId: source.id, error: message.errorMessage };
    }
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const failure = this.failure;
    if (!failure || event.outcome !== 'error' || failure.request.signal?.aborted || !this.binding.isCurrent(failure.request.binding) ||
        failure.request.generation !== this.request?.generation) return;
    const match = resourceMismatch(failure.error, failure.request);
    if (!match) return;
    const source = event.context.contextEntries.find(entry => entry.sourceEntry.id === failure.entryId);
    if (!source) return; // Compaction/another projection removed the source from this boundary.
    const visible = source.messages.length;
    if (!visible && event.continue) return; // A preceding extension already owns this failure.
    const { scope, ids, ciphers } = failure.request;
    const known = this.isolated.get(scope);
    // If the gateway named no target, try all references of that kind rather
    // than guessing which one is stale. A cipher failure alone implicates no IDs.
    const targetIds = match.kind === 'id' ? (match.ids.length ? match.ids : ids) : [];
    const targetCiphers = match.kind === 'cipher' ? (match.ciphers.length ? match.ciphers : ciphers) : [];
    const record: Isolation = { version: 2, scope,
      ids: [...new Set(targetIds)].filter(id => !known?.ids.has(id)),
      ciphers: [...new Set(targetCiphers.map(sha256))].filter(hash => !known?.ciphers.has(hash)),
    };
    // Allow consecutive repairs of the same kind only if each changes the next
    // replay. A repeat after full isolation stops unless new references appeared.
    if (!record.ids.length && !record.ciphers.length) return;
    this.addIsolation(record);
    return { continue: true, entries: [...event.entries,
      { type: 'custom', customType: RECOVERY_ENTRY, data: record },
      ...(visible ? [{ type: 'context_edit' as const, targetId: failure.entryId, replacement: null }] : []),
    ] };
  }

  settled(): void { this.request = undefined; this.failure = undefined; }
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
