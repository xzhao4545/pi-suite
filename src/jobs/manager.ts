import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JobStore } from './store.ts';
import { resolveWorkspace } from './workspace.ts';
import { isTerminal, settleExit, canReleaseExclusive } from './state.ts';
import { launchCommand, stopCommand, stopCommandSync, type RunningCommand } from './process.ts';
import { JobError, LIMITS, type StartRequest, type JobSummary, type Workspace, type LogRequest, type LogPage, type WaitResult, type StopResult, type StopReason, type JobListReport } from './types.ts';

type OwnedJob = { job: JobSummary; run?: RunningCommand; processReady: Promise<void>; resolveReady: ()=>void; launchDone?: boolean; stopPromise?: Promise<StopResult>; stopDone?: boolean; cleanupSettled?: boolean; stopDeadline?: number; stopController?: AbortController; stopTimer?: ReturnType<typeof setTimeout>; saveQueue?: Promise<void>; pendingWrites?: number; revision?: number; savedRevision?: number; dirty?: boolean; persistenceError?: string; operationalError?: string; saveAttempts?: number; retryAt?: number; deleting?: boolean; removeAbort?: () => void; committed: boolean };
function abortError(): Error { return new DOMException('Operation aborted', 'AbortError'); }
export class JobManager {
  readonly runtimeId: string;
  readonly agentDir: string;
  private store: JobStore;
  private jobs = new Map<string, OwnedJob>();
  private locks = new Map<string, string>();
  private history = new Map<string, JobSummary>();
  private listeners = new Set<() => void>();
  private closing = false;
  private quitDeadline?: number;
  private shutdownPromise?: Promise<void>;
  private quitTimer?: ReturnType<typeof setTimeout>;
  private finishQuitWait?: ()=>void;
  private retimeQuitWait():void {
    if(this.quitTimer)clearTimeout(this.quitTimer);
    if(this.finishQuitWait)this.quitTimer=setTimeout(this.finishQuitWait,Math.max(0,this.quitDeadline!-Date.now()));
  }
  private monitor: ReturnType<typeof setInterval>;
  private monitoring = false;
  constructor(options: { agentDir: string; runtimeId: string }) {
    if (!/^run_[a-f0-9]{32}$/.test(options.runtimeId)) throw new JobError('INVALID_RUNTIME','Invalid runtime identity');
    this.runtimeId = options.runtimeId; this.agentDir = options.agentDir;
    this.store = new JobStore(options.agentDir);
    this.monitor = setInterval(() => { void this.monitorJobs(); }, LIMITS.monitorMs);
    this.monitor.unref();
  }
  private changed(): void { for (const listener of this.listeners) { try { listener(); } catch {} } }
  notificationCandidates(): JobSummary[] { return [...this.jobs.values()].filter(item=>!item.stopPromise||item.stopDone).map(({job})=>this.snapshot(job)); }
  subscribeChanged(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private snapshot(job: JobSummary): JobSummary { return structuredClone(job); }
  private validateId(id: string): void { if (!/^job_[a-f0-9]{32}$/.test(id)) throw new JobError('INVALID_JOB_ID','Invalid task ID'); }
  private owned(id: string): OwnedJob {
    this.validateId(id);
    const item = this.jobs.get(id);
    if (!item) throw new JobError(this.history.has(id) ? 'HISTORY_READ_ONLY' : 'UNKNOWN_JOB', 'No controllable task in current runtime', id);
    return item;
  }
  private release(item: OwnedJob): void {
    const job = item.job;
    if (canReleaseExclusive(job.cleanup.rootExited, job.stopReason, job.cleanup.state, item.run?.knownResidual ?? false)) {
      if (this.locks.get(job.workspace.key) === job.jobId) this.locks.delete(job.workspace.key);
      job.holdsLock = false;
    }
  }
  private storageError(item: OwnedJob): void {
    item.job.storageError = [item.operationalError, item.persistenceError].filter(Boolean).join('; ') || undefined;
  }
  private operationalError(item: OwnedJob, error: unknown): void {
    item.operationalError = String(error); this.storageError(item);
  }
  private persist(item: OwnedJob): Promise<void> {
    item.revision = (item.revision ?? 0) + 1; item.dirty = true;
    item.pendingWrites = (item.pendingWrites ?? 0) + 1;
    item.saveQueue = (item.saveQueue ?? Promise.resolve()).then(async () => {
      const revision = item.revision!;
      if ((item.savedRevision ?? 0) >= revision) return;
      // Read the latest state only when the serial writer owns the channel.
      const snapshot = this.snapshot(item.job); snapshot.storageError = item.operationalError;
      try {
        await this.store.saveMeta(snapshot);
        if (isTerminal(snapshot.state)) await this.store.saveResult(snapshot);
        item.savedRevision = revision;
        if (revision === item.revision) {
          item.dirty = false; item.persistenceError = undefined; item.saveAttempts = 0; item.retryAt = undefined;
          this.storageError(item);
        }
      } catch (error) {
        item.persistenceError = String(error); item.saveAttempts = (item.saveAttempts ?? 0) + 1;
        item.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(item.saveAttempts - 1, 5));
        this.storageError(item);
      }
    }).finally(() => { item.pendingWrites = (item.pendingWrites ?? 1) - 1; this.changed(); });
    return item.saveQueue;
  }
  private shortenStop(item:OwnedJob, deadline:number):void {
    item.stopDeadline=Math.min(item.stopDeadline??deadline,deadline,this.quitDeadline??deadline);
    if(item.stopTimer)clearTimeout(item.stopTimer);
    item.stopController??=new AbortController();
    if(item.run){item.run.cleanupDeadline=item.stopDeadline;item.run.cleanupSignal=item.stopController.signal;}
    const expired=()=>{item.run?.identityController?.abort();item.stopController?.abort();if(!item.cleanupSettled){item.job.cleanup.state='unconfirmed';item.job.cleanup.error='Cleanup deadline exhausted';void this.persist(item);this.changed();}};
    if(item.stopDeadline<=Date.now())expired();else item.stopTimer=setTimeout(expired,item.stopDeadline-Date.now());
  }
  async start(request: StartRequest, signal?: AbortSignal): Promise<JobSummary> {
    const seconds = request.timeoutSeconds ?? LIMITS.defaultRunSeconds;
    if (typeof request.command !== 'string' || !request.command.trim() || request.command.length > 32768 ||
      (request.name !== undefined && (typeof request.name !== 'string' || request.name.length > 80)) ||
      !Number.isInteger(seconds) || seconds < 1 || seconds > LIMITS.maxRunSeconds || typeof request.ownerSessionId !== 'string' || !request.ownerSessionId ||
      (request.exclusive !== undefined && typeof request.exclusive !== 'boolean')) throw new JobError('INVALID_START','Invalid start request');
    if (this.closing) throw new JobError('CLOSING','Runtime is closing');
    if (signal?.aborted) throw abortError();
    const workspace = await resolveWorkspace(request.cwd);
    if (await this.store.workspaceBytes(workspace) >= LIMITS.workspaceBytes) throw new JobError('WORKSPACE_CAPACITY','Workspace history capacity reached');
    // Atomic admission after all asynchronous checks, before any preparation or spawn.
    if (this.closing) throw new JobError('CLOSING','Runtime is closing');
    if (signal?.aborted) throw abortError();
    const exclusive = request.exclusive ?? true;
    if (exclusive && this.locks.has(workspace.key)) throw new JobError('WORKSPACE_BUSY','Workspace occupied by '+this.locks.get(workspace.key),this.locks.get(workspace.key));
    const id = 'job_' + randomUUID().replaceAll('-','');
    const dir = join(this.agentDir,'background-jobs',workspace.hash,this.runtimeId,id);
    const job: JobSummary = {schemaVersion:1, jobId:id, workspace, ownerRuntimeId:this.runtimeId, ownerSessionId:request.ownerSessionId,
      command:request.command, name:request.name ?? 'Background job', cwd:request.cwd, state:'starting', exclusive, holdsLock:exclusive,
      createdAt:new Date().toISOString(),timeoutSeconds:seconds,exitCode:null,cleanup:{state:'not_required',scope:[],rootExited:false},
      stdoutPath:join(dir,'stdout.log'),stderrPath:join(dir,'stderr.log'),history:false};
    let resolveReady!:()=>void;
    const processReady=new Promise<void>(resolve=>{resolveReady=resolve;});
    const item: OwnedJob = {job,committed:false,processReady,resolveReady};
    this.jobs.set(id,item);if (exclusive) this.locks.set(workspace.key,id);
    const onAbort = () => { void this.stop(id,'start_aborted').catch(() => {}); };
    signal?.addEventListener('abort',onAbort,{once:true});item.removeAbort=()=>signal?.removeEventListener('abort',onAbort);
    try {
      await this.store.create(job);
      if (signal?.aborted || this.closing || job.stopReason) throw signal?.aborted ? abortError() : new JobError('CLOSING','Launch cancelled before spawn',id);
      const launchController=new AbortController();
      const abortLaunch=()=>launchController.abort();
      signal?.addEventListener('abort',abortLaunch,{once:true});
      const unsubscribe=this.subscribeChanged(()=>{if(this.closing||job.stopReason)launchController.abort();});
      const installRun=(run:RunningCommand)=>{
       item.run=run;item.resolveReady();
       if(item.stopDeadline!==undefined)this.shortenStop(item,item.stopDeadline);
       job.startedAt=new Date(run.spawnedAt).toISOString();
       if(!isTerminal(job.state))job.state=job.stopReason?'stopping':'running';
       // Transfer ownership and observe exit before parent-fd cleanup or persistence.
       void run.exited.then(async exit => {
        job.exitCode=exit.code;job.endedAt=new Date().toISOString();
        if (!job.stopReason) job.cleanup={state:item.run!.knownResidual?'unconfirmed':'not_required',scope:[],rootExited:true};
        else job.cleanup.rootExited=true;
        if (exit.error) this.operationalError(item,exit.error);
        job.state=settleExit(exit,job.stopReason);this.release(item);
        await this.persist(item);this.changed();
       });
       this.changed();
      };
      try {item.run = await launchCommand({command:job.command,cwd:job.cwd,stdoutPath:job.stdoutPath,stderrPath:job.stderrPath,signal:launchController.signal,onSpawned:installRun});}
      finally{signal?.removeEventListener('abort',abortLaunch);unsubscribe();}
      if(item.run.resourceError)this.operationalError(item,item.run.resourceError);
      await this.persist(item);
    } catch (error) {
      if (!item.run) {
        job.state='failed';job.endedAt=new Date().toISOString();this.operationalError(item,error);
        job.cleanup={state:'not_required',scope:[],rootExited:true};
        if (this.locks.get(workspace.key)===id) this.locks.delete(workspace.key);job.holdsLock=false;
        item.removeAbort?.();
        // Register the repair before any I/O so retirement sees the pending save obligation.
        await this.persist(item);
      }
      throw error;
    } finally {item.resolveReady();item.launchDone=true;this.changed();}
    if (signal?.aborted || this.closing || job.stopReason) {
      await this.stop(id, signal?.aborted ? 'start_aborted' : 'quit',item.stopDeadline??this.quitDeadline??Date.now()+LIMITS.stopMs);
      throw new JobError('START_NOT_COMMITTED','Started task was cancelled before handoff; inspect '+id,id);
    }
    return this.snapshot(job);
  }
  commitStart(id: string): void { const item=this.owned(id);item.committed=true;item.removeAbort?.();item.removeAbort=undefined;this.changed(); }
  setNotificationError(id: string, error: string | undefined): void {
    const item=this.owned(id);if(item.job.notificationError===error)return;
    item.job.notificationError=error;this.changed();
  }
  async get(id: string): Promise<JobSummary> {
    this.validateId(id);
    const job=this.jobs.get(id)?.job ?? this.history.get(id);
    if(!job)throw new JobError('UNKNOWN_JOB','Unknown task',id);
    return this.snapshot(job);
  }
  async list(workspace: Workspace): Promise<JobSummary[]> { return (await this.listReport(workspace)).jobs; }
  async listReport(workspace: Workspace): Promise<JobListReport> {
    const report = await this.store.listReport(workspace);
    for (const [id, job] of this.history) if (job.workspace.key === workspace.key) this.history.delete(id);
    for (const job of report.jobs) if (!this.jobs.has(job.jobId)) this.history.set(job.jobId, job);
    const all = new Map(report.jobs.map(job => [job.jobId, job]));
    for (const item of this.jobs.values()) if (item.job.workspace.key === workspace.key) {
      all.set(item.job.jobId, item.job);
      if (item.persistenceError) report.diagnostics.push({ source: 'persistence', code: 'STORAGE_ERROR',
        message: item.persistenceError.slice(0, 1024), jobId: item.job.jobId, runtimeId: this.runtimeId,
        pending: !!item.dirty, attempts: item.saveAttempts, nextRetryAt: item.retryAt ? new Date(item.retryAt).toISOString() : undefined });
    }
    return { jobs: [...all.values()].map(job => this.snapshot(job)), diagnostics: report.diagnostics };
  }
  async logs(id: string, request: LogRequest): Promise<LogPage> { return this.store.readLogs(await this.get(id),request); }
  async wait(ids: string[], mode: 'any'|'all', timeoutSeconds?: number, signal?: AbortSignal): Promise<WaitResult> {
    ids=[...new Set(ids)];
    if (!ids.length || ids.length>50 || !['any','all'].includes(mode) || (timeoutSeconds!==undefined && (!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>86400))) throw new JobError('INVALID_WAIT','Invalid wait request');
    // Waiters own observation references, not map lookups that history deletion can invalidate.
    const watched=ids.map(id=>this.owned(id));
    if(signal?.aborted)throw abortError();
    return new Promise((resolve,reject)=>{
      let timer: ReturnType<typeof setTimeout>|undefined;
      const done=()=>{unsubscribe();signal?.removeEventListener('abort',abort);if(timer)clearTimeout(timer);};
      const result=(timedOut:boolean):WaitResult=>({completed:watched.map(item=>item.job).filter(job=>isTerminal(job.state)).map(job=>this.snapshot(job)),pending:watched.filter(item=>!isTerminal(item.job.state)).map(item=>item.job.jobId),timedOut});
      const check=()=>{const value=result(false);if(mode==='any'?value.completed.length>0:value.pending.length===0){done();resolve(value);}};
      const abort=()=>{done();reject(abortError());};
      const unsubscribe=this.subscribeChanged(check);
      signal?.addEventListener('abort',abort,{once:true});
      if(timeoutSeconds!==undefined)timer=setTimeout(()=>{const value=result(true);done();resolve(value);},timeoutSeconds*1000);
      check();
    });
  }
  async stop(id: string, reason: StopReason='user', deadline=Date.now()+LIMITS.stopMs): Promise<StopResult> {
    const item=this.owned(id),job=item.job;
    const warnings=['Forced termination may interrupt file writes. PID identity query and taskkill are not atomic (TOCTOU risk). Only the managed scope can be verified.'];
    if(item.stopPromise){if(!item.stopDone)this.shortenStop(item,deadline);const previous=await item.stopPromise;return {...previous,job:this.snapshot(job)};}
    if(isTerminal(job.state))return {job:this.snapshot(job),requested:false,warnings};
    job.stopReason ??= reason;job.state='stopping';job.cleanup.state='pending';
    // Install the promise before notifying observers or executing cleanup (reentrant-safe).
    item.stopPromise=Promise.resolve().then(async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        if(!item.run)await Promise.race([item.processReady,new Promise<never>((_,reject)=>{
          const abort=()=>reject(new Error('Cleanup deadline exhausted during launch'));
          item.stopController!.signal.addEventListener('abort',abort,{once:true});
          item.processReady.finally(()=>item.stopController!.signal.removeEventListener('abort',abort));
          if(item.stopController!.signal.aborted)abort();
          timer=setTimeout(abort,Math.max(0,(item.stopDeadline??deadline)-Date.now()));
        })]);
        if(item.run){
          const cleanup=await stopCommand(item.run,job.stopReason!,Math.min(deadline,item.stopDeadline??deadline));
          cleanup.rootExited ||= job.cleanup.rootExited;
          job.cleanup=cleanup;
        }
        else if(!isTerminal(job.state)) {job.state='failed';job.endedAt=new Date().toISOString();job.cleanup={state:'not_required',scope:[],rootExited:true};}
        item.cleanupSettled=true;if(item.stopTimer)clearTimeout(item.stopTimer);
        this.release(item);await this.persist(item);
      } catch(error){item.cleanupSettled=true;if(item.stopTimer)clearTimeout(item.stopTimer);job.cleanup.state='unconfirmed';job.cleanup.error=String(error);await this.persist(item);}
      finally{if(timer)clearTimeout(timer);if(item.stopTimer)clearTimeout(item.stopTimer);item.stopDone=true;item.removeAbort?.();this.changed();}
      return {job:this.snapshot(job),requested:true,warnings};
    });
    this.shortenStop(item,deadline);
    this.changed();
    return item.stopPromise;
  }
  async retryStop(id: string): Promise<StopResult> {
    if (this.closing) throw new JobError('CLOSING','Runtime is closing');
    const item = this.owned(id), run = item.run;
    if (item.stopPromise && !item.stopDone) return this.stop(id);
    if (!item.stopDone || item.job.cleanup.state !== 'unconfirmed' || !run || run.exitObserved || !run.rootIdentity) {
      throw new JobError('RETRY_UNSAFE','Retry requires a settled failed stop and the still-live original root identity; do not unlock or reclaim a historical PID',id);
    }
    // The preceding attempt has fully settled, so no old callback owns this state.
    item.stopPromise = undefined; item.stopDone = false; item.cleanupSettled = false;
    item.stopDeadline = undefined; item.stopController = new AbortController();
    return this.stop(id, item.job.stopReason ?? 'user');
  }
  async clear(id: string): Promise<void> {
    const job = await this.get(id), item = this.jobs.get(id);
    if (item && (!item.launchDone || item.stopPromise && !item.stopDone || item.deleting)) throw new JobError('JOB_OCCUPIED','Task lifecycle still pending',id);
    if (job.holdsLock || !isTerminal(job.state) || ['pending','unconfirmed'].includes(job.cleanup.state)) throw new JobError('JOB_OCCUPIED','Cannot delete active or unconfirmed job',id);
    if (item) item.deleting = true;
    try {
      await item?.saveQueue;
      if (item?.dirty) { await this.persist(item); if (item.dirty) throw new JobError('STORAGE_ERROR','Terminal result could not be saved before deletion',id); }
      await this.store.remove(job);
      item?.removeAbort?.(); this.jobs.delete(id); this.history.delete(id); this.changed();
    } finally { if (item) item.deleting = false; }
  }
  private async monitorJobs(): Promise<void> {
    if(this.monitoring || this.closing)return;this.monitoring=true;
    try {
      for(const item of this.jobs.values()) {
        const job=item.job;
        if (item.dirty && !item.pendingWrites && !item.deleting && isTerminal(job.state) && Date.now() >= (item.retryAt ?? 0)) void this.persist(item);
        if(isTerminal(job.state)&&job.cleanup.state!=='unconfirmed')continue;
        try {
          const bytes=await this.store.logBytes(job);
          if(!isTerminal(job.state)&&!job.stopReason) {
            if(bytes>=LIMITS.jobLogBytes)void this.stop(job.jobId,'log_limit').catch(()=>{});
            else if(job.startedAt&&Date.now()-Date.parse(job.startedAt)>=job.timeoutSeconds*1000)void this.stop(job.jobId,'timeout').catch(()=>{});
          }
        }catch(error){this.operationalError(item,error);if(item.run&&!isTerminal(job.state))void this.stop(job.jobId,'log_limit').catch(()=>{});this.changed();}
      }
    }finally{this.monitoring=false;}
  }
  async shutdown(deadline: number): Promise<void> {
    this.closing=true;clearInterval(this.monitor);
    this.quitDeadline=Math.min(this.quitDeadline??deadline,deadline);
    for(const item of this.jobs.values())if(item.stopPromise&&!item.stopDone)this.shortenStop(item,this.quitDeadline);
    if(this.shutdownPromise){this.retimeQuitWait();return this.shutdownPromise;}
    this.shutdownPromise=(async()=>{
      const active=[...this.jobs.values()].filter(item=>!item.launchDone||!isTerminal(item.job.state)||item.stopPromise&&!item.stopDone);
      const work=Promise.all(active.map(item=>this.stop(item.job.jobId,'quit',this.quitDeadline))).then(()=>Promise.all([...this.jobs.values()].map(item=>
        item.dirty && !item.pendingWrites && !item.deleting && Date.now() < this.quitDeadline! ? this.persist(item) : item.saveQueue)));
      try {await Promise.race([work,new Promise<void>(resolve=>{this.finishQuitWait=resolve;this.retimeQuitWait();})]);}
      finally{if(this.quitTimer)clearTimeout(this.quitTimer);this.finishQuitWait=undefined;}
      for(const item of active){
        if(!item.cleanupSettled&&item.job.cleanup.state==='pending'){
          item.job.cleanup.state='unconfirmed';item.job.cleanup.error='Shared quit deadline exhausted';item.stopController?.abort();void this.persist(item);
        }else if(!item.stopDone&&item.cleanupSettled)this.operationalError(item,'Result persistence still pending at shared quit deadline');
      }
    })();
    return this.shutdownPromise;
  }
  exitSync(deadline: number): void {
    this.closing=true;clearInterval(this.monitor);
    deadline=Math.min(deadline,Date.now()+LIMITS.exitFallbackMs,this.quitDeadline??deadline);
    for(const item of this.jobs.values()) {
      const job=item.job;
      if(isTerminal(job.state)&&job.cleanup.state!=='pending'&&job.cleanup.state!=='unconfirmed'&&!job.holdsLock&&!item.dirty)continue;
      const settled=isTerminal(job.state);
      if(!settled)job.stopReason ??='quit';
      if(item.run && !item.cleanupSettled && !(settled && !job.stopReason && job.cleanup.state==='not_required')) {
        job.cleanup=stopCommandSync(item.run,job.stopReason??'quit',Math.min(deadline,item.stopDeadline??deadline));
        if(job.cleanup.rootExited&&!settled){job.state=settleExit(item.run.exitObserved??{code:null,signal:null},job.stopReason);job.exitCode=item.run.exitObserved?.code??null;job.endedAt??=new Date().toISOString();}
        else if(!settled) job.state='stopping';
      } else if (!item.run && !settled) {job.cleanup.state='unconfirmed';job.cleanup.error='Process exit during startup; cleanup unconfirmed';}
      this.release(item);
      try{this.store.saveResultSync(job);}catch(error){this.operationalError(item,error);}
    }
  }
  hasOccupancy(): boolean { return [...this.jobs.values()].some(item=>!item.launchDone||item.dirty||!!item.pendingWrites||item.deleting||!isTerminal(item.job.state)||item.job.holdsLock||item.job.cleanup.state==='pending'||item.job.cleanup.state==='unconfirmed'); }
}
