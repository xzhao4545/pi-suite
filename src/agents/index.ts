import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../runtime/binding.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { StatusPublisher } from '../ui/status.ts';
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
export class AgentsModule implements Waitable {
  readonly prefix = 'agent_';
  readonly manager: AgentManager;
  private unsubscribe?: () => void;
  private queued = new Set<string>();
  private saved = new Map<string, string>();
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications,
    private status: StatusPublisher, private tasks?: TasksModule, private parentRun?: Execution, manager?: AgentManager) {
    this.manager = manager ?? agentRuntime();
  }
  scope(ctx: ExtensionContext): ParentScope { return { ctx, run: this.parentRun, taskStore: this.tasks?.scope(ctx) ?? this.parentRun?.parent.taskStore }; }
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
    this.queued.clear(); this.saved.clear(); this.status.setActivities('agents', []);
  }
  private revision(record: AgentRecord): string { return `${record.state}:${record.sessionFile ?? ''}:${record.endedAt ?? ''}:${record.model}:${record.thinking}`; }
  private refresh(): void {
    const current = this.binding.current;
    if (!current) return;
    const scope = this.scope(current.ctx), records = this.manager.records().filter(record => this.manager.visible(record, scope));
    this.status.setActivities('agents', records.filter(record => executing(record.state)).map(record => record.id));
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
  private request(item: Settlement): string { return `agent:${item.id}${item.question ? ':ask' : ':result'}`; }
  settlement(id: string): Settlement {
    const { record, run } = this.manager.get(id);
    const question = run?.question && !run.question.seen;
    return { id, runId: record.runId, state: record.state, settled: !active(record.state), question: Boolean(question),
      summary: question ? questionText(run!) : `${summaryLine(record)}${record.error ? `\n${record.error}` : ''}` };
  }
  unread(): Settlement[] {
    const current = this.binding.current;
    if (!current) return [];
    const scope = this.scope(current.ctx);
    return [...this.manager.runs.values()].filter(run => this.manager.visible(run.record, scope)
      && (run.question && !run.question.seen || run.settled && !run.consumed && (run.record.background || run.notifyResult))).map(run => {
        const record = this.manager.view(run);
        const item: Settlement = { id: record.id, runId: record.runId, state: record.state, settled: !active(record.state),
          question: Boolean(run.question && !run.question.seen), summary: run.question && !run.question.seen ? questionText(run) : summaryLine(record) };
        return item.question ? item : { ...item, summary: `Agent result: ${item.summary}\n${(run.record.result ?? '').slice(0, 500)}\nread: agent_read({"id":"${run.record.id}","runId":"${run.record.runId}"})` };
      });
  }
  subscribe(listener: () => void): () => void { return this.manager.subscribe(listener); }
  consume(item: Settlement): void {
    const { run } = this.manager.get(item.id, item.runId);
    if (run) { if (item.question && run.question) run.question.seen = true; else if (item.settled) run.consumed = true; }
    const current = this.binding.current, request = this.request(item);
    if (current) this.notifications.cancel(current.sessionId, request);
    this.queued.delete(request);
  }
}
