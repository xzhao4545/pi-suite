// Background-run lifecycle adapted from @tintinweb/pi-subagents 0.23.0 src/index.ts.
// Bindings and notifications remain in the suite; this owner never holds an ExtensionAPI.
import { writeFileSync } from 'node:fs';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { loadConfig, type SuiteConfig } from '../../runtime/config.ts';
import { ToolError } from '../../runtime/errors.ts';
import { acquireRuntime } from '../../jobs/runtime.ts';
import type { JobManager } from '../../jobs/manager.ts';
import type { ParentScope } from '../types.ts';
import { captureParent } from '../parent.ts';
import { agentRuntime } from '../runtime.ts';
import { WORKFLOW_OWNER } from '../registry.ts';
import { acquireOwner, existingOwner, type OwnerHandle } from '../../runtime/owner.ts';
import type { AgentManager } from '../manager.ts';
import { appendJournal, readJournal } from './journal.ts';
import { taskFromEntry, workflowEntryData, type OwnedWorkflowTask, type WorkflowEntryData } from './entry.ts';
import { createWorkflowFiles, readWorkflowSnapshot, WorkflowStore } from './store.ts';
import { resolveWorkflowScript } from './saved.ts';
import { createWorkflowHost } from './host.ts';
import { createWorkflowTask, completeWorkflowTask, failWorkflowTask, pauseWorkflowTask, resumeWorkflowTask, resolveResumeTarget, updateWorkflowProgressBatch, workflowResultText, workflowRunId } from './task.ts';

export type WorkflowParams = {script?: string; scriptPath?: string; name?: string; args?: unknown; resumeFromRunId?: string};
export const workflowActive = (task: {status: string}) => task.status === 'running' || task.status === 'paused';
export class WorkflowManager {
  readonly tasks = new Map<string, OwnedWorkflowTask>();
  private runs = new Map<string, {done: Promise<void>; store: WorkflowStore; settled: boolean}>();
  private listeners = new Set<() => void>();
  private runtime?: Promise<typeof import('./runtime/run.ts')>;
  private starting = 0;
  closed = false;
  constructor(readonly agents: AgentManager, private jobs: () => JobManager) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed = (): void => { for (const listener of [...this.listeners]) listener(); };
  get(id: string): OwnedWorkflowTask {
    const task = this.tasks.get(id);
    if (!task) throw new ToolError('NOT_FOUND', `No workflow ${id}. Use a wf_ ID from this branch.`, id);
    return task;
  }
  jobManager(): JobManager { return this.jobs(); }
  visible(task: OwnedWorkflowTask, scope: ParentScope): boolean {
    return !scope.run && task.ownerSessionId === scope.ctx.sessionManager.getSessionId()
      && (task.anchorEntryId === null || scope.ctx.sessionManager.getBranch().some(entry => entry.id === task.anchorEntryId));
  }
  restore(entries: WorkflowEntryData[]): void {
    for (const entry of entries) {
      if (this.tasks.has(entry.id)) continue;
      const data = readWorkflowSnapshot(entry.recordPath);
      if (data.id !== entry.id || data.ownerSessionId !== entry.ownerSessionId || data.cwd !== entry.cwd || data.anchorEntryId !== entry.anchorEntryId) {
        throw new ToolError('WORKFLOW_HISTORY', `Workflow snapshot identity mismatch: ${entry.id}. Use another run; this record and its snapshot refer to different owners or runs.`);
      }
      const latest = (entry.endTime ?? 0) >= (data.endTime ?? 0) && !workflowActive(entry) ? entry : data;
      const task = taskFromEntry({...latest, notified: data.notified || entry.notified});
      // A saved running snapshot has no thread in this process; preserve its journal for explicit replay.
      if (workflowActive(task)) { failWorkflowTask(task, 'No live process owns this workflow. Replay its journal from /subagents Workflows or pass resumeFromRunId.'); }
      this.agents.restore(task.children);
      this.tasks.set(task.id, task);
    }
  }
  async start(params: WorkflowParams, scope: ParentScope, config: SuiteConfig, toolCallId?: string): Promise<OwnedWorkflowTask> {
    if (this.closed || this.agents.closed) throw new ToolError('CLOSING', 'Pi is quitting. Start the workflow after reopening Pi.');
    if (scope.run) throw new ToolError('INVALID_ARGS', 'agent_workflow only runs in the main session. Ask the main session to launch it.');
    if (!config.agents.workflows) throw new ToolError('INVALID_ARGS', 'agents.workflows is disabled; use agent_start instead');
    scope = captureParent(scope); this.jobs();
    const source = resolveWorkflowScript(params, scope.ctx.cwd, {trusted: scope.ctx.isProjectTrusted(), packageGate: config.agents.packageWorkflows});
    if (!source.ok) throw new ToolError('INVALID_ARGS', source.message);
    const target = resolveResumeTarget(params.resumeFromRunId, this.tasks);
    if (target && !target.ok) throw new ToolError('INVALID_ARGS', target.message);
    if (target && !this.visible(this.get(target.runId), scope)) throw new ToolError('NOT_OWNER', 'Resume target is outside this session branch; pass a finished wf_ run from the current branch');
    const replay = target ? readJournal(target.journalPath) : undefined;
    const id = workflowRunId(), files = createWorkflowFiles(scope.owner!.ownerSessionId, id, source.script);
    const task = Object.assign(createWorkflowTask({id, script: source.script, ...files, args: params.args,
      toolCallId, replay: replay?.entries, resumedFrom: target?.runId}),
    {cwd: scope.ctx.cwd, ...scope.owner!, recordPath: files.recordPath, resultPath: files.resultPath, notified: false, children: [] as OwnedWorkflowTask['children']});
    if (replay?.truncated) updateWorkflowProgressBatch(task, [{type: 'workflow_log', message: 'Resume journal has an incomplete final append; only its complete prefix is available.'}]);
    const store = new WorkflowStore(workflowEntryData(task));
    this.starting++;
    try { await store.save(workflowEntryData(task)); }
    finally { this.starting--; }
    // Quit can race the initial disk write, before a Worker has been admitted.
    if (this.closed || this.agents.closed) throw new ToolError('CLOSING', 'Pi quit before the workflow could launch. Start it after reopening Pi.');
    this.tasks.set(id, task);
    const host = createWorkflowHost({scope, manager: this.agents, jobs: this.jobs, workflowId: id,
      signal: task.abortController.signal, config: () => loadConfig(task.cwd)});
    const done = this.execute(task, store, host);
    this.runs.set(id, {done, store, settled: false}); this.changed(); return task;
  }
  private async execute(task: OwnedWorkflowTask, store: WorkflowStore, host: ReturnType<typeof createWorkflowHost>): Promise<void> {
    try {
      const { runWorkflow } = await (this.runtime ??= import('./runtime/run.ts'));
      const result = await runWorkflow({script: task.script, args: task.args, host, signal: task.abortController.signal,
        onMeta: meta => { task.meta = meta; task.workflowName = meta.name; },
        journal: {entries: task.replay, append: entry => appendJournal(task.journalPath!, entry)},
        onControl: control => { task.control = control; },
        onProgress: entries => { updateWorkflowProgressBatch(task, entries); this.changed(); }});
      await host.close();
      completeWorkflowTask(task, result);
    } catch (error) {
      task.abortController.abort();
      let message = error instanceof Error ? error.message : String(error);
      try { await host.close(); } catch (cleanup) { message += `; workflow cleanup failed: ${String(cleanup)}`; }
      failWorkflowTask(task, message);
    }
    try {
      writeFileSync(task.resultPath, workflowResultText(task), {flag: 'wx', mode: 0o600});
      await store.save(this.snapshot(task));
    } catch (error) { failWorkflowTask(task, `Workflow result persistence failed: ${String(error)}`); }
    // The only completion signal comes after child/job cleanup and result persistence.
    this.runs.get(task.id)!.settled = true;
    this.changed();
  }
  settled(id: string): boolean { return this.runs.get(id)?.settled ?? !workflowActive(this.get(id)); }
  /** Persist references; the shared SDK session remains the sole source of child transcript/result text. */
  snapshot(task: OwnedWorkflowTask): WorkflowEntryData {
    if (this.runs.has(task.id)) task.children = this.agents.records().filter(record => record.workflowId === task.id).map(record => {
      const {result, structuredJson, ...reference} = record; return reference;
    });
    return workflowEntryData(task);
  }
  finished(id: string): Promise<void> { this.get(id); return this.runs.get(id)?.done ?? Promise.resolve(); }
  async pause(id: string): Promise<boolean> {
    const task = this.get(id), changed = pauseWorkflowTask(task);
    if (changed) { await this.runs.get(id)!.store.save(this.snapshot(task)); this.changed(); }
    return changed;
  }
  async resume(id: string): Promise<boolean> {
    const task = this.get(id), changed = resumeWorkflowTask(task);
    if (changed) { await this.runs.get(id)!.store.save(this.snapshot(task)); this.changed(); }
    return changed;
  }
  async stop(id: string): Promise<boolean> {
    const task = this.get(id), requested = workflowActive(task);
    if (requested) task.abortController.abort();
    await this.finished(id); return requested;
  }
  /** Keep the owner through initial admission and the final result write, as well as Worker execution. */
  busy(): boolean {
    if (this.starting) return true;
    for (const run of this.runs.values()) if (!run.settled) return true;
    return false;
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const task of this.tasks.values()) if (workflowActive(task)) task.abortController.abort();
    await Promise.all([...this.runs.values()].map(run => run.done));
  }
}
export function workflowRuntime(agents = agentRuntime()): OwnerHandle<WorkflowManager> {
  const agentDir = getAgentDir();
  const handle = acquireOwner(WORKFLOW_OWNER, 'workflow', agentDir, () => {
    const runtime = acquireRuntime(agentDir);
    return new WorkflowManager(agents.owner, () => {
      if (runtime.mode !== 'active') throw new ToolError('RUNTIME_UNAVAILABLE', runtime.reason);
      return runtime.manager;
    });
  }, { matches: owner => owner.agents === agents.owner });
  // A workflow cannot accept new runs while its agents owner is stale.
  return { owner: handle.owner, stale: handle.stale ?? agents.stale };
}

/** Module admission does not own the lifetime of an already running Worker. */
export function quitExistingWorkflowRuntime(agentDir: string): Promise<void> | undefined {
  return existingOwner(WORKFLOW_OWNER, agentDir)?.shutdown();
}
