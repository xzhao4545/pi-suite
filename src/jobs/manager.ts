// Adapted from pi-background-jobs 0.1.3 src/jobs.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite changes: pipe and PTY modes behind one Tracked handle; one job.json record; monotonic
// elapsed time; input records; creator ownership with cascading stop; no workspace exclusive lock.
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { JobStore } from './store.ts';
import { resolveWorkspace } from './workspace.ts';
import { isActive, isTerminal, settleExit } from './state.ts';
import { stopTracked, stopTrackedSync, type Tracked } from './backends/process.ts';
import { launchPipe } from './backends/pipe.ts';
import { launchPty } from './backends/pty-job.ts';
import type { ResolvedShellConfig } from './terminal/shell.ts';
import type { PtyTerminalSession } from './terminal/session.ts';
import { ToolError } from '../runtime/errors.ts';
import { compileMonitor, type CompiledMonitor } from './monitors/compile.ts';
import { JobMonitor, type MonitorEvent } from './monitors/runtime.ts';
import { compileHandsFree, HandsFreeSupervisor, type HandsFreeUpdate } from './monitors/hands-free.ts';
import { errnoCode, LIMITS, type InputRecord, type JobSummary, type StartRequest, type StopReason, type StopResult, type Stream, type Workspace } from './types.ts';

const JOB_ID = /^job_[a-f0-9]{8}$/;
type Owned = {
  job: JobSummary; run?: Tracked; launched: boolean; ready: PromiseWithResolvers<void>;
  stopPromise?: Promise<StopResult>; stopDone?: boolean; cleanupSettled?: boolean;
  stopDeadline?: number; stopController?: AbortController; stopTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  saveQueue: Promise<void>; dirty?: boolean; saveAttempts?: number; retryAt?: number; persistenceError?: string;
  inputQueue: Promise<void>;
  /** Set while the user types in the terminal view; model input is refused until control returns. */
  userControl?: boolean;
  watcher?: JobMonitor;
  supervisor?: HandsFreeSupervisor;
  pendingUpdate?: HandsFreeUpdate;
  /** Monitor events not yet delivered to the model, newest last, capped for the notice digest. */
  pendingEvents: MonitorEvent[];
};
/** Events kept for one notice; the count still covers every undelivered event. */
const NOTICE_EVENTS = 10;
const abortError = () => new DOMException('Operation aborted', 'AbortError');

/**
 * Process-lifetime owner of every job started in this Pi process. It never holds a Pi context:
 * sessions subscribe through JobsModule bindings, so reload/new/resume/fork only change who
 * listens, never whether a job runs.
 */
export class JobManager {
  readonly runtimeId: string;
  private store: JobStore;
  private jobs = new Map<string, Owned>();
  private listeners = new Set<() => void>();
  private stoppingCreators = new Set<string>();
  /** Jobs whose automatic wake was paused by Esc; their results arrive with the next user turn. */
  readonly quietWakes = new Set<string>();
  private closing = false;
  private quitDeadline?: number;
  private shutdownPromise?: Promise<void>;
  private monitor: NodeJS.Timeout;
  private monitoring = false;

  constructor(options: { agentDir: string; runtimeId: string }) {
    this.runtimeId = options.runtimeId;
    this.store = new JobStore(options.agentDir);
    this.monitor = setInterval(() => { void this.monitorJobs(); }, LIMITS.monitorMs);
    this.monitor.unref();
  }
  get closed(): boolean { return this.closing; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of [...this.listeners]) { try { listener(); } catch {} } }

  private view(item: Owned): JobSummary {
    const job = structuredClone(item.job);
    // Live elapsed is monotonic; endedAt fixes the saved value.
    if (item.run && job.endedAt === undefined) job.elapsedMs = Math.round(performance.now() - item.run.startedMonotonic);
    if (item.persistenceError) job.error = [job.error, `history not saved: ${item.persistenceError}`].filter(Boolean).join('; ');
    return job;
  }
  private setError(item: Owned, error: unknown): void {
    const text = String(error instanceof Error ? error.message : error).slice(0, 1024);
    item.job.error = item.job.error ? `${item.job.error}; ${text}` : text;
  }
  private persist(item: Owned): Promise<void> {
    item.dirty = true;
    item.saveQueue = item.saveQueue.then(async () => {
      if (!item.dirty) return;
      item.dirty = false;
      try {
        await this.store.save(item.job);
        item.persistenceError = undefined; item.saveAttempts = 0; item.retryAt = undefined;
      } catch (error) {
        item.dirty = true; item.persistenceError = String(error);
        item.saveAttempts = (item.saveAttempts ?? 0) + 1;
        item.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(item.saveAttempts - 1, 5));
      }
    }).finally(() => this.changed());
    return item.saveQueue;
  }

  async start(request: StartRequest, shell: ResolvedShellConfig, signal?: AbortSignal, authorize?: (command: string) => Promise<void>): Promise<JobSummary> {
    const mode = request.mode ?? 'pipe';
    const handsFree = request.handsFree ? compileHandsFree(request.handsFree, mode) : undefined;
    // A monitor decides the command the job runs: its poll loop, or a generated file watcher.
    const monitor: CompiledMonitor | undefined = request.monitor ? compileMonitor(request.monitor, request.command, shell) : undefined;
    const command = monitor?.command ?? request.command;
    if (!command?.trim() || command.length > 32768 || (request.name?.length ?? 0) > 80 ||
      (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > LIMITS.maxRunMs))) {
      throw new ToolError('INVALID_ARGS', 'command must be 1-32768 characters, name at most 80, timeoutMs 1-86400000');
    }
    this.admit(signal);
    // Authorize the actual generated monitor/CLI command, before allocating history or spawning.
    // The callback belongs to this start only; the long-lived manager never retains Pi contexts.
    await authorize?.(command);
    if (monitor?.detector) await authorize?.(monitor.detector.command);
    this.admit(signal);
    const workspace = await resolveWorkspace(request.cwd);
    if (await this.store.workspaceBytes(workspace) >= LIMITS.workspaceBytes) {
      throw new ToolError('WORKSPACE_CAPACITY', 'Workspace job history reached 1 GiB; clear finished jobs first');
    }
    this.admit(signal);
    const id = this.store.allocate(workspace);
    const job: JobSummary = {
      schemaVersion: 1, id, workspace, ownerRuntimeId: this.runtimeId, ownerSessionId: request.ownerSessionId,
      anchorEntryId: request.anchorEntryId,
      name: request.name?.trim() || (request.monitor?.fileWatch ? `watch ${request.monitor.fileWatch.path}` : command.trim().split('\n')[0]).slice(0, 80),
      command, cwd: request.cwd, mode, ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.creator ? { creator: request.creator } : {}),
      ...(request.monitor ? { monitor: { config: request.monitor, events: 0, notifiedEvents: 0 } } : {}),
      ...(handsFree ? { handsFree: { config: handsFree, updates: 0, notifiedUpdates: 0, totalCharsSent: 0 } } : {}),
      state: 'starting', createdAt: new Date().toISOString(),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}), exitCode: null,
      cleanup: { state: 'not_required', scope: [], rootExited: false },
    };
    const item: Owned = { job, launched: false, ready: Promise.withResolvers(), saveQueue: Promise.resolve(), inputQueue: Promise.resolve(), pendingEvents: [] };
    // Registered before any await so a concurrent creator stop or quit includes this job.
    this.jobs.set(id, item);
    if (this.creatorStopping(request.creator)) job.stopReason = 'agent';
    const onAbort = () => { void this.stop(id, 'start_aborted').catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.store.create(job);
      if (job.stopReason || this.closing || signal?.aborted) throw new ToolError('START_NOT_COMMITTED', 'Start cancelled before spawn', id);
      const run = mode === 'pty'
        ? await launchPty({ command: job.command, cwd: job.cwd, shell, outputPath: this.store.logPath(job, 'output'), cols: request.cols ?? 120, rows: request.rows ?? 30 })
        : await launchPipe({ command: job.command, cwd: job.cwd, shell, stdoutPath: this.store.logPath(job, 'stdout'), stderrPath: this.store.logPath(job, 'stderr') });
      this.install(item, run, monitor && { monitor, shell });
      await this.persist(item);
    } catch (error) {
      if (!item.run) {
        // Never spawned: no runtime to report and nothing to clean up.
        job.state = job.stopReason || error instanceof ToolError && error.code === 'START_NOT_COMMITTED' ? 'stopped' : 'failed';
        job.stopReason ??= job.state === 'stopped' ? (this.closing ? 'quit' : 'start_aborted') : undefined;
        job.endedAt = new Date().toISOString();
        job.cleanup = { state: 'not_required', scope: [], rootExited: true };
        if (job.state === 'failed') this.setError(item, error);
        await this.persist(item);
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      item.launched = true; item.ready.resolve(); this.changed();
    }
    if (job.stopReason || this.closing || signal?.aborted) {
      await this.stop(id, signal?.aborted ? 'start_aborted' : 'quit');
      throw new ToolError('START_NOT_COMMITTED', `Job was stopped during start; inspect with job_list({"id":"${id}"})`, id);
    }
    return this.view(item);
  }
  private admit(signal?: AbortSignal): void {
    if (this.closing) throw new ToolError('CLOSING', 'Pi is quitting; no new jobs');
    if (signal?.aborted) throw abortError();
  }
  private install(item: Owned, run: Tracked, watch?: { monitor: CompiledMonitor; shell: ResolvedShellConfig }): void {
    const job = item.job;
    item.run = run;
    job.startedAt = new Date(run.spawnedAt).toISOString();
    job.state = 'running';
    if (job.timeoutMs) {
      item.timeoutTimer = setTimeout(() => { void this.stop(job.id, 'timeout').catch(() => {}); }, job.timeoutMs);
      item.timeoutTimer.unref();
    }
    if (watch) {
      const streams: Stream[] = job.mode === 'pty' ? ['output'] : ['stdout', 'stderr'];
      item.watcher = new JobMonitor(watch.monitor, JobMonitor.sources(streams.map(stream => ({ path: this.store.logPath(job, stream), stream: stream as MonitorEvent['stream'] })), job.mode === 'pty'),
        watch.shell, job.cwd, candidate => this.recordEvent(item, candidate));
    }
    if (job.handsFree) item.supervisor = new HandsFreeSupervisor(run.terminal!, job.handsFree,
      update => { item.pendingUpdate = update; void this.persist(item); this.changed(); },
      () => { void this.stop(job.id, 'quiet'); });
    // Exit is the only settlement evidence; a stop request alone never settles the job.
    void run.exited.then(async exit => {
      clearTimeout(item.timeoutTimer);
      item.supervisor?.dispose();
      // A result replaces any queued progress snapshot; never wake twice for final output.
      item.pendingUpdate = undefined;
      this.changed();
      // The logs are flushed by now; the monitor matches the last lines before the job settles,
      // so a settled job never reports fewer events than its output holds.
      try { await item.watcher?.stop(); } catch (error) { this.setError(item, `monitor: ${String(error)}`); }
      job.exitCode = exit.code; job.signal = exit.signal;
      job.endedAt = new Date().toISOString();
      job.elapsedMs = Math.round(performance.now() - run.startedMonotonic);
      if (exit.error) this.setError(item, exit.error);
      if (job.stopReason) job.cleanup.rootExited = true;
      else { job.cleanup = { state: run.knownResidual ? 'unconfirmed' : 'not_required', scope: [], rootExited: true }; run.dispose(); }
      job.state = settleExit(exit, job.stopReason);
      if (job.handsFree) job.completionReason = job.stopReason === 'quiet' ? 'quiet' : job.stopReason === 'timeout' ? 'timeout' : job.stopReason ? 'stopped' : 'exited';
      void this.persist(item);
      this.changed();
    });
    this.changed();
  }
  private recordEvent(item: Owned, candidate: Omit<MonitorEvent, 'eventId' | 'at'>): void {
    const monitor = item.job.monitor!;
    const event: MonitorEvent = { eventId: ++monitor.events, at: new Date().toISOString(), ...candidate };
    item.pendingEvents = [...item.pendingEvents, event].slice(-NOTICE_EVENTS);
    item.inputQueue = item.inputQueue.then(() => this.store.appendEvent(item.job, event)).catch(error => { this.setError(item, `monitor event not saved: ${String(error)}`); this.changed(); });
    void this.persist(item);
    this.changed();
  }

  /** Repeated calls join the stop in progress; a settled job returns its existing result. */
  stop(id: string, reason: StopReason = 'user', deadline = Date.now() + LIMITS.stopMs): Promise<StopResult> {
    const item = this.owned(id), job = item.job;
    if (item.stopPromise) {
      if (!item.stopDone) this.shortenStop(item, deadline);
      return item.stopPromise.then(() => ({ job: this.view(item), requested: true }));
    }
    if (item.launched && isTerminal(job.state)) return Promise.resolve({ job: this.view(item), requested: false });
    job.stopReason ??= reason;
    item.supervisor?.dispose(); item.pendingUpdate = undefined;
    if (!isTerminal(job.state)) job.state = 'stopping';
    job.cleanup.state = 'pending';
    item.stopController = new AbortController();
    // Installed before observers run, so re-entrant stops join this one.
    item.stopPromise = Promise.resolve().then(() => this.runStop(item));
    this.shortenStop(item, deadline);
    this.changed();
    return item.stopPromise;
  }
  private async runStop(item: Owned): Promise<StopResult> {
    const job = item.job;
    try {
      await this.untilLaunched(item);
      const run = item.run;
      if (run) {
        run.cleanupDeadline = item.stopDeadline; run.cleanupSignal = item.stopController!.signal;
        const cleanup = await stopTracked(run, item.stopDeadline!);
        cleanup.rootExited ||= job.cleanup.rootExited || !!run.exitObserved;
        job.cleanup = cleanup;
      } else job.cleanup = { state: 'not_required', scope: [], rootExited: true };
    } catch (error) {
      job.cleanup.state = 'unconfirmed'; job.cleanup.error = String(error);
    } finally {
      item.cleanupSettled = true; item.stopDone = true; clearTimeout(item.stopTimer);
      await this.persist(item);
    }
    return { job: this.view(item), requested: true };
  }
  private async untilLaunched(item: Owned): Promise<void> {
    if (item.launched) return;
    const signal = item.stopController!.signal;
    const aborted = Promise.withResolvers<never>();
    const abort = () => aborted.reject(new Error('Cleanup deadline exhausted during launch'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try { await Promise.race([item.ready.promise, aborted.promise]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  private shortenStop(item: Owned, deadline: number): void {
    item.stopDeadline = Math.min(item.stopDeadline ?? deadline, deadline, this.quitDeadline ?? deadline);
    if (item.run) item.run.cleanupDeadline = item.stopDeadline;
    clearTimeout(item.stopTimer);
    const expired = () => {
      item.run?.identityController?.abort(); item.stopController?.abort();
      if (!item.cleanupSettled) {
        item.job.cleanup.state = 'unconfirmed'; item.job.cleanup.error = 'Cleanup deadline exhausted';
        void this.persist(item); this.changed();
      }
    };
    const delay = item.stopDeadline - Date.now();
    if (delay <= 0) expired(); else item.stopTimer = setTimeout(expired, delay);
  }

  /** Stop every job created by these agent runs or their descendants, including detached ones. */
  async stopCreatedBy(runIds: string[]): Promise<StopResult[]> {
    for (const runId of runIds) this.stoppingCreators.add(runId);
    const targets = [...this.jobs.values()].filter(item => this.creatorStopping(item.job.creator));
    return Promise.all(targets.map(item => this.stop(item.job.id, 'agent')));
  }
  private creatorStopping(creator: StartRequest['creator']): boolean {
    return !!creator && [creator.runId, ...creator.ancestors].some(runId => this.stoppingCreators.has(runId));
  }

  /** Input goes to the program first; the record is written after and only proves it was sent. */
  write(id: string, data: string, record: Omit<InputRecord, 'at' | 'bytes'>): JobSummary {
    const item = this.owned(id), job = item.job, run = item.run;
    if (!run || run.exitObserved || job.state !== 'running') throw new ToolError('NOT_RUNNING', `${id} is ${job.state} and does not accept input`, id);
    if (item.userControl && record.source !== 'user') throw new ToolError('USER_CONTROL', `The user controls ${id} in the terminal view; wait until control returns`, id);
    try { run.write(data); } catch (error) { throw new ToolError('NOT_RUNNING', String(error instanceof Error ? error.message : error), id); }
    if (record.source === 'user' && !item.userControl) {
      item.userControl = true; item.supervisor?.pause(); item.pendingUpdate = undefined; this.changed();
    } else if (record.source !== 'user') item.supervisor?.input();
    const entry: InputRecord = { at: new Date().toISOString(), ...record, bytes: Buffer.byteLength(data) };
    if (entry.sensitive) delete entry.text;
    item.inputQueue = item.inputQueue.then(() => this.store.appendInput(job, entry)).catch(error => { this.setError(item, `input record not saved: ${String(error)}`); this.changed(); });
    return this.view(item);
  }
  /** Close pipe stdin so programs that read to end of input can finish. */
  endInput(id: string): JobSummary {
    const item = this.owned(id);
    if (!item.run?.endInput || item.run.exitObserved) throw new ToolError('NOT_RUNNING', `${id} has no open stdin`, id);
    item.run.endInput();
    return this.view(item);
  }
  resize(id: string, cols: number, rows: number): void { this.owned(id).run?.resize?.(cols, rows); }
  terminal(id: string): PtyTerminalSession | undefined { return this.jobs.get(id)?.run?.terminal; }
  userControlled(id: string): boolean { return !!this.jobs.get(id)?.userControl; }
  /** Hand input back to the model (Ctrl+G or leaving the terminal view). */
  returnControl(id: string): void {
    const item = this.jobs.get(id);
    if (item?.userControl) { item.userControl = false; item.supervisor?.resume(); this.changed(); }
  }

  private owned(id: string): Owned {
    if (!JOB_ID.test(id)) throw new ToolError('INVALID_ARGS', 'id must look like job_1a2b3c4d');
    const item = this.jobs.get(id);
    if (!item) throw new ToolError('HISTORY_READ_ONLY', `${id} is not controlled by this Pi process; history can still be read`, id);
    return item;
  }
  isLive(id: string): boolean { return this.jobs.has(id); }
  /** Current view of a job this process controls; throws for unknown or history-only IDs. */
  peek(id: string): JobSummary { return this.view(this.owned(id)); }
  async get(id: string, workspace: Workspace): Promise<{ job: JobSummary; live: boolean }> {
    if (!JOB_ID.test(id)) throw new ToolError('INVALID_ARGS', 'id must look like job_1a2b3c4d');
    const item = this.jobs.get(id);
    if (item) return { job: this.view(item), live: true };
    try { return { job: await this.store.load(workspace, id), live: false }; }
    catch (error) {
      if (errnoCode(error) === 'ENOENT') throw new ToolError('NOT_FOUND', `No job ${id} in this workspace`, id);
      throw error;
    }
  }
  async list(workspace: Workspace): Promise<{ jobs: { job: JobSummary; live: boolean }[]; errors: string[] }> {
    const stored = await this.store.list(workspace);
    const all = new Map(stored.jobs.map(job => [job.id, { job, live: false }]));
    for (const item of this.jobs.values()) if (item.job.workspace.key === workspace.key) all.set(item.job.id, { job: this.view(item), live: true });
    return { jobs: [...all.values()], errors: stored.errors };
  }
  logPath(job: JobSummary, stream: Stream): string { return this.store.logPath(job, stream); }
  markNotified(id: string): void {
    const item = this.jobs.get(id);
    if (!item || item.job.notified) return;
    item.job.notified = true; void this.persist(item);
  }
  activeIds(sessionId: string): string[] {
    return [...this.jobs.values()].filter(item => item.job.ownerSessionId === sessionId && isActive(item.job)).map(item => item.job.id);
  }
  /** Settled, unnotified jobs; JobsModule decides session and branch eligibility. */
  unnotified(): JobSummary[] {
    return [...this.jobs.values()].filter(item => item.launched && isTerminal(item.job.state) && !item.job.notified && (!item.stopPromise || item.stopDone)).map(item => this.view(item));
  }
  /** Jobs with monitor events the model has not seen, with the newest of them for the notice. */
  unseenEvents(): { job: JobSummary; count: number; recent: MonitorEvent[] }[] {
    return [...this.jobs.values()].filter(item => item.job.monitor && item.job.monitor.events > item.job.monitor.notifiedEvents)
      .map(item => ({ job: this.view(item), count: item.job.monitor!.events - item.job.monitor!.notifiedEvents, recent: item.pendingEvents }));
  }
  /** Events up to upTo were delivered (notice or wait); later events stay pending. */
  markEventsNotified(id: string, upTo: number): void {
    const item = this.jobs.get(id), monitor = item?.job.monitor;
    if (!monitor || upTo <= monitor.notifiedEvents) return;
    monitor.notifiedEvents = Math.min(upTo, monitor.events);
    item.pendingEvents = item.pendingEvents.filter(event => event.eventId > monitor.notifiedEvents);
    void this.persist(item);
  }
  /** One latest update per job; bounded output is charged when produced, including replacements. */
  unseenUpdates(): { job: JobSummary; update: HandsFreeUpdate }[] {
    return [...this.jobs.values()].filter(item => item.pendingUpdate && item.pendingUpdate.updateId > item.job.handsFree!.notifiedUpdates)
      .map(item => ({ job: this.view(item), update: item.pendingUpdate! }));
  }
  markUpdateNotified(id: string, upTo: number): void {
    const item = this.owned(id), state = item.job.handsFree!;
    if (upTo <= state.notifiedUpdates) return;
    state.notifiedUpdates = Math.min(upTo, state.updates);
    if (item.pendingUpdate && item.pendingUpdate.updateId <= state.notifiedUpdates) item.pendingUpdate = undefined;
    void this.persist(item);
  }

  private async monitorJobs(): Promise<void> {
    if (this.monitoring || this.closing) return;
    this.monitoring = true;
    try {
      for (const item of this.jobs.values()) {
        if (item.dirty && item.retryAt !== undefined && Date.now() >= item.retryAt) void this.persist(item);
        if (!item.run || item.job.state !== 'running') continue;
        try { if (await this.store.logBytes(item.job) >= LIMITS.jobLogBytes) void this.stop(item.job.id, 'log_limit').catch(() => {}); }
        catch (error) { this.setError(item, error); this.changed(); }
      }
    } finally { this.monitoring = false; }
  }

  /** Quit: close admission synchronously, stop every live job under one shared deadline. */
  shutdown(deadline: number): Promise<void> {
    this.closing = true; clearInterval(this.monitor);
    this.quitDeadline = Math.min(this.quitDeadline ?? deadline, deadline);
    for (const item of this.jobs.values()) if (item.stopPromise && !item.stopDone) this.shortenStop(item, this.quitDeadline);
    this.shutdownPromise ??= (async () => {
      const active = [...this.jobs.values()].filter(item => !item.launched || !isTerminal(item.job.state) || item.stopPromise && !item.stopDone);
      const work = Promise.all(active.map(item => this.stop(item.job.id, 'quit', this.quitDeadline).catch(() => {})))
        .then(() => Promise.all([...this.jobs.values()].map(item => item.dirty ? this.persist(item) : item.saveQueue)));
      await Promise.race([work, sleep(Math.max(0, this.quitDeadline! - Date.now()), undefined, { ref: false })]);
    })();
    return this.shutdownPromise;
  }
  /** process 'exit' fallback: synchronous stop and save for anything quit did not settle. */
  exitSync(deadline: number): void {
    this.closing = true; clearInterval(this.monitor);
    deadline = Math.min(deadline, Date.now() + LIMITS.exitFallbackMs, this.quitDeadline ?? deadline);
    for (const item of this.jobs.values()) {
      const job = item.job;
      const unsettled = !isTerminal(job.state) || job.cleanup.state === 'pending' || job.cleanup.state === 'unconfirmed' && !job.cleanup.rootExited;
      if (!unsettled && !item.dirty) continue;
      if (unsettled && item.run && !item.cleanupSettled) {
        job.stopReason ??= 'quit';
        job.cleanup = stopTrackedSync(item.run, deadline);
        if (!isTerminal(job.state)) {
          job.state = job.cleanup.rootExited ? settleExit(item.run.exitObserved ?? { code: null, signal: null }, job.stopReason) : 'stopping';
          job.endedAt ??= new Date().toISOString();
        }
      } else if (unsettled && !item.run) { job.cleanup.state = 'unconfirmed'; job.cleanup.error = 'Pi exited during job startup'; }
      try { this.store.saveSync(job); } catch {}
    }
  }
  hasOccupancy(): boolean {
    return [...this.jobs.values()].some(item => !item.launched || item.dirty || isActive(item.job));
  }
}
