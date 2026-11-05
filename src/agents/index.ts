import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../runtime/binding.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { StatusPublisher } from '../ui/status.ts';
import type { DockRow } from '../ui/dock.ts';
import type { Settlement, Waitable } from '../runtime/wait.ts';
import { sanitizeText } from '../runtime/text.ts';
import { active, executing, type AgentRecord, type Execution, type ParentScope } from './types.ts';
import { AGENT_ENTRY, recordsIn } from './records.ts';
import { questionText } from './questions.ts';
import { agentRuntime } from './runtime.ts';
import type { AgentManager } from './manager.ts';
import type { TasksModule } from '../tasks/index.ts';

export function summaryLine(record: AgentRecord): string {
  return `${record.id} ${record.state} · ${sanitizeText(record.name).replace(/[\r\n\t]/g, ' ')} · ${record.runId}${record.elapsedMs === undefined ? '' : ` · ${(record.elapsedMs / 1000).toFixed(1)}s`}`;
}
export function agentSummary(record: AgentRecord) {
  const { prompt, result, ...summary } = record;
  return { ...summary, promptSummary: prompt.slice(0, 200), resultSummary: result?.slice(0, 500) };
}
export function usageText(record: AgentRecord): string | undefined {
  const usage = record.usage;
  return usage && `usage: input ${usage.tokens.input} · output ${usage.tokens.output} · cacheRead ${usage.tokens.cacheRead} · cacheWrite ${usage.tokens.cacheWrite} · total ${usage.tokens.total} · cost $${usage.cost.toFixed(6)}`;
}
function resultSummary(record: AgentRecord): string {
  return [summaryLine(record), usageText(record), record.error ? `error: ${sanitizeText(record.error).slice(0, 500)}` : undefined,
    record.result?.slice(0, 500), `read: agent_read({"id":"${record.id}","runId":"${record.runId}"})`].filter(value => value !== undefined).join('\n');
}
export class AgentsModule implements Waitable {
  readonly prefix = 'agent_';
  readonly manager: AgentManager;
  private unsubscribe?: () => void;
  private queued = new Set<string>();
  private saved = new Map<string, string>();
  private selectedRun?: string;
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications,
    private status: StatusPublisher, private tasks?: TasksModule, private parentRun?: Execution, manager?: AgentManager) {
    this.manager = manager ?? agentRuntime();
  }
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
    const current = this.binding.current;
    if (current) for (const request of this.queued) this.notifications.cancel(current.sessionId, request);
    this.queued.clear(); this.saved.clear(); this.selectedRun = undefined; this.status.setActivities('agents', []);
  }
  selectRun(runId: string): void { this.selectedRun = runId; this.refresh(); }
  private rows(records: AgentRecord[], scope: ParentScope): DockRow[] {
    // A consumed question is still awaiting its answer. Include workflow questions
    // visible to this parent without exposing unrelated runs or nested descendants.
    const visible = new Map(records.map(record => [record.runId, record]));
    for (const run of this.manager.runs.values()) if (run.question && this.manager.questionVisible(run.record, scope)) {
      visible.set(run.record.runId, this.manager.view(run));
    }
    return [...visible.values()].flatMap(record => {
      const run = this.manager.runs.get(record.runId), question = Boolean(run?.question), selected = record.runId === this.selectedRun;
      const failed = ['failed', 'limited'].includes(record.state) && run && !run.consumed;
      if (!active(record.state) && !failed) return [];
      return [{ id: `agent:${record.runId}`, text: `${selected ? '> ' : ''}agent ${record.id.slice(-8)} ${sanitizeText(record.name).replace(/[\r\n\t]/g, ' ')}`,
        suffix: question ? 'waiting(parent)' : record.state,
        priority: question ? 100 : failed ? 80 : record.state === 'stopping' ? 75 : selected ? 65 : record.state === 'queued' ? 15 : 25 }];
    });
  }
  private revision(record: AgentRecord): string { return `${record.state}:${record.background}:${record.sessionFile ?? ''}:${record.endedAt ?? ''}:${record.model}:${record.thinking}:${JSON.stringify(record.individual)}`; }
  private refresh(): void {
    const current = this.binding.current;
    if (!current) return;
    const scope = this.scope(current.ctx), records = this.manager.records().filter(record => this.manager.visible(record, scope));
    this.status.setActivities('agents', records.filter(record => executing(record.state)).map(record => record.id), this.rows(records, scope));
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
