// Two-pool charging/FIFO and run lifecycle adapted from @tintinweb/pi-subagents 0.23.0 src/agent-manager.ts (MIT).
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import { ToolError } from '../runtime/errors.ts';
import { resolveType } from './catalog.ts';
import { resolveSettings } from './models.ts';
import { hydrate, transcript } from './records.ts';
import { AgentHistory } from './history.ts';
import { answerParent } from './questions.ts';
import { closeAgent } from './runner.ts';
import { buildParentContext } from './resources/context.ts';
import { captureParent } from './parent.ts';
import { assignHandle, handleBase } from './mentions/grammar.ts';
import { active, isTopLevelAgent, recordWorkspace, type AgentEventKind, type AgentRecord, type Execution, type ParentScope, type Pool, type StartAgent, type StartOptions } from './types.ts';

const allocate = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;
export class AgentManager {
  readonly runs = new Map<string, Execution>();
  private histories = new Map<string, {record: AgentRecord; updatedAt: number}>();
  private history = new AgentHistory();
  private queue: Execution[] = [];
  private counts = { background: 0, foreground: 0 };
  private limits = { background: 10, foreground: 0 };
  private closing = false;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(kind: AgentEventKind, run: Execution, details: Record<string, unknown>) => void>();
  private closedRuns = new Set<string>();
  private stops = new Map<string, Promise<StopOutcome>>();
  private retained = new Map<string, number>();
  private cleanupTimer?: NodeJS.Timeout;
  constructor(private execute: (run: Execution) => Promise<void>, private stopJobs: (ids: string[]) => Promise<StopOutcome['affected']>) {}
  get closed(): boolean { return this.closing; }
  configure(config: SuiteConfig): void {
    this.limits = { background: config.agents.maxConcurrent, foreground: config.agents.maxConcurrentForeground };
    this.drain();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed = (): void => { for (const listener of [...this.listeners]) listener(); };
  subscribeEvents(listener: (kind: AgentEventKind, run: Execution, details: Record<string, unknown>) => void): () => void {
    this.eventListeners.add(listener); return () => this.eventListeners.delete(listener);
  }
  event(kind: AgentEventKind, run: Execution, details: Record<string, unknown> = {}): void {
    if (kind === 'started') run.startup?.resolve(undefined);
    for (const listener of [...this.eventListeners]) listener(kind, run, details);
  }
  async awaitStartup(run: Execution): Promise<void> {
    // A queued spawn returns its ID without waiting for a pool slot, as upstream does.
    const error = await run.startup?.promise;
    if (error !== undefined) throw new Error(error);
  }
  restore(records: AgentRecord[]): void {
    for (const record of records) if (!this.runs.has(record.runId)) this.histories.set(record.runId, {record: hydrate(record), updatedAt: Date.now()});
  }
  async discover(scope: ParentScope, config: SuiteConfig, signal?: AbortSignal): Promise<void> {
    const candidates = await this.history.scan(scope, config, signal);
    for (const candidate of candidates) {
      if (this.runs.has(candidate.record.runId)) continue;
      const old = this.histories.get(candidate.record.runId);
      if (!old || candidate.updatedAt > old.updatedAt) this.histories.set(candidate.record.runId, candidate);
    }
  }
  async lookup(id: string, scope: ParentScope, config: SuiteConfig, runId?: string, signal?: AbortSignal) {
    if (!this.records().some(record => record.id === id && (!runId || record.runId === runId))) await this.discover(scope, config, signal);
    const found = this.get(id, runId);
    if (recordWorkspace(found.record) !== (scope.run?.configCwd ?? scope.ctx.cwd)) throw new ToolError('NOT_FOUND', `No workspace agent ${id}`, id);
    return found;
  }
  /** Readers and workflow continuations keep their in-memory SDK tree until they close. */
  retain(runId: string): () => void {
    this.retained.set(runId, (this.retained.get(runId) ?? 0) + 1);
    return () => {
      const remaining = this.retained.get(runId)! - 1;
      if (remaining) this.retained.set(runId, remaining);
      else this.retained.delete(runId);
    };
  }
  /** Adapt upstream's ten-minute sweep to the existing history and notification owners. */
  sweep(now = Date.now()): void {
    let changed = false;
    for (const [runId, run] of this.runs) {
      if (!run.settled || this.retained.has(runId) || Date.parse(run.record.endedAt!) >= now - 10 * 60_000) continue;
      const parent = run.record.parentRunId ? this.runs.get(run.record.parentRunId) : undefined;
      // The host consumes top-level workflow results; a closed nested parent cannot receive notices.
      // Ordinary unread results must survive even when their parent UI is detached.
      const unread = !run.consumed && (run.record.background || run.notifyResult)
        && (run.record.parentRunId ? parent && !parent.settled : !run.record.workflowId);
      if (unread) continue;
      this.histories.set(runId, {record: this.view(run), updatedAt: Date.now()});
      this.runs.delete(runId); this.closedRuns.delete(runId); changed = true;
    }
    if (!this.runs.size) { clearInterval(this.cleanupTimer); this.cleanupTimer = undefined; }
    if (changed) this.changed();
  }
  records(): AgentRecord[] {
    return [...this.histories.values()].map(history => history.record).concat([...this.runs.values()].map(run => this.view(run)));
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
    return isTopLevelAgent(record) && record.ownerSessionId === scope.ctx.sessionManager.getSessionId()
      && (record.anchorEntryId === null || scope.ctx.sessionManager.getBranch().some(entry => entry.id === record.anchorEntryId));
  }
  /** Workflow children report questions to their real parent without exposing ordinary steering. */
  questionVisible(record: AgentRecord, scope: ParentScope): boolean {
    return this.visible(record, scope) || !scope.run && record.workflowId !== undefined
      && record.parentAgentId === undefined && record.ownerSessionId === scope.ctx.sessionManager.getSessionId()
      && (record.anchorEntryId === null || scope.ctx.sessionManager.getBranch().some(entry => entry.id === record.anchorEntryId));
  }
  async start(request: StartAgent, scope: ParentScope, config: SuiteConfig, previous?: AgentRecord,
    options: StartOptions = {}, continuation?: Execution): Promise<Execution> {
    scope = captureParent(scope);
    options.signal?.throwIfAborted();
    if (this.closing || scope.run && (!active(scope.run.record.state) || this.closedRuns.has(scope.run.record.runId))) {
      throw new ToolError('NOT_RUNNING', 'Parent run no longer admits children');
    }
    const configCwd = scope.run?.configCwd ?? scope.ctx.cwd;
    // A target-directory child reports its tools' cwd as untrusted. Carry the opened
    // project's distinct trust with its config root through every nested generation.
    const configTrusted = scope.run?.configTrusted ?? scope.ctx.isProjectTrusted();
    const type = continuation?.type ?? resolveType(configCwd, previous?.type ?? request.type ?? 'general-purpose', {
      trusted: configTrusted, packageGate: config.agents.packageAgents, typeSettings: config.agents.types });
    if (scope.run) {
      if (scope.run.isolated) throw new ToolError('AGENT_TYPE', 'An isolated child cannot start nested agents');
      const allowed = scope.run.type.allowedSubagents;
      if (!allowed || allowed !== 'all' && !allowed.includes(type.name)) throw new ToolError('AGENT_TYPE', `${scope.run.record.type} cannot start ${type.name}`);
      if (scope.run.record.ancestors.length + 1 >= config.agents.maxDepth) throw new ToolError('AGENT_DEPTH', 'agents.maxDepth reached');
    }
    const settings = continuation ? { model: continuation.model, modelSource: continuation.record.modelSource,
      thinking: continuation.record.thinking, thinkingSource: continuation.record.thinkingSource }
      : resolveSettings(scope.ctx, type, request, config, previous?.individual);
    const taskStore = scope.taskStore;
    if (request.taskId && taskStore) {
      const task = (await taskStore.snapshot()).tasks.find(task => task.id === request.taskId);
      if (!task?.parentId) throw new ToolError('NOT_FOUND', `No execution task #${request.taskId}`);
    }
    // Recheck after task I/O: stop closes subtree admission before awaiting any abort/job cleanup.
    options.signal?.throwIfAborted();
    if (this.closing || scope.run && (!active(scope.run.record.state) || this.closedRuns.has(scope.run.record.runId))) throw new ToolError('NOT_RUNNING', 'Parent run is stopping');
    const id = previous?.id ?? allocate('agent');
    if ([...this.runs.values()].some(run => run.record.id === id && !run.settled)) throw new ToolError('ALREADY_RUNNING', `${id} already has an unsettled execution`, id);
    // Handles and user aliases share a namespace across this owner's runs. Persisting them
    // keeps a completed/resumed agent addressable without renumbering after reload or /tree.
    const taken = new Set(this.records().filter(record => record.ownerSessionId === scope.owner!.ownerSessionId && record.id !== id)
      .flatMap(record => [record.handle, record.alias].filter((name): name is string => name !== undefined)));
    const workflowId = scope.run?.record.workflowId ?? options.workflowId;
    const handle = scope.run || workflowId ? undefined : previous?.handle ?? assignHandle(handleBase(type.name), taken);
    if (handle) taken.add(handle);
    const alias = scope.run || workflowId ? undefined : previous?.alias ?? (request.name ? assignHandle(handleBase(request.name), taken) : undefined);
    // A timer has no foreground caller or launch-time conversation; provenance selects
    // background delivery and suppresses inherited text without changing the type definition.
    const record: AgentRecord = { version: 1, id, runId: allocate('run'), type: type.name, name: request.name ?? previous?.name ?? type.displayName ?? type.name, handle, alias,
      prompt: request.prompt, cwd: options.cwd ?? previous?.cwd ?? scope.ctx.cwd, configCwd, ...scope.owner!,
      parentAgentId: scope.run?.record.id, parentRunId: scope.run?.record.runId,
      ancestors: scope.run ? [...scope.run.record.ancestors, scope.run.record.runId] : [],
      background: options.scheduleId ? true : type.runInBackground ?? request.background ?? true, scheduleId: options.scheduleId, workflowId, description: options.description, state: 'queued', createdAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString(),
      model: `${settings.model.provider}/${settings.model.id}`, modelSource: settings.modelSource,
      thinking: settings.thinking, thinkingSource: settings.thinkingSource,
      persisted: previous?.persisted ?? type.persistSession ?? (!scope.run && config.agents.persistSessions), sessionFile: previous?.sessionFile,
      taskId: request.taskId ?? previous?.taskId, individual: previous?.individual };
    const run: Execution = { record, type, model: settings.model, parent: scope, controller: new AbortController(),
      done: Promise.withResolvers(), pendingMessages: [], consumed: false, notifyResult: options.detached, maxTurns: type.maxTurns ?? request.maxTurns, request, config,
      isolated: type.isolated ?? request.isolated, bypassQueue: options.bypassQueue, configCwd, configTrusted, options,
      inheritedContext: !continuation && !options.scheduleId && (type.inheritContext ?? request.inheritContext) ? buildParentContext(scope.ctx) : undefined };
    // Preserve a non-persisted transcript for same-process resume using the SDK's session tree.
    if (previous && !previous.sessionFile) {
      const prior = continuation ?? this.runs.get(previous.runId);
      run.entries = transcript(previous, prior);
      run.sessionManager = prior?.sessionManager;
    }
    this.runs.set(record.runId, run); this.queue.push(run);
    this.cleanupTimer ??= setInterval(() => this.sweep(), 60_000).unref();
    this.event('created', run);
    try { options.onSpawned?.(id); }
    catch (error) { await this.stop(id, record.runId); throw error; }
    if (options.signal) {
      const abort = () => { void this.stop(id, record.runId); };
      options.signal.addEventListener('abort', abort, { once: true });
      run.detachAbort = () => options.signal!.removeEventListener('abort', abort);
      if (options.signal.aborted) abort();
    }
    this.configure(config); this.changed();
    if (record.state === 'queued') {
      try { options.onQueued?.(id, this.queue.filter(item => item.record.background === record.background).indexOf(run)); }
      catch (error) { await this.stop(id, record.runId); throw error; }
    }
    if (request.taskId && taskStore) {
      try { await taskStore.link(request.taskId, { agentId: id }); }
      catch (error) { throw new ToolError('TASK_LINK_FAILED', `${id} started but task #${request.taskId} could not be linked: ${String(error)}`, id); }
    }
    return run;
  }
  /** Workflow continuation keeps its launch contract while using the SDK's existing session tree. */
  resume(run: Execution, prompt: string, signal: AbortSignal, onSpawned?: (id: string) => void): Promise<Execution> {
    if (!run.settled) throw new ToolError('ALREADY_RUNNING', `${run.record.id} is still settling`, run.record.id);
    if (!run.sessionManager && !run.record.sessionFile) throw new ToolError('HISTORY_READ_ONLY', 'No workflow child session to continue', run.record.id);
    return this.start({ ...run.request, prompt }, run.parent, run.config, run.record, { ...run.options, signal, onSpawned }, run);
  }
  /** Only an actual waiting caller can release a foreground run; RPC and resumed runs cannot. */
  canSendToBackground(id: string, runId?: string): boolean {
    const { record, run } = this.get(id, runId);
    return Boolean(run?.foreground && !run.settled && isTopLevelAgent(record) && !record.background
      && active(run.record.state) && !['queued', 'stopping'].includes(run.record.state));
  }
  /** Adapt upstream's one-way handoff, including pool charging and caller wake-up. */
  sendToBackground(id: string, runId?: string): boolean {
    if (!this.canSendToBackground(id, runId)) return false;
    const run = this.get(id, runId).run!;
    if (run.chargedPool) {
      this.counts[run.chargedPool]--; run.chargedPool = 'background'; this.counts.background++;
    }
    run.record.background = true; run.consumed = false;
    run.foreground!.resolve(undefined);
    this.changed(); this.drain(); return true;
  }
  private room(pool: Pool): boolean { return !this.limits[pool] || this.counts[pool] < this.limits[pool]; }
  private pool(run: Execution): Pool | undefined {
    if (!isTopLevelAgent(run.record) || run.options.detached && !run.record.background) return;
    return run.record.background ? 'background' : 'foreground';
  }
  private drain(): void {
    if (this.closing) return;
    for (;;) {
      // Choose the earliest runnable item for its own pool; a saturated foreground head must
      // not block background work. Nested children are uncharged to avoid parent/child deadlock.
      // Timed dispatches bypass saturation but still charge their ordinary pool below.
      const index = this.queue.findIndex(run => { const pool = this.pool(run); return pool === undefined || run.bypassQueue || this.room(pool); });
      if (index < 0) return;
      const [run] = this.queue.splice(index, 1);
      run.record.state = 'starting'; run.record.startedAt = new Date().toISOString(); run.startedMonotonic = performance.now();
      run.startup = Promise.withResolvers();
      run.chargedPool = this.pool(run);
      if (run.chargedPool) this.counts[run.chargedPool]++;
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
      run.settled = true; run.detachAbort?.();
      run.startup?.resolve(run.record.error ?? 'Agent stopped before startup');
      run.done.resolve(this.view(run));
      // Synchronous completion consumers must run before changed() schedules a parent wake.
      this.event(['failed', 'stopped', 'limited'].includes(run.record.state) ? 'failed' : 'completed', run);
      this.changed(); this.drain();
    }
  }
  async send(id: string, message: string, scope: ParentScope, config: SuiteConfig) {
    const { record, run } = this.get(id);
    if (run?.question && this.questionVisible(record, scope)) { answerParent(run, message); return { action: 'answered' as const, run }; }
    if (!this.visible(record, scope)) throw new ToolError('NOT_OWNER', `${id} is not a direct child of this session`, id);
    if (run && !run.settled && !active(run.record.state)) throw new ToolError('NOT_RUNNING', `${id} is settling`, id);
    if (record.state === 'stopping') throw new ToolError('NOT_RUNNING', `${id} is ${record.state}`, id);
    if (run && active(record.state)) {
      if (!run.session || !run.session.isStreaming) { run.pendingMessages.push(message); this.event('steered', run, { message }); return { action: 'queued' as const, run }; }
      await run.session.steer(message); this.event('steered', run, { message }); return { action: 'steered' as const, run };
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
        target.settled = true; target.detachAbort?.(); target.done.resolve(this.view(target));
        this.event('failed', target);
      } else target.record.state = 'stopping';
    }
    this.changed();
    const operation = (async () => {
      // Job cleanup can fail independently of model abort. Still join every child before
      // reporting that failure, so callers cannot publish a settled parent prematurely.
      const [jobsResult] = await Promise.allSettled([this.stopJobs(roots), Promise.all(targets.map(target => target.done.promise))]);
      if (jobsResult.status === 'rejected') throw jobsResult.reason;
      const jobs = jobsResult.value;
      const affected = [...targets.map(target => ({ id: target.record.id, state: target.record.state })), ...jobs];
      this.drain();
      return { requested: requested || jobs.length > 0, state: this.get(id, record.runId).record.state,
        cleanup: jobs.some(job => job.cleanup === 'unconfirmed' || job.cleanup === 'pending') ? 'unconfirmed' : 'confirmed', affected };
    })().finally(() => this.stops.delete(stopKey));
    this.stops.set(stopKey, operation);
    return operation;
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    clearInterval(this.cleanupTimer); this.cleanupTimer = undefined;
    await Promise.all([...new Set(this.records().filter(record => active(record.state)).map(record => record.id))].map(id => this.stop(id)));
  }
}
