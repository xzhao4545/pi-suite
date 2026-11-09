import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../runtime/binding.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { StatusPublisher } from '../ui/status.ts';
import type { DockRow } from '../ui/dock.ts';
import type { DisplayField, DisplayText } from '../ui/browser-chrome.ts';
import type { Settlement, Waitable } from '../runtime/wait.ts';
import { sanitizeText } from '../runtime/text.ts';
import { boundedText } from '../runtime/read.ts';
import { active, executing, type AgentRecord, type Execution, type ParentScope } from './types.ts';
import { AGENT_ENTRY, recordsIn } from './records.ts';
import { questionText } from './questions.ts';
import { agentRuntime } from './runtime.ts';
import type { AgentManager } from './manager.ts';
import { toolRenderer } from '../runtime/tools.ts';
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
function resultSummary(record: AgentRecord): string {
  return [summaryLine(record), record.error ? usageText(record) : undefined, record.error ? `error: ${record.error}` : undefined,
    record.result === undefined ? undefined : boundedText(record.result, 2048),
    record.result && Buffer.byteLength(record.result) > 2048 ? `full: agent_read({"id":"${record.id}","runId":"${record.runId}","stream":"result","offset":0})` : undefined].filter(value => value !== undefined).join('\n');
}
export class AgentsModule implements Waitable {
  readonly prefix = 'agent_';
  readonly manager: AgentManager;
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private queued = new Set<string>();
  private saved = new Map<string, string>();
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications,
    private status: StatusPublisher, private tasks?: TasksModule, private parentRun?: Execution, manager?: AgentManager) {
    this.manager = manager ?? agentRuntime();
  }
  /** Collected runs have no live renderer map; their transcript uses the same registered display lookup. */
  renderer(name: string) { return toolRenderer(this.pi, name); }
  scope(ctx: ExtensionContext): ParentScope { return { ctx, run: this.parentRun, taskStore: this.tasks?.scope(ctx) ?? this.parentRun?.parent.taskStore }; }
  visibleRunIds(ctx: ExtensionContext): string[] {
    const scope = this.scope(ctx);
    return this.manager.records().filter(record => this.manager.visible(record, scope)).map(record => record.runId);
  }
  bind(): void {
    this.detach();
    const current = this.binding.current;
    if (!current) return;
    const records = recordsIn(current.ctx.sessionManager.getBranch());
    this.manager.restore(records);
    for (const record of records) this.saved.set(record.runId, this.revision(record));
    this.unsubscribe = this.manager.subscribe(() => this.refresh()); this.refresh();
  }
  detach(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    clearInterval(this.timer); this.timer = undefined;
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
    const counts = new Map<string, number>();
    const rows = [...visible.values()].flatMap<DockRow>(record => {
      const run = this.manager.runs.get(record.runId), question = Boolean(run?.question);
      const failed = ['failed', 'limited'].includes(record.state) && run && !run.consumed;
      if (!active(record.state) && !failed) return [];
      const state = question ? 'waiting(parent)' : record.state;
      counts.set(state, (counts.get(state) ?? 0) + 1);
      const stateField = {text: state, state};
      const basic: DisplayField[] = [stateField, {text: ` · ${((record.elapsedMs ?? 0) / 1000).toFixed(1)}s`, tone: 'dim'}];
      const tools = `${record.toolUses ?? 0} tools`;
      return [{ id: `agent:${record.runId}`, text: sanitizeText(record.name).replace(/[\r\n\t]/g, ' '),
        suffix: [...basic, {text: ` · ↑${record.usage?.tokens.input ?? 0} ↓${record.usage?.tokens.output ?? 0} · ${tools}`, tone: 'dim'}],
        compactSuffixes: [[...basic, {text: ` · ${tools}`, tone: 'dim'}], basic, [stateField]],
        priority: question ? 100 : failed ? 80 : record.state === 'stopping' ? 75 : record.state === 'queued' ? 15 : 25 }];
    });
    const aside: DisplayField[] = ['starting', 'running', 'waiting', 'waiting(parent)', 'stopping', 'queued', 'failed', 'limited']
      .filter(state => counts.has(state)).flatMap((state, index) => [
        ...index ? [{text: ' · ', tone: 'dim' as const}] : [], {text: `${counts.get(state)} ${state}`, state},
      ]);
    return {rows, aside, ticking: [...visible.values()].some(record => active(record.state))};
  }
  private publishActivities(records: AgentRecord[], scope: ParentScope): void {
    const {rows, aside, ticking} = this.rows(records, scope);
    this.status.setActivities('agents', records.filter(record => executing(record.state)).map(record => record.id), rows, aside);
    const tick = ticking && this.status.detailsVisible('agents');
    // A quiet model request still accrues runtime. Tick only presentation, never
    // refresh persistence/notifications or start a timer in print-mode children.
    if (tick) this.timer ??= setInterval(() => {
      const scope = this.scope(this.binding.current!.ctx);
      this.publishActivities(this.manager.records().filter(record => this.manager.visible(record, scope)), scope);
    }, 1000).unref();
    else { clearInterval(this.timer); this.timer = undefined; }
  }
  private revision(record: AgentRecord): string { return `${record.state}:${record.background}:${record.sessionFile ?? ''}:${record.endedAt ?? ''}:${record.model}:${record.thinking}:${JSON.stringify(record.individual)}`; }
  private refresh(): void {
    const current = this.binding.current;
    if (!current) return;
    const scope = this.scope(current.ctx), records = this.manager.records().filter(record => this.manager.visible(record, scope));
    this.publishActivities(records, scope);
    const unread = this.unread();
    for (const request of this.queued) if (!unread.some(item => this.request(item) === request)) {
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
    for (const item of unread) {
      const request = this.request(item);
      if (this.queued.has(request)) continue;
      this.queued.add(request);
      this.notifications.enqueue(current.sessionId, request, item.summary, () => { this.queued.delete(request); this.consume(item); });
    }
  }
  // Resume keeps the agent ID, but each unread run owns its notification and cancellation.
  private request(item: Settlement): string { return `agent:${item.id}:${item.runId}${item.question ? ':ask' : ':result'}`; }
  settlement(id: string): Settlement {
    const { record, run } = this.manager.get(id);
    const question = run?.question && !run.question.seen;
    return { id, runId: record.runId, state: record.state, settled: !active(record.state), question: Boolean(question),
      summary: question ? questionText(run!) : active(record.state) ? summaryLine(record) : resultSummary(record) };
  }
  unread(): Settlement[] {
    const current = this.binding.current;
    if (!current) return [];
    const scope = this.scope(current.ctx);
    return [...this.manager.runs.values()].filter(run => run.question && !run.question.seen && this.manager.questionVisible(run.record, scope)
      || this.manager.visible(run.record, scope) && run.settled && !run.consumed && (run.record.background || run.notifyResult)).map(run => {
        const record = this.manager.view(run);
        const item: Settlement = { id: record.id, runId: record.runId, state: record.state, settled: !active(record.state),
          question: Boolean(run.question && !run.question.seen), summary: run.question && !run.question.seen ? questionText(run) : summaryLine(record) };
        return item.question ? item : { ...item, summary: `Agent result: ${resultSummary(record)}` };
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
