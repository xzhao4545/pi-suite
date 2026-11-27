import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../runtime/binding.ts';
import type { Notifications, NotificationView } from '../runtime/notifications.ts';
import type { StatusPublisher } from '../ui/status.ts';
import { PresentationTicker } from '../ui/ticker.ts';
import type { DockRow } from '../ui/dock.ts';
import type { DisplayField, DisplayText } from '../ui/browser-chrome.ts';
import { countText, elapsedText } from '../ui/format.ts';
import type { Settlement, Waitable } from '../runtime/wait.ts';
import { sanitizeText } from '../runtime/text.ts';
import { boundedText } from '../runtime/read.ts';
import { active, executing, type AgentRecord, type Execution, type ParentScope } from './types.ts';
import { AGENT_ENTRY, recordsIn } from './records.ts';
import { groupAgentRuns } from './run-groups.ts';
import { retrySuffix } from './retry.ts';
import { questionNotification, questionText } from './questions.ts';
import { agentRuntime } from './runtime.ts';
import type { AgentManager } from './manager.ts';
import { customRendererLookup, toolRenderer } from '../runtime/tools.ts';
import { ToolError } from '../runtime/errors.ts';
import type { TasksModule } from '../tasks/index.ts';

export function summaryLine(record: AgentRecord): string {
  return `${record.id} ${record.state} · ${boundedText(sanitizeText(record.name).replace(/[\r\n\t]/g, ' '), 200)} · ${record.runId}${record.elapsedMs === undefined ? '' : ` · ${(record.elapsedMs / 1000).toFixed(1)}s`}`;
}
export function agentSummary(record: AgentRecord) {
  const { prompt, result, ...summary } = record;
  return { ...summary, promptSummary: boundedText(prompt, 200), resultSummary: result === undefined ? undefined : boundedText(result, 500) };
}
export function usageText(record: AgentRecord): string | undefined {
  const usage = record.usage;
  return usage && `usage: input ${usage.tokens.input} · output ${usage.tokens.output} · cacheRead ${usage.tokens.cacheRead} · cacheWrite ${usage.tokens.cacheWrite} · total ${usage.tokens.total} · cost $${usage.cost.toFixed(6)}`;
}
function resultLines(record: AgentRecord, error = record.error): string[] {
  return [record.error ? usageText(record) : undefined, record.error ? `error: ${error}` : undefined,
    record.result === undefined ? undefined : boundedText(record.result, 2048),
    record.result && Buffer.byteLength(record.result) > 2048 ? `full: agent_read({"id":"${record.id}","runId":"${record.runId}","stream":"result","offset":0})` : undefined].filter(value => value !== undefined);
}
function resultSummary(record: AgentRecord): string { return [summaryLine(record), ...resultLines(record)].join('\n'); }
function providerErrorMessage(error: string): string {
  // Provider errors may be plain text or a JSON envelope prefixed with the HTTP status.
  const json = error.trim().replace(/^\d{3}\s+/, '');
  if (!json.startsWith('{')) return error;
  try {
    const message = JSON.parse(json)?.error?.message;
    return typeof message === 'string' ? message : error;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    return error; // Not a complete provider envelope; show the original diagnostic.
  }
}
function resultView(record: AgentRecord): NotificationView {
  const { id, state, name, runId, elapsedMs, error } = record;
  return { title: 'Agent result', state, meta: [id, runId, ...elapsedMs === undefined ? [] : [`${(elapsedMs / 1000).toFixed(1)}s`], boundedText(name, 200)],
    body: resultLines(record, error && providerErrorMessage(error)).join('\n') };
}
export class AgentsModule implements Waitable {
  readonly prefix = 'agent_';
  readonly manager: AgentManager;
  /** Set when the process owner comes from an earlier module load and is still busy. */
  readonly stale?: string;
  private warned = false;
  private unsubscribe?: () => void;
  private readonly ticker = new PresentationTicker(() => this.status.detailsVisible('agents'), () => {
    const scope = this.scope(this.binding.current!.ctx);
    this.publishActivities(this.manager.records().filter(record => this.manager.visible(record, scope)), scope);
  });
  private queued = new Set<string>();
  private saved = new Map<string, string>();
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications,
    private status: StatusPublisher, private tasks?: TasksModule, private parentRun?: Execution, manager?: AgentManager) {
    if (manager) this.manager = manager;
    else ({ owner: this.manager, stale: this.stale } = agentRuntime());
  }
  /** A busy manager from before reload can finish runs but cannot start new ones. */
  admit(): AgentManager {
    if (this.stale) throw new ToolError('RUNTIME_UNAVAILABLE', this.stale);
    return this.manager;
  }
  /** Steering or answering a live run stays available; resuming a settled one would start a new run. */
  admitSend(id: string): AgentManager {
    if (this.stale) {
      const { record, run } = this.manager.get(id);
      if (!run || !active(record.state)) return this.admit();
    }
    return this.manager;
  }
  /** Collected runs have no child runner; their transcript uses the Suite registry. */
  renderer(name: string) { return toolRenderer(this.pi, name); }
  customRendererLookup() { return customRendererLookup(this.pi); }
  scope(ctx: ExtensionContext): ParentScope { return { ctx, run: this.parentRun, taskStore: this.tasks?.scope(ctx) ?? this.parentRun?.parent.taskStore }; }
  visibleRunIds(ctx: ExtensionContext): string[] {
    const scope = this.scope(ctx);
    return this.manager.records().filter(record => this.manager.visible(record, scope)).map(record => record.runId);
  }
  bind(): void {
    this.detach();
    const current = this.binding.current;
    if (!current) return;
    if (this.stale && !this.warned) {
      this.warned = true;
      current.ctx.ui.notify(this.stale, 'warning');
    }
    const records = recordsIn(current.ctx.sessionManager.getBranch());
    this.manager.restore(records);
    for (const record of records) this.saved.set(record.runId, this.revision(record));
    this.unsubscribe = this.manager.subscribe(() => this.refresh()); this.refresh();
  }
  detach(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.ticker.stop();
    const current = this.binding.current;
    if (current) for (const request of this.queued) this.notifications.cancel(current.sessionId, request);
    this.queued.clear(); this.saved.clear(); this.status.setActivities('agents', []);
  }
  private rows(records: AgentRecord[], scope: ParentScope): { rows: DockRow[]; aside: DisplayText; ticking: boolean } {
    // A consumed question is still awaiting its answer. Include workflow questions
    // visible to this parent without exposing unrelated runs or nested descendants.
    const visible = new Map(records.map(record => [record.runId, record]));
    for (const run of this.manager.runs.values()) if (run.question && this.manager.questionVisible(run.record, scope)) {
      visible.set(run.record.runId, this.manager.view(run));
    }
    // Pick representatives before filtering; an unread older failure may still notify,
    // but must not keep a row after the latest run has superseded it.
    const latest = Array.from(groupAgentRuns(visible.values()).values(), ([record]) => record);
    const counts = new Map<string, number>();
    const rows = latest.flatMap<DockRow>(record => {
      const run = this.manager.runs.get(record.runId), question = Boolean(run?.question);
      const failed = ['failed', 'limited'].includes(record.state) && run && !run.consumed;
      if (!active(record.state) && !failed) return [];
      const state = question ? 'waiting(parent)' : record.state;
      counts.set(state, (counts.get(state) ?? 0) + 1);
      const retry = retrySuffix(run);
      const status: DisplayField[] = [{text: state, state}, ...retry ? [{text: retry, tone: 'dim' as const}] : []];
      const basic: DisplayField[] = [...status, {text: ` · ${elapsedText(record.elapsedMs ?? 0)}`, tone: 'dim'}];
      const tools = `${record.toolUses ?? 0} tools`;
      const model = record.model.slice(record.model.indexOf('/') + 1);
      return [{ id: `agent:${record.runId}`, text: `${sanitizeText(record.name).replace(/[\r\n\t]/g, ' ')} (${sanitizeText(model)})`,
        suffix: [...basic, {text: ` · ↑${countText(record.usage?.tokens.input ?? 0)} ↓${countText(record.usage?.tokens.output ?? 0)} · ${tools}`, tone: 'dim'}],
        compactSuffixes: [[...basic, {text: ` · ${tools}`, tone: 'dim'}], basic, status],
        priority: question ? 100 : failed ? 80 : record.state === 'stopping' ? 75 : record.state === 'queued' ? 15 : 25 }];
    });
    const aside: DisplayField[] = ['starting', 'running', 'waiting', 'waiting(parent)', 'stopping', 'queued', 'failed', 'limited']
      .filter(state => counts.has(state)).flatMap((state, index) => [
        ...index ? [{text: ' · ', tone: 'dim' as const}] : [], {text: `${counts.get(state)} ${state}`, state},
      ]);
    return {rows, aside, ticking: latest.some(record => active(record.state))};
  }
  private publishActivities(records: AgentRecord[], scope: ParentScope): void {
    const {rows, aside, ticking} = this.rows(records, scope);
    this.status.setActivities('agents', records.filter(record => executing(record.state)).map(record => record.id), rows, aside);
    this.ticker.update(ticking);
  }
  private revision(record: AgentRecord): string { return `${record.state}:${record.background}:${record.sessionFile ?? ''}:${record.endedAt ?? ''}:${record.model}:${record.thinking}:${JSON.stringify(record.individual)}`; }
  private refresh(): void {
    const current = this.binding.current;
    if (!current) return;
    const scope = this.scope(current.ctx), records = this.manager.records().filter(record => this.manager.visible(record, scope));
    this.publishActivities(records, scope);
    const unread = this.unreadNotices();
    for (const request of this.queued) if (!unread.some(({ item }) => this.request(item) === request)) {
      this.notifications.cancel(current.sessionId, request); this.queued.delete(request);
    }
    for (const record of records) {
      // Only structural state changes become entries; token deltas and timers never grow the parent log.
      const revision = this.revision(record);
      if (this.saved.get(record.runId) !== revision) {
        // Pi emits a synchronous session-entry event. Publish the revision first so a parent
        // child subscriber cannot re-enter and append the same record indefinitely.
        this.saved.set(record.runId, revision); this.pi.appendEntry(AGENT_ENTRY, record);
      }
    }
    for (const { item, view } of unread) {
      const request = this.request(item);
      if (this.queued.has(request)) continue;
      this.queued.add(request);
      this.notifications.enqueue(current.sessionId, request, item.summary, () => { this.queued.delete(request); this.consume(item); }, 'event', view());
    }
  }
  // Include the run ID so consuming one result cannot cancel another run's notification.
  private request(item: Settlement): string { return `agent:${item.id}:${item.runId}${item.question ? ':ask' : ':result'}`; }
  settlement(id: string): Settlement {
    const { record, run } = this.manager.get(id);
    const question = run?.question && !run.question.seen;
    return { id, runId: record.runId, state: record.state, settled: !active(record.state), question: Boolean(question),
      summary: question ? questionText(run!) : active(record.state) ? summaryLine(record) : resultSummary(record) };
  }
  unread(): Settlement[] { return this.unreadNotices().map(({ item }) => item); }
  private unreadNotices(): { item: Settlement; view: () => NotificationView }[] {
    const current = this.binding.current;
    if (!current) return [];
    const scope = this.scope(current.ctx);
    return [...this.manager.runs.values()].filter(run => run.question && !run.question.seen && this.manager.questionVisible(run.record, scope)
      || this.manager.visible(run.record, scope) && run.settled && !run.consumed && (run.record.background || run.notifyResult)).map(run => {
        const record = this.manager.view(run);
        const question = run.question && !run.question.seen ? questionNotification(run) : undefined;
        const item: Settlement = { id: record.id, runId: record.runId, state: record.state, settled: !active(record.state),
          question: Boolean(question), summary: question?.text ?? `Agent result: ${resultSummary(record)}` };
        return { item, view: () => question?.view ?? resultView(record) };
      });
  }
  subscribe(listener: () => void): () => void { return this.manager.subscribe(listener); }
  consume(item: Settlement): void {
    const { run } = this.manager.get(item.id, item.runId);
    if (run) { if (item.question && run.question) run.question.seen = true; else if (item.settled) run.consumed = true; }
    const current = this.binding.current, request = this.request(item);
    if (current) this.notifications.cancel(current.sessionId, request);
    this.queued.delete(request);
    this.refresh();
  }
}
