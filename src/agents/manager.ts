// Two-pool charging/FIFO and run lifecycle adapted from pi-subagents agent-manager.ts (MIT).
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import { ToolError } from '../runtime/errors.ts';
import { resolveType } from './catalog.ts';
import { resolveSettings } from './models.ts';
import { hydrate, transcript } from './records.ts';
import { answerParent } from './questions.ts';
import { closeAgent } from './runner.ts';
import { active, type AgentRecord, type Execution, type ParentScope, type Pool, type StartAgent } from './types.ts';

const allocate = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;
export class AgentManager {
  readonly runs = new Map<string, Execution>();
  private histories = new Map<string, AgentRecord>();
  private queue: Execution[] = [];
  private counts = { background: 0, foreground: 0 };
  private limits = { background: 10, foreground: 0 };
  private closing = false;
  private listeners = new Set<() => void>();
  private closedRuns = new Set<string>();
  private stops = new Map<string, Promise<StopOutcome>>();
  constructor(private execute: (run: Execution) => Promise<void>, private stopJobs: (ids: string[]) => Promise<StopOutcome['affected']>) {}
  get closed(): boolean { return this.closing; }
  configure(config: SuiteConfig): void {
    this.limits = { background: config.agents.maxConcurrent, foreground: config.agents.maxConcurrentForeground };
    this.drain();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed = (): void => { for (const listener of [...this.listeners]) listener(); };
  restore(records: AgentRecord[]): void {
    for (const record of records) if (!this.runs.has(record.runId)) this.histories.set(record.runId, hydrate(record));
  }
  records(): AgentRecord[] {
    return [...this.histories.values(), ...[...this.runs.values()].map(run => this.view(run))];
  }
  view(run: Execution): AgentRecord {
    const state = !run.settled && !active(run.record.state) ? run.controller.signal.aborted ? 'stopping' : 'running' : run.record.state;
    return { ...run.record, state, elapsedMs: run.startedMonotonic !== undefined && !run.settled
      ? Math.round(performance.now() - run.startedMonotonic) : run.record.elapsedMs };
  }
  get(id: string, runId?: string): { record: AgentRecord; run?: Execution } {
    const records = this.records().filter(record => record.id === id && (!runId || record.runId === runId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId));
    const record = records[0];
    if (!record) throw new ToolError('NOT_FOUND', `No agent ${id}${runId ? ` run ${runId}` : ''}`, id);
    return { record, run: this.runs.get(record.runId) };
  }
  visible(record: AgentRecord, scope: ParentScope): boolean {
    if (scope.run) return record.parentRunId === scope.run.record.runId;
    return !record.parentAgentId && record.ownerSessionId === scope.ctx.sessionManager.getSessionId()
      && (record.anchorEntryId === null || scope.ctx.sessionManager.getBranch().some(entry => entry.id === record.anchorEntryId));
  }
  async start(request: StartAgent, scope: ParentScope, config: SuiteConfig, previous?: AgentRecord): Promise<Execution> {
    if (this.closing || scope.run && (!active(scope.run.record.state) || this.closedRuns.has(scope.run.record.runId))) {
      throw new ToolError('NOT_RUNNING', 'Parent run no longer admits children');
    }
    const type = resolveType(scope.ctx.cwd, previous?.type ?? request.type ?? 'general-purpose');
    if (scope.run) {
      const allowed = scope.run.type.allowedSubagents;
      if (!allowed || allowed !== 'all' && !allowed.includes(type.name)) throw new ToolError('AGENT_TYPE', `${scope.run.record.type} cannot start ${type.name}`);
      if (scope.run.record.ancestors.length + 1 >= config.agents.maxDepth) throw new ToolError('AGENT_DEPTH', 'agents.maxDepth reached');
    }
    const settings = resolveSettings(scope.ctx, type, request, config);
    const taskStore = scope.taskStore;
    if (request.taskId && taskStore) {
      const task = (await taskStore.snapshot()).tasks.find(task => task.id === request.taskId);
      if (!task?.parentId) throw new ToolError('NOT_FOUND', `No execution task #${request.taskId}`);
    }
    // Recheck after task I/O: stop closes subtree admission before awaiting any abort/job cleanup.
    if (this.closing || scope.run && this.closedRuns.has(scope.run.record.runId)) throw new ToolError('NOT_RUNNING', 'Parent run is stopping');
    const id = previous?.id ?? allocate('agent');
    if ([...this.runs.values()].some(run => run.record.id === id && !run.settled)) throw new ToolError('ALREADY_RUNNING', `${id} already has an unsettled execution`, id);
    const record: AgentRecord = { version: 1, id, runId: allocate('run'), type: type.name, name: request.name ?? previous?.name ?? type.displayName ?? type.name,
      prompt: request.prompt, cwd: scope.ctx.cwd, ownerSessionId: scope.run?.record.ownerSessionId ?? scope.ctx.sessionManager.getSessionId(),
      anchorEntryId: scope.run?.record.anchorEntryId ?? scope.ctx.sessionManager.getLeafId(),
      parentAgentId: scope.run?.record.id, parentRunId: scope.run?.record.runId,
      ancestors: scope.run ? [...scope.run.record.ancestors, scope.run.record.runId] : [],
      background: request.background ?? true, state: 'queued', createdAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString(),
      model: `${settings.model.provider}/${settings.model.id}`, modelSource: settings.modelSource,
      thinking: settings.thinking, thinkingSource: settings.thinkingSource,
      persisted: previous?.persisted ?? type.persistSession ?? (!scope.run && config.agents.persistSessions), sessionFile: previous?.sessionFile,
      taskId: request.taskId ?? previous?.taskId };
    const run: Execution = { record, type, model: settings.model, parent: scope, controller: new AbortController(),
      done: Promise.withResolvers(), pendingMessages: [], consumed: false, maxTurns: type.maxTurns ?? request.maxTurns };
    // Preserve a non-persisted transcript for same-process resume using the SDK's session tree.
    if (previous && !previous.sessionFile) {
      run.entries = transcript(previous, this.runs.get(previous.runId));
      run.sessionManager = this.runs.get(previous.runId)?.sessionManager;
    }
    this.runs.set(record.runId, run); this.queue.push(run);
    this.configure(config); this.changed();
    if (request.taskId && taskStore) {
      try { await taskStore.link(request.taskId, { agentId: id }); }
      catch (error) { throw new ToolError('TASK_LINK_FAILED', `${id} started but task #${request.taskId} could not be linked: ${String(error)}`, id); }
    }
    return run;
  }
  private room(pool: Pool): boolean { return !this.limits[pool] || this.counts[pool] < this.limits[pool]; }
  private drain(): void {
    if (this.closing) return;
    for (;;) {
      // Choose the earliest runnable item for its own pool; a saturated foreground head must
      // not block background work. Nested children are uncharged to avoid parent/child deadlock.
      const index = this.queue.findIndex(run => !!run.parent.run || this.room(run.record.background ? 'background' : 'foreground'));
      if (index < 0) return;
      const [run] = this.queue.splice(index, 1);
      run.record.state = 'starting'; run.record.startedAt = new Date().toISOString(); run.startedMonotonic = performance.now();
      if (!run.parent.run) {
        run.chargedPool = run.record.background ? 'background' : 'foreground'; this.counts[run.chargedPool]++;
      }
      void this.launch(run);
    }
  }
  private async launch(run: Execution): Promise<void> {
    try {
      await this.execute(run);
      if (run.record.state !== 'limited') run.record.state = run.controller.signal.aborted || run.terminated ? 'stopped' : 'completed';
    } catch (error) {
      run.record.error = error instanceof Error ? error.message : String(error);
      if (run.record.state !== 'limited') run.record.state = run.controller.signal.aborted ? 'stopped' : 'failed';
    } finally {
      // A settled direct parent cannot leave hidden nested sessions burning tokens.
      this.closedRuns.add(run.record.runId);
      try {
        await Promise.all([...this.runs.values()].filter(child => child.record.parentRunId === run.record.runId && active(child.record.state)).map(child => this.stop(child.record.id, child.record.runId)));
        if (run.controller.signal.aborted || run.terminated) await this.stopJobs([run.record.runId]);
      } catch (error) { run.record.error = [run.record.error, `Execution cleanup failed: ${String(error)}`].filter(Boolean).join('; '); run.record.state = 'failed'; }
      run.record.endedAt = new Date().toISOString(); run.record.elapsedMs = Math.round(performance.now() - run.startedMonotonic!);
      try { await closeAgent(run); }
      catch (error) { run.record.error = [run.record.error, `Session finalization failed: ${String(error)}`].filter(Boolean).join('; '); run.record.state = 'failed'; }
      if (run.chargedPool) this.counts[run.chargedPool]--;
      run.settled = true; run.done.resolve(this.view(run)); this.changed(); this.drain();
    }
  }
  async send(id: string, message: string, scope: ParentScope, config: SuiteConfig) {
    const { record, run } = this.get(id);
    if (!this.visible(record, scope)) throw new ToolError('NOT_OWNER', `${id} is not a direct child of this session`, id);
    if (run?.question) { answerParent(run, message); return { action: 'answered' as const, run }; }
    if (run && !run.settled && !active(run.record.state)) throw new ToolError('NOT_RUNNING', `${id} is settling`, id);
    if (record.state === 'stopping' || record.state === 'queued') throw new ToolError('NOT_RUNNING', `${id} is ${record.state}`, id);
    if (run && active(record.state)) {
      if (!run.session || !run.session.isStreaming) { run.pendingMessages.push(message); return { action: 'queued' as const, run }; }
      await run.session.steer(message); return { action: 'steered' as const, run };
    }
    const next = await this.start({ prompt: message, background: record.background }, scope, config, record);
    return { action: 'resumed' as const, run: next };
  }
  stop(id: string, runId?: string): Promise<StopOutcome> {
    const { record, run } = this.get(id, runId);
    const roots = this.records().filter(item => item.id === id && (!runId || item.runId === runId)).map(item => item.runId);
    const stopKey = `${id}:${roots.join(',')}`;
    const existing = this.stops.get(stopKey);
    if (existing) return existing;
    for (const root of roots) this.closedRuns.add(root);
    const targets = [...this.runs.values()].filter(item => roots.includes(item.record.runId) || item.record.ancestors.some(ancestor => roots.includes(ancestor)));
    let requested = false;
    for (const target of targets) if (active(target.record.state)) {
      requested = true; this.closedRuns.add(target.record.runId); target.controller.abort();
      if (target.record.state === 'queued') {
        this.queue = this.queue.filter(item => item !== target);
        target.record.state = 'stopped'; target.record.endedAt = new Date().toISOString(); target.record.elapsedMs = 0;
        target.settled = true; target.done.resolve(this.view(target));
      } else target.record.state = 'stopping';
    }
    this.changed();
    const operation = (async () => {
      const jobs = await this.stopJobs(roots);
      await Promise.all(targets.map(target => target.done.promise));
      const affected = [...targets.map(target => ({ id: target.record.id, state: target.record.state })), ...jobs];
      this.drain();
      return { requested: requested || jobs.length > 0, state: this.get(id, record.runId).record.state,
        cleanup: jobs.some(job => job.cleanup === 'unconfirmed' || job.cleanup === 'pending') ? 'unconfirmed' : 'confirmed', affected };
    })();
    this.stops.set(stopKey, operation);
    return operation;
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    await Promise.all([...new Set(this.records().filter(record => active(record.state)).map(record => record.id))].map(id => this.stop(id)));
  }
}
