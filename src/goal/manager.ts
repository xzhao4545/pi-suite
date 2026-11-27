import { randomUUID } from 'node:crypto';
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent, SessionStartEvent, SessionShutdownEvent } from '@earendil-works/pi-coding-agent';
import type { SessionBinding, Binding } from '../runtime/binding.ts';
import { isQuestion, type Notifications } from '../runtime/notifications.ts';
import type { StatusPublisher } from '../ui/status.ts';
import type { AskResult } from '../ask/schema.ts';
import type { WaitRegistry } from '../runtime/wait.ts';
import { ToolError } from '../runtime/errors.ts';
import { GoalActivity, autoStopMessage } from './activity.ts';
import { GOAL_CONTINUATION } from './context.ts';
import { importGoal } from './snapshot.ts';
import { goalStore, type GoalStore } from './store.ts';
import { goalSummary, requiresExplicitResume, type Goal, type PauseKind, type Schedule } from './state.ts';
import { GoalWaitResources } from './wait.ts';

export class GoalManager {
  goal?: Goal;
  schedule: Schedule = 'detached';
  readonly activity = new GoalActivity();
  private store?: GoalStore;
  private unsubscribe?: () => void;
  private writing = false;
  private fault = false;
  private runGoalId?: string;
  private runRevision?: number;
  private runBinding?: Binding;
  private runAccess?: 'execute' | 'complete';
  private runSignal?: AbortSignal;
  private runningSince?: number;
  private pendingElapsed = 0;
  private lastError?: string;
  private readonly waitResources: GoalWaitResources;
  private completedTimer?: NodeJS.Timeout;
  private clock?: NodeJS.Timeout;
  private controlRevision = 0;
  private runControlRevision = 0;

  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications, private status: StatusPublisher,
    private waits: WaitRegistry) {
    this.waitResources = new GoalWaitResources(binding, waits);
    // A paused or completed goal does not hold results: the woken turn gets access "none",
    // so it handles the notification without resuming. The exception is a pause from a
    // cancelled ask: the user asked the model to stop and wait, so results stay queued and
    // join the user's next message instead of starting a turn behind the user's back.
    // While running, direct child questions and selected monitor/update events can wake an
    // arranged wait; unrelated settlements remain queued until all requested objects settle.
    notifications.setAdmission(ids => {
      const goal = this.goal;
      if (this.fault) return false;
      if (goal?.status === 'paused' && goal.reason?.kind === 'cancelled' && goal.reason.wait?.waiting === 'user') return false;
      if (!goal || goal.status !== 'active' || !goal.automatic) return true;
      return goal.waiting !== 'user' && (!goal.waitFor ||
        ids.some(id => isQuestion(id) || goal.waitFor!.some(waited => id === `job:${waited}:monitor` || id === `job:${waited}:update`)));
    });
  }
  private get requestId(): string { return `goal:${this.goal!.id}`; }
  private get owned(): boolean {
    return Boolean(this.goal && this.runGoalId === this.goal.id && this.runRevision === this.goal.revision && this.runBinding && this.binding.isCurrent(this.runBinding));
  }
  private get executing(): boolean { return this.owned && this.runAccess === 'execute' && this.goal?.status === 'active'; }
  private currentAccess(ctx: ExtensionContext, signal?: AbortSignal): boolean {
    return Boolean(!this.fault && this.owned && this.runAccess && this.runControlRevision === this.controlRevision && !signal?.aborted && !this.runSignal?.aborted &&
      !ctx.signal?.aborted && (!this.runSignal || ctx.signal === this.runSignal) && ctx.sessionManager.getSessionId() === this.binding.current?.sessionId);
  }
  contextView(ctx: ExtensionContext): { goal: Goal; access: 'execute' | 'complete' } | undefined {
    if (!this.currentAccess(ctx)) return;
    return { goal: this.goal!, access: this.executing ? 'execute' : 'complete' };
  }
  get control(): number { return this.controlRevision; }
  private cancelRequest(): void {
    if (this.goal && this.binding.current) this.notifications.cancel(this.binding.current.sessionId, this.requestId);
  }
  private elapsed(): void {
    if (this.runningSince !== undefined) this.pendingElapsed += Math.max(0, performance.now() - this.runningSince);
    this.runningSince = undefined;
  }
  /** Ticks only read the open segment; lifecycle commits fold it into the current file. */
  get elapsedMs(): number {
    return (this.goal?.elapsedMs ?? 0) + this.pendingElapsed + (this.runningSince === undefined ? 0 : Math.max(0, performance.now() - this.runningSince));
  }
  private transition(schedule: Schedule): void {
    this.elapsed(); this.schedule = schedule;
    if (schedule === 'running' && this.goal?.status === 'active') this.runningSince = performance.now();
    if (!this.writing) this.publish();
  }
  private fail(error: unknown): void {
    this.fault = true; this.cancelRequest(); this.disarmWait(); this.runAccess = undefined;
    this.transition('idle');
    this.binding.current?.ctx.ui.notify(String(error), 'error');
  }
  /** Every semantic mutation runs against the locked, latest state, not a cached snapshot.
   * Hold shared delivery until commit: a failed write must never start a new model request. */
  private async change<T>(apply: () => T, signal?: AbortSignal): Promise<T> {
    if (!this.store) await this.restore(this.binding.current!.ctx, 'new');
    const store = this.store!, captured = this.binding.current!, expected = store.current;
    const release = this.notifications.hold();
    let entered = false, applied = false;
    try {
      const result = await store.change(expected, data => {
        if (!this.binding.isCurrent(captured) || this.store !== store) throw new ToolError('STALE_BINDING', 'The session changed during this call; retry in the current session');
        this.writing = true; entered = true; this.goal = data.goal ?? undefined; this.controlRevision = data.control;
        const result = apply(); applied = true;
        this.elapsed();
        if (this.goal) this.goal.elapsedMs += this.pendingElapsed;
        this.pendingElapsed = 0;
        data.goal = this.goal ?? null; data.control = this.controlRevision;
        return result;
      }, signal);
      // An atomic write may finish after a session switch; its result still belongs
      // to the captured store and must not replace the new binding's UI or authority.
      if (!this.binding.isCurrent(captured) || this.store !== store) throw new ToolError('STALE_BINDING', 'The session changed during this call; retry in the current session');
      this.fault = false; this.goal = store.current.goal ?? undefined; this.controlRevision = store.current.control;
      if (this.schedule === 'running' && this.goal?.status === 'active') this.runningSince = performance.now();
      this.publish();
      return result;
    } catch (error) {
      if (this.binding.isCurrent(captured) && this.store === store) {
        this.goal = store.current.goal ?? undefined; this.controlRevision = store.current.control;
        // Domain rejection (wrong goal ID, expired audit, invalid command) is a normal
        // tool/command error. Only storage/binding failures revoke automatic delivery.
        if (!entered || applied) this.fail(error);
      }
      throw error;
    } finally { this.writing = false; release(); }
  }
  private publish(): void {
    this.status.setGoal(goalSummary(this.goal, this.schedule, Date.now(), this.elapsedMs));
    const ticking = this.goal?.status === 'active' && this.schedule === 'running' && this.status.goalVisible && this.binding.current?.ctx.mode === 'tui';
    if (!ticking) { clearInterval(this.clock); this.clock = undefined; }
    else if (!this.clock) {
      const captured = this.binding.current!, goalId = this.goal!.id;
      this.clock = setInterval(() => { if (this.binding.isCurrent(captured) && this.goal?.id === goalId) this.publish(); }, 1000);
      this.clock.unref();
    }
  }
  async restore(ctx: ExtensionContext, reason: SessionStartEvent['reason'] | 'tree'): Promise<void> {
    this.detach();
    const captured = this.binding.current!, store = this.store = goalStore(ctx);
    try {
      await store.initialize(() => reason === 'new' || reason === 'fork' ? undefined : importGoal(ctx));
      await store.snapshot();
      if (!this.binding.isCurrent(captured)) return;
      this.goal = store.current.goal ?? undefined; this.controlRevision = store.current.control; this.fault = false;
      this.unsubscribe = store.subscribe(() => {
        if (!this.binding.isCurrent(captured) || this.store !== store || this.writing) return;
        const next = store.current;
        const changed = this.goal?.id !== next.goal?.id || this.goal?.revision !== next.goal?.revision || this.controlRevision !== next.control;
        if (changed) { this.cancelRequest(); this.disarmWait(); this.runAccess = undefined; this.activity.reset(); this.pendingElapsed = 0; this.runningSince = undefined; }
        this.goal = next.goal ?? undefined; this.controlRevision = next.control;
        if (changed) this.transition('idle'); else this.publish();
      }, error => this.fail(error));
      if (reason === 'startup' && this.goal && this.goal.status !== 'completed') await this.change(() => this.pauseFor('startup'));
      this.transition(this.goal?.waiting === 'user' ? 'waiting_user' : this.goal?.waiting === 'jobs' ? 'waiting_jobs' : 'idle');
      if (this.goal?.status === 'active' && this.goal.automatic) {
        if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) await this.change(() => this.pauseFor('budget'));
        else if (!this.goal.waiting) this.request(); else this.armWait();
      }
      this.armCompletion();
    } catch (error) { this.fail(error); throw error; }
  }
  detach(): void {
    this.activity.reset(); this.cancelRequest(); this.elapsed(); this.disarmWait();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    clearTimeout(this.completedTimer); this.completedTimer = undefined;
    clearInterval(this.clock); this.clock = undefined;
    this.runGoalId = undefined; this.runRevision = undefined; this.runBinding = undefined; this.runAccess = undefined; this.runSignal = undefined;
    this.schedule = 'detached'; this.status.setGoal(undefined); this.pendingElapsed = 0;
  }
  async shutdown(reason: SessionShutdownEvent['reason']): Promise<void> {
    try {
      if (this.goal && this.schedule !== 'detached') await this.change(() => { if (reason === 'quit' && this.goal!.status !== 'completed') this.pauseFor('shutdown'); });
    } finally { this.detach(); }
  }
  async start(text: string, ctx: ExtensionContext, budget?: number): Promise<void> {
    await this.change(() => {
      const abortOldRun = this.owned && !ctx.isIdle();
      this.activity.reset(); this.cancelRequest(); this.elapsed(); this.disarmWait(); clearTimeout(this.completedTimer);
      this.pendingElapsed = 0; this.controlRevision++;
      this.goal = { id: randomUUID(), revision: 0, text, budget, status: 'active', automatic: true, usedTokens: 0, elapsedMs: 0, turns: 0, progress: '' };
      this.transition('idle'); if (abortOldRun) ctx.abort(); this.request();
    });
  }
  async edit(text: string | undefined, budget: number | undefined, ctx: ExtensionContext): Promise<void> {
    await this.change(() => {
      if (!this.goal) throw new Error('No goal to edit');
      const abortOldRun = this.owned && text !== undefined && !ctx.isIdle();
      if (text !== undefined) { this.activity.reset(); this.cancelRequest(); this.goal.text = text; this.goal.revision++; if (this.goal.waiting === 'jobs') this.clearWait(); }
      if (budget !== undefined) this.goal.budget = budget;
      if (this.goal.status === 'active' && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) { this.pauseFor('budget'); if (this.owned) ctx.abort(); }
      if (abortOldRun) ctx.abort();
      if (text !== undefined && this.goal.status === 'active' && this.goal.automatic) this.request();
    });
  }
  async pause(ctx: ExtensionContext): Promise<void> {
    await this.change(() => {
      if (!this.goal) throw new Error('No goal to pause');
      if (this.goal.status === 'completed' || this.goal.status === 'paused' && this.goal.reason?.kind === 'manual') return;
      this.pauseFor('manual'); if (this.owned) ctx.abort();
    });
  }
  captureBinding(ctx: ExtensionContext): Binding | undefined {
    const current = this.binding.current;
    return current?.sessionId === ctx.sessionManager.getSessionId() ? current : undefined;
  }
  isCurrent(captured: Binding): boolean { return this.binding.isCurrent(captured); }
  async resume(): Promise<'running' | 'scheduled' | 'waiting_host'> {
    return this.change(() => {
      if (!this.goal || this.goal.status === 'completed') throw new Error('No unfinished goal to resume');
      if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) throw new Error('Raise the token budget above current usage before resuming');
      if (this.owned && this.schedule === 'running' && this.goal.status === 'active' && this.goal.automatic) return 'running';
      this.activity.reset(); this.controlRevision++;
      this.goal.status = 'active'; this.goal.automatic = true; delete this.goal.reason;
      this.clearWait(); delete this.goal.error; this.transition('idle'); this.request();
      return this.binding.current?.ctx.isIdle() ? 'scheduled' : 'waiting_host';
    });
  }
  async clear(ctx: ExtensionContext): Promise<void> {
    await this.change(() => {
      const abortRun = this.owned;
      this.activity.reset(); this.controlRevision++; this.cancelRequest(); this.elapsed(); this.disarmWait(); clearTimeout(this.completedTimer);
      this.goal = undefined; this.pendingElapsed = 0; this.transition('idle'); if (abortRun) ctx.abort();
    });
  }
  private pauseFor(kind: PauseKind, error?: string): void {
    this.activity.reset(); this.cancelRequest(); this.controlRevision++;
    const goal = this.goal!;
    const wait = goal.waiting ? { waiting: goal.waiting, resumeAt: goal.resumeAt, waitFor: goal.waitFor } : goal.reason?.wait;
    const previous = kind === 'shutdown' || kind === 'startup' ? goal.reason?.kind : goal.reason?.previous;
    const automaticStop = goal.reason?.automaticStop;
    goal.status = 'paused'; goal.automatic = false;
    goal.reason = { kind, ...previous ? { previous } : {}, ...automaticStop ? { automaticStop } : {}, ...wait ? { wait } : {} };
    if (error) goal.error = error;
    this.clearWait(); this.transition('idle');
  }
  private request(): void {
    const goal = this.goal, current = this.binding.current;
    if (!goal || !current || goal.status !== 'active' || !goal.automatic || goal.waiting || this.fault) return;
    const revision = goal.revision, control = this.controlRevision;
    this.notifications.enqueue(current.sessionId, this.requestId, GOAL_CONTINUATION, () => {
      if (this.binding.isCurrent(current) && this.goal?.id === goal.id && this.goal.revision === revision && this.controlRevision === control) this.activity.delivered();
    }, 'goal-continuation');
  }
  async beforeStart(userInput: boolean): Promise<boolean> {
    if (!this.store) return false;
    await this.store.snapshot();
    if (!this.store.current.goal) return false;
    return this.change(() => {
      const goal = this.goal;
      if (userInput) {
        this.activity.reset();
        if (goal?.status === 'paused' && !requiresExplicitResume(goal.reason!.kind)) {
          this.controlRevision++;
          goal.status = 'active'; goal.automatic = true; delete goal.reason;
        }
      }
      this.runControlRevision = this.controlRevision;
      this.runAccess = goal?.status === 'active' && goal.automatic ? 'execute' : goal && userInput ? 'complete' : undefined;
      this.runGoalId = this.runAccess ? goal!.id : undefined; this.runRevision = goal?.revision; this.runBinding = this.binding.current;
      if (this.executing) { this.cancelRequest(); this.clearWait(); }
      return this.owned;
    });
  }
  async startRun(ctx?: ExtensionContext): Promise<void> {
    if (!this.owned) return;
    await this.change(() => {
      const nextSignal = ctx?.signal;
      if (nextSignal !== this.runSignal) {
        if (this.runControlRevision !== this.controlRevision && this.goal?.status === 'active' && this.goal.automatic) this.runAccess = 'execute';
        this.runControlRevision = this.controlRevision;
      }
      this.runSignal = nextSignal;
      if (!this.executing) return;
      this.lastError = undefined; this.activity.start(); this.cancelRequest();
      if (this.goal?.waiting === 'jobs') this.clearWait(); this.transition('running');
    });
  }
  endRun(error?: string): void {
    if (!this.executing) return;
    this.lastError = error; if (!this.goal!.waiting) this.transition('waiting_host');
  }
  async messageEnd(event: MessageEndEvent, ctx: ExtensionContext): Promise<void> {
    const id = this.runGoalId, captured = this.runBinding, store = this.store;
    if (!id || !captured || !store || !this.binding.isCurrent(captured) || ctx.sessionManager.getSessionId() !== captured.sessionId || event.message.role !== 'assistant') return;
    this.lastError = event.message.stopReason === 'error' ? event.message.errorMessage ?? 'Model request failed' : undefined;
    try { await store.account(id, event.message.usage.totalTokens, () => this.binding.isCurrent(captured) && this.store === store); }
    catch (error) {
      if (this.binding.isCurrent(captured) && this.store === store) this.fail(error);
      throw error;
    }
    if (!this.binding.isCurrent(captured) || this.store !== store) return;
    if (this.goal?.id === id && this.goal.status === 'active' && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) {
      await this.change(() => this.pauseFor('budget')); ctx.abort();
    }
  }
  async beforeSettle(event: AgentBeforeSettleEvent): Promise<void> {
    if (!this.executing || this.runControlRevision !== this.controlRevision) return;
    if (event.outcome === 'error' || event.continue || event.context?.pendingMessages.length) { this.cancelRequest(); this.transition('waiting_host'); return; }
    if (event.outcome === 'aborted') return;
    await this.change(() => {
      if (!this.goal!.waiting && this.goal!.automatic) {
        const reason = this.activity.finish();
        if (reason) { this.pauseFor(reason); this.binding.current?.ctx.ui.notify(autoStopMessage[reason], 'warning'); return; }
        this.transition('idle'); this.request();
      }
    });
  }
  async settled(aborted: boolean): Promise<void> {
    if (this.executing) await this.change(() => {
      if (this.runControlRevision === this.controlRevision) {
        if (aborted && !this.goal!.waiting) this.pauseFor('cancelled');
        else if (this.lastError) this.pauseFor('request_failed', this.lastError);
        else if (!this.goal!.waiting) this.transition('idle');
      } else if (!this.goal!.waiting && this.goal!.automatic) { this.transition('idle'); this.request(); }
    });
    this.runGoalId = undefined; this.runRevision = undefined; this.runBinding = undefined; this.runAccess = undefined; this.runSignal = undefined; this.lastError = undefined;
  }
  userPrompt(start: boolean): void {
    if (this.executing) this.transition(start ? 'waiting_user' : this.goal!.waiting === 'user' ? 'waiting_user' : 'running');
  }
  async askResult(status: AskResult['status'], ctx: ExtensionContext): Promise<void> {
    if (!this.executing || ctx.sessionManager.getSessionId() !== this.binding.current?.sessionId) return;
    if (status === 'answered' || status === 'timed_out') this.transition('running');
    else if (status === 'cancelled') await this.change(() => { this.goal!.waiting = 'user'; this.pauseFor('cancelled'); });
  }
  beforeCompact(): void { if (this.goal?.status === 'active') this.transition('waiting_host'); }
  async compacted(willRetry: boolean): Promise<void> {
    if (!this.goal || this.goal.status === 'completed') return;
    await this.change(() => {
      // Compaction can continue active work, but it is not a new user turn.
      if (this.goal?.status !== 'active') return;
      if (this.goal.waiting) { this.transition(this.goal.waiting === 'user' ? 'waiting_user' : 'waiting_jobs'); return; }
      this.activity.reset();
      if (!willRetry) { this.transition('idle'); this.request(); }
    });
    if (!willRetry) this.notifications.afterHostOperation();
  }
  async compactFailed(error?: string): Promise<void> { if (this.goal?.status === 'active') await this.change(() => this.pauseFor('compaction_failed', error)); }
  requireOwned(id: string, ctx: ExtensionContext, access: 'execute' | 'complete' = 'execute', signal?: AbortSignal): Goal {
    if (!this.goal || this.goal.id !== id) throw new ToolError('NOT_FOUND', 'No such goal; use the goalId from the latest Goal instruction', id);
    if (access === 'execute' && (this.goal.status !== 'active' || this.runAccess === 'complete')) throw new ToolError('NOT_RUNNING', `Goal is ${this.goal.status}; goal_wait and goal_blocked only work while it runs automatically. Handle the user's request instead; the user can run /goal resume`, id);
    if (!this.currentAccess(ctx, signal)) throw new ToolError('STALE_BINDING', 'This call belongs to an earlier goal revision or turn; use the goalId from the latest Goal instruction in a new turn', id);
    return this.goal;
  }
  async complete(id: string, summary: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<boolean> {
    const changed = await this.change(() => {
      const goal = this.requireOwned(id, ctx, 'complete', signal);
      if (goal.status === 'completed') return false;
      goal.progress = summary; goal.completedAt = Date.now(); goal.status = 'completed'; goal.automatic = false;
      this.activity.reset(); this.cancelRequest(); this.clearWait(); this.transition('idle'); return true;
    }, signal);
    this.armCompletion(); return changed;
  }
  async block(id: string, reason: string, evidence: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    await this.change(() => { this.requireOwned(id, ctx, 'execute', signal); this.goal!.progress = evidence; this.pauseFor('blocked', reason); }, signal);
  }
  async wait(id: string, reason: string, delay: number | undefined, ctx: ExtensionContext, waitFor?: string[], signal?: AbortSignal): Promise<{ waiting: boolean; settled: string[] }> {
    const result = await this.change(() => {
      const goal = this.requireOwned(id, ctx, 'execute', signal), ids = [...new Set(waitFor ?? [])];
      const settled = ids.filter(item => this.waits.settlement(item).settled);
      if (ids.length && settled.length === ids.length) return { waiting: false, settled };
      this.activity.reset(); this.controlRevision++; this.cancelRequest(); goal.waiting = 'jobs'; goal.progress = reason;
      if (ids.length) goal.waitFor = ids.filter(item => !settled.includes(item)); else delete goal.waitFor;
      if (delay !== undefined) goal.resumeAt = Date.now() + delay; else delete goal.resumeAt;
      this.transition('waiting_jobs'); return { waiting: true, settled };
    }, signal);
    if (result.waiting) this.armWait(); return result;
  }
  private disarmWait(): void { this.waitResources.disarm(); }
  private clearWait(): void { this.disarmWait(); if (this.goal) { delete this.goal.waiting; delete this.goal.resumeAt; delete this.goal.waitFor; } }
  private armWait(): void {
    const goal = this.goal, captured = this.binding.current, control = this.controlRevision;
    this.waitResources.arm(goal, () => {
      if (!captured || !this.binding.isCurrent(captured) || this.goal?.id !== goal?.id || this.goal?.revision !== goal?.revision || this.controlRevision !== control || this.goal?.status !== 'active' || !this.goal.automatic) return;
      void this.change(() => {
        if (this.goal?.waiting !== 'jobs') return;
        this.clearWait(); this.transition('idle'); this.request();
      }).catch(error => captured.ctx.ui.notify(String(error), 'error'));
    });
  }
  private armCompletion(): void {
    clearTimeout(this.completedTimer);
    const goal = this.goal, captured = this.binding.current;
    if (goal?.status !== 'completed' || !captured) return;
    this.completedTimer = setTimeout(() => { if (this.binding.isCurrent(captured) && this.goal?.id === goal.id) this.publish(); }, Math.max(0, goal.completedAt! + 5000 - Date.now()));
  }
}
