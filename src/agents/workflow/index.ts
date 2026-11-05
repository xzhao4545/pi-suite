import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../../runtime/binding.ts';
import type { Notifications } from '../../runtime/notifications.ts';
import type { Settlement, Waitable } from '../../runtime/wait.ts';
import type { Dock } from '../../ui/dock.ts';
import { sanitizeText } from '../../runtime/text.ts';
import type { AgentsModule } from '../index.ts';
import { WORKFLOW_ENTRY_TYPE, workflowEntryData, workflowEntries, type OwnedWorkflowTask } from './entry.ts';
import { WorkflowManager, workflowRuntime, workflowActive } from './manager.ts';
import { workflowResultText } from './task.ts';
import { formatDuration, elapsedMs } from './progress/index.ts';

export function workflowSummary(task: OwnedWorkflowTask): string {
  return `${task.id} ${task.status} · ${sanitizeText(task.workflowName ?? task.id).replace(/[\r\n\t]/g, ' ')} · ${task.doneCount}/${task.agentCount} agents · ${formatDuration(elapsedMs(task, Date.now()))}`;
}
/** Per-binding workflow view; the process-wide owner survives reload and session switches. */
export class WorkflowsModule implements Waitable {
  readonly prefix = 'wf_';
  readonly manager: WorkflowManager;
  private unsubscribe?: () => void;
  private queued = new Set<string>();
  private saved = new Map<string, string>();
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notices: Notifications,
    private dock: Dock, private agents: AgentsModule, manager?: WorkflowManager) {
    this.manager = manager ?? workflowRuntime();
    dock.register('workflows', () => this.list().filter(task => !this.manager.settled(task.id)).map(task => ({
      id: task.id, text: `${task.id} ${task.workflowName ?? 'workflow'}`, priority: 60,
      suffix: `${task.status} · ${task.doneCount}/${task.agentCount}`,
    })));
  }
  list(): OwnedWorkflowTask[] {
    const current = this.binding.current;
    return current ? [...this.manager.tasks.values()].filter(task => this.manager.visible(task, this.agents.scope(current.ctx))) : [];
  }
  bind(): void {
    this.detach();
    const current = this.binding.current; if (!current) return;
    const entries = workflowEntries(current.ctx.sessionManager.getBranch()); this.manager.restore(entries);
    for (const entry of entries) this.saved.set(entry.id, `${entry.status}:${entry.endTime ?? ''}:${entry.notified}:${entry.error ?? ''}`);
    this.unsubscribe = this.manager.subscribe(() => this.refresh()); this.refresh();
  }
  detach(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    if (this.binding.current) for (const id of this.queued) this.notices.cancel(this.binding.current.sessionId, `workflow:${id}:result`);
    this.queued.clear(); this.saved.clear(); this.dock.invalidate();
  }
  private refresh(): void {
    const current = this.binding.current; if (!current) return;
    for (const task of this.list()) {
      // A status may change while result files are still being flushed. Parent history
      // must announce completion only after the execution owner has settled it.
      if (!workflowActive(task) && !this.manager.settled(task.id)) continue;
      const revision = `${task.status}:${task.endTime ?? ''}:${task.notified}:${task.error ?? ''}`;
      if (this.saved.get(task.id) !== revision) {
        this.saved.set(task.id, revision); this.pi.appendEntry(WORKFLOW_ENTRY_TYPE, this.manager.snapshot(task));
      }
    }
    for (const item of this.unread()) {
      if (this.queued.has(item.id)) continue;
      this.queued.add(item.id);
      this.notices.enqueue(current.sessionId, `workflow:${item.id}:result`, item.summary, () => this.consume(item));
    }
    this.dock.invalidate();
  }
  settlement(id: string): Settlement {
    const task = this.manager.get(id), current = this.binding.current;
    if (!current || !this.manager.visible(task, this.agents.scope(current.ctx))) throw new Error(`Workflow ${id} is outside this session branch`);
    return {id, state: task.status, settled: this.manager.settled(id), summary: `${workflowSummary(task)}\n${workflowResultText(task).slice(0, 1000)}\nread: read({"path":${JSON.stringify(task.resultPath)}})`};
  }
  unread(): Settlement[] { return this.list().filter(task => this.manager.settled(task.id) && !task.notified).map(task => this.settlement(task.id)); }
  subscribe(listener: () => void): () => void { return this.manager.subscribe(listener); }
  consume(item: Settlement): void {
    if (!item.settled) return;
    const task = this.manager.get(item.id); task.notified = true;
    this.queued.delete(item.id);
    if (this.binding.current) this.notices.cancel(this.binding.current.sessionId, `workflow:${item.id}:result`);
    this.manager.changed();
  }
}
