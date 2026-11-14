import { randomUUID } from "node:crypto";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent, SessionStartEvent, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import type { SessionBinding, Binding } from "../runtime/binding.ts";
import { isQuestion, type Notifications } from "../runtime/notifications.ts";
import type { StatusPublisher } from "../ui/status.ts";
import type { AskResult } from "../ask/schema.ts";
import type { WaitRegistry } from "../runtime/wait.ts";
import { ToolError } from "../runtime/errors.ts";
import { GoalActivity, autoStopMessage } from "./activity.ts";
import { GOAL_CONTINUATION } from "./context.ts";
import { GOAL_ENTRY, goalRequiresResume, restoreGoal } from './snapshot.ts';
import { goalSummary, type Goal, type PauseKind, type Schedule } from './state.ts';
import { GoalWaitResources } from './wait.ts';

export class GoalManager {
  goal?: Goal;
  schedule: Schedule = "detached";
  readonly activity = new GoalActivity();
  private runGoalId?: string;
  private runRevision?: number;
  private runBinding?: Binding;
  private runAccess?: "execute" | "complete";
  private runSignal?: AbortSignal;
  private runningSince?: number;
  private lastError?: string;
  private readonly waitResources: GoalWaitResources;
  private completedTimer?: NodeJS.Timeout;
  private clock?: NodeJS.Timeout;
  private controlRevision = 0;
  private runControlRevision = 0;

  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications, private status: StatusPublisher,
    private waits: WaitRegistry) {
    this.waitResources = new GoalWaitResources(binding, waits);
    // While waitFor objects are pending, other settlement notices merge silently instead of
    // waking the model. A direct child's question still wakes it: the child is waiting for an
    // answer, and the run that answers it ends this wait (startRun clears it). So does a monitor
    // event or hands-free update of a waited job: the model requested these wakeups.
    notifications.setAdmission(ids => !this.goal || this.goal.status === "active" && this.goal.automatic && this.goal.waiting !== "user" &&
      (!this.goal.waitFor || ids.some(id => isQuestion(id) || this.goal!.waitFor!.some(waited => id === `job:${waited}:monitor` || id === `job:${waited}:update`))));
  }
  private get requestId(): string { return `goal:${this.goal!.id}`; }
  private get owned(): boolean {
    return Boolean(this.goal && this.runGoalId === this.goal.id && this.runRevision === this.goal.revision && this.runBinding && this.binding.isCurrent(this.runBinding));
  }
  private get executing(): boolean { return this.owned && this.runAccess === "execute" && this.goal?.status === "active"; }
  /** The same ownership fence drives tools and the request-only model view. */
  private currentAccess(ctx: ExtensionContext, signal?: AbortSignal): boolean {
    return Boolean(this.owned && this.runAccess && this.runControlRevision === this.controlRevision && !signal?.aborted && !this.runSignal?.aborted &&
      !ctx.signal?.aborted && (!this.runSignal || ctx.signal === this.runSignal) && ctx.sessionManager.getSessionId() === this.binding.current?.sessionId);
  }
  contextView(ctx: ExtensionContext): { goal: Goal; access: "execute" | "complete" } | undefined {
    if (!this.currentAccess(ctx)) return;
    return { goal: this.goal!, access: this.executing ? "execute" : "complete" };
  }
  private cancelRequest(): void {
    if (this.goal && this.binding.current) this.notifications.cancel(this.binding.current.sessionId, this.requestId);
  }
  private elapsed(): void {
    if (this.goal) this.goal.elapsedMs = this.elapsedMs;
    this.runningSince = undefined;
  }
  /** UI ticks read the unfinished segment; only lifecycle saves append session entries. */
  get elapsedMs(): number {
    return (this.goal?.elapsedMs ?? 0) + (this.runningSince === undefined ? 0 : Math.max(0, performance.now() - this.runningSince));
  }
  private transition(schedule: Schedule): void {
    this.elapsed(); this.schedule = schedule;
    if (schedule === "running" && this.goal?.status === "active") this.runningSince = performance.now();
    this.publish();
  }
  private save(): void {
    this.elapsed();
    if (this.schedule === "running" && this.goal?.status === "active") this.runningSince = performance.now();
    this.pi.appendEntry(GOAL_ENTRY, { version: 2, goal: this.goal ? structuredClone(this.goal) : null });
    this.publish();
  }
  private publish(): void {
    this.status.setGoal(goalSummary(this.goal, this.schedule, Date.now(), this.elapsedMs));
    const ticking = this.goal?.status === 'active' && this.schedule === 'running' && this.status.goalVisible && this.binding.current?.ctx.mode === 'tui';
    if (!ticking) { clearInterval(this.clock); this.clock = undefined; }
    else if (!this.clock) {
      const captured = this.binding.current!, goalId = this.goal!.id;
      this.clock = setInterval(() => {
        if (this.binding.isCurrent(captured) && this.goal?.id === goalId) this.publish();
      }, 1000);
      this.clock.unref();
    }
  }
  restore(ctx: ExtensionContext, reason: SessionStartEvent["reason"] | "tree"): void {
    this.detach(); this.goal = restoreGoal(ctx);
    // Startup cannot know whether the previous process quit or was killed. Revoke active
    // snapshots before requests/deadlines are armed; reload and branch operations are distinct.
    const permission = this.goal && goalRequiresResume(ctx, this.goal);
    if (this.goal && this.goal.status !== 'completed') {
      if (permission) this.pauseFor(permission.reason?.kind ?? 'permission');
      else if (reason === 'startup') this.pauseFor('startup');
    }
    this.transition(this.goal?.waiting === "user" ? "waiting_user" : this.goal?.waiting === "jobs" ? "waiting_jobs" : "idle");
    if (this.goal?.status === "active" && this.goal.automatic) {
      if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) this.pauseFor('budget');
      else if (!this.goal.waiting) this.request();
      else this.armWait();
    }
    this.armCompletion();
  }
  detach(): void {
    this.activity.reset();
    this.cancelRequest(); this.elapsed(); this.disarmWait();
    clearTimeout(this.completedTimer); this.completedTimer = undefined;
    clearInterval(this.clock); this.clock = undefined;
    this.runGoalId = undefined; this.runRevision = undefined; this.runBinding = undefined; this.runAccess = undefined; this.runSignal = undefined;
    this.schedule = "detached";
    this.status.setGoal(undefined);
  }
  shutdown(reason: SessionShutdownEvent["reason"]): void {
    if (this.goal && this.schedule !== "detached") {
      if (reason === "quit" && this.goal.status !== "completed") this.pauseFor('shutdown');
      else this.save();
    }
    this.detach();
  }
  start(text: string, ctx: ExtensionContext, budget?: number): void {
    this.activity.reset();
    this.cancelRequest(); this.elapsed(); this.disarmWait(); clearTimeout(this.completedTimer);
    const abortOldRun = this.owned && !ctx.isIdle();
    this.goal = { id: randomUUID(), revision: 0, text, budget, status: "active", automatic: true, usedTokens: 0,
      elapsedMs: 0, turns: 0, progress: "" };
    this.transition("idle"); this.save();
    if (abortOldRun) ctx.abort();
    this.request();
  }
  edit(text: string | undefined, budget: number | undefined, ctx: ExtensionContext): void {
    if (!this.goal) throw new Error("No goal to edit");
    const abortOldRun = this.owned && text !== undefined && !ctx.isIdle();
    if (text !== undefined) {
      this.activity.reset();
      this.goal.text = text; this.goal.revision++;
      // A changed objective invalidates its arranged job wait as well as old tools.
      // An unanswered user prompt keeps its explicit resume requirement.
      if (this.goal.waiting === "jobs") this.clearWait();
    }
    if (budget !== undefined) this.goal.budget = budget;
    this.save();
    if (this.goal.status === "active" && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) {
      this.pauseFor('budget'); if (this.owned) ctx.abort();
    }
    if (abortOldRun) ctx.abort();
    if (text !== undefined && this.goal.status === "active" && this.goal.automatic) this.request();
  }
  pause(ctx: ExtensionContext): void {
    if (!this.goal) throw new Error('No goal to pause');
    if (this.goal.status === 'completed' || this.goal.status === 'paused' && this.goal.reason?.kind === 'manual') return;
    this.pauseFor('manual'); if (this.owned) ctx.abort();
  }
  /** Async readers recheck this binding after loading UI, before mounting it. */
  captureBinding(ctx: ExtensionContext): Binding | undefined {
    const current = this.binding.current;
    return current?.sessionId === ctx.sessionManager.getSessionId() ? current : undefined;
  }
  isCurrent(captured: Binding): boolean { return this.binding.isCurrent(captured); }
  resume(): 'running' | 'scheduled' | 'waiting_host' {
    if (!this.goal || this.goal.status === "completed") throw new Error("No unfinished goal to resume");
    if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) throw new Error("Raise the token budget above current usage before resuming");
    const running = this.owned && this.schedule === 'running' && this.goal.status === 'active' && this.goal.automatic;
    if (running) { this.save(); return 'running'; }
    // A newer explicit resume survives the aborted settlement of an older response.
    this.activity.reset();
    this.controlRevision++;
    this.goal.status = "active"; this.goal.automatic = true; delete this.goal.reason;
    this.goal.resumeRequired = false;
    this.clearWait(); delete this.goal.error;
    this.transition("idle"); this.save(); this.request();
    return this.binding.current?.ctx.isIdle() ? 'scheduled' : 'waiting_host';
  }
  clear(ctx: ExtensionContext): void {
    const abortRun = this.owned;
    this.activity.reset();
    this.controlRevision++;
    this.cancelRequest(); this.elapsed(); this.disarmWait(); clearTimeout(this.completedTimer);
    this.goal = undefined; this.transition("idle"); this.save();
    if (abortRun) ctx.abort();
  }
  private pauseFor(kind: PauseKind, error?: string, explicit = true): void {
    this.activity.reset(); this.cancelRequest(); this.controlRevision++;
    const goal = this.goal!;
    const wait = goal.waiting ? { waiting: goal.waiting, resumeAt: goal.resumeAt, waitFor: goal.waitFor } : goal.reason?.wait;
    const previous = kind === 'shutdown' || kind === 'startup' ? goal.reason?.kind : goal.reason?.previous;
    goal.status = 'paused'; goal.automatic = false; goal.resumeRequired = explicit;
    const automaticStop = goal.reason?.automaticStop;
    goal.reason = { kind, ...previous ? { previous } : {}, ...automaticStop ? { automaticStop } : {}, ...wait ? { wait } : {} };
    if (error) goal.error = error;
    this.clearWait(); this.transition('idle'); this.save();
  }
  private request(): void {
    const goal = this.goal, current = this.binding.current;
    if (!goal || !current || goal.status !== "active" || !goal.automatic || goal.waiting) return;
    const revision = goal.revision, control = this.controlRevision;
    this.notifications.enqueue(current.sessionId, this.requestId, GOAL_CONTINUATION, () => {
      if (this.binding.isCurrent(current) && this.goal?.id === goal.id && this.goal.revision === revision && this.controlRevision === control) this.activity.delivered();
    }, "goal-continuation");
    this.publish();
  }
  beforeStart(userInput: boolean): boolean {
    this.runControlRevision = this.controlRevision;
    const goal = this.goal;
    if (userInput) this.activity.reset();
    if (userInput && goal?.status === 'paused' && !goal.resumeRequired) {
      goal.status = 'active'; goal.automatic = true; delete goal.reason;
    }
    this.runAccess = goal?.status === 'active' && goal.automatic ? 'execute' : goal && userInput ? 'complete' : undefined;
    this.runGoalId = this.runAccess ? goal!.id : undefined;
    this.runRevision = this.goal?.revision;
    this.runBinding = this.binding.current;
    if (this.executing) {
      this.cancelRequest(); this.goal!.automatic = true;
      this.clearWait();
      this.save();
    }
    return this.owned;
  }
  startRun(ctx?: ExtensionContext): void {
    if (!this.owned) return;
    // Each low-level request has its own abort signal (including host retries). A cancelled
    // request must not acquire completion permission merely because a later request starts.
    const nextSignal = ctx?.signal;
    if (nextSignal !== this.runSignal) {
      if (this.runControlRevision !== this.controlRevision && this.goal?.status === "active" && this.goal.automatic) this.runAccess = "execute";
      this.runControlRevision = this.controlRevision;
    }
    this.runSignal = nextSignal;
    if (!this.executing) return;
    this.lastError = undefined;
    this.activity.start();
    this.cancelRequest();
    if (this.goal?.waiting === "jobs") { this.clearWait(); this.save(); }
    this.transition("running");
  }
  endRun(error?: string): void {
    if (!this.executing) return;
    this.lastError = error;
    if (!this.goal!.waiting) this.transition("waiting_host");
  }
  messageEnd(event: MessageEndEvent, ctx: ExtensionContext): void {
    // Edits invalidate tool/control ownership, but an in-flight response still belongs
    // to the same cumulative token budget even if it finishes after the edit.
    if (!this.goal || this.runGoalId !== this.goal.id || !this.runBinding || !this.binding.isCurrent(this.runBinding) || ctx.sessionManager.getSessionId() !== this.runBinding.sessionId || event.message.role !== "assistant") return;
    this.lastError = event.message.stopReason === 'error' ? event.message.errorMessage ?? 'Model request failed' : undefined;
    this.goal.usedTokens += event.message.usage.totalTokens;
    this.goal.turns++; this.save();
    if (this.goal.status === "active" && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) { this.pauseFor('budget'); ctx.abort(); }
  }
  beforeSettle(event: AgentBeforeSettleEvent): void {
    if (!this.executing || this.runControlRevision !== this.controlRevision) return;
    // Errors are provisional: a later extension may repair this same boundary. Recovery
    // and host work take precedence over Goal's guard and continuation queue.
    if (event.outcome === 'error' || event.continue || event.context?.pendingMessages.length) {
      this.cancelRequest(); this.transition('waiting_host'); return;
    }
    if (event.outcome === 'aborted') return;
    if (!this.goal!.waiting && this.goal!.automatic) {
      const reason = this.activity.finish();
      if (reason) { this.pauseFor(reason); this.binding.current?.ctx.ui.notify(autoStopMessage[reason], 'warning'); return; }
      this.transition('idle'); this.request();
    }
  }
  settled(aborted: boolean): void {
    if (this.executing) {
      if (this.runControlRevision === this.controlRevision) {
        if (aborted && !this.goal!.waiting) this.pauseFor('cancelled', undefined, false);
        else if (this.lastError) this.pauseFor('request_failed', this.lastError);
        else if (!this.goal!.waiting) this.transition('idle');
      } else if (!this.goal!.waiting && this.goal!.automatic) { this.transition('idle'); this.request(); }
    }
    this.runGoalId = undefined; this.runRevision = undefined; this.runBinding = undefined; this.runAccess = undefined; this.runSignal = undefined; this.lastError = undefined;
  }
  userPrompt(start: boolean): void {
    if (!this.executing) return;
    this.transition(start ? "waiting_user" : this.goal!.waiting === "user" ? "waiting_user" : "running");
  }
  askResult(status: AskResult["status"], ctx: ExtensionContext): void {
    if (!this.executing || ctx.sessionManager.getSessionId() !== this.binding.current?.sessionId) return;
    if (status === "answered" || status === "timed_out") this.transition("running");
    // Skipping preserves automatic permission; only a system cancellation requires
    // explicit recovery. Consent remains a separate part of the ask result contract.
    else if (status === 'cancelled') { this.goal!.waiting = 'user'; this.pauseFor('cancelled', undefined, false); }
  }
  beforeCompact(): void { if (this.goal?.status === "active") this.transition("waiting_host"); }
  compacted(willRetry: boolean): void {
    if (this.goal?.status === 'paused' && !this.goal.resumeRequired && this.goal.reason?.kind === 'cancelled') {
      this.goal.status = 'active'; delete this.goal.reason;
    }
    if (this.goal?.status !== "active") return;
    if (this.goal.waiting) { this.transition(this.goal.waiting === "user" ? "waiting_user" : "waiting_jobs"); return; }
    this.activity.reset();
    // Manual compact aborts before its public before-compact event. Completion is the
    // explicit recovery signal that restores automatic permission after that abort.
    this.goal.automatic = true; this.save();
    if (!willRetry) { this.transition("idle"); this.request(); this.notifications.afterHostOperation(); }
  }
  compactFailed(error?: string): void {
    if (this.goal?.status !== "active") return;
    this.pauseFor('compaction_failed', error, false);
  }
  requireOwned(id: string, ctx: ExtensionContext, access: "execute" | "complete" = "execute", signal?: AbortSignal): Goal {
    if (!this.goal || this.goal.id !== id) throw new ToolError("NOT_FOUND", "Use the exact goalId from the current goal contract", id);
    if (access === "execute" && (this.goal.status !== "active" || this.runAccess === "complete")) throw new ToolError("NOT_RUNNING", `Goal is ${this.goal.status}; execution requires /goal resume, but a new user audit may complete it without resume`, id);
    if (!this.currentAccess(ctx, signal)) {
      throw new ToolError("STALE_BINDING", "The tool call does not own the current goal revision and request; use a fresh goal contract in its owning session", id);
    }
    return this.goal;
  }
  complete(id: string, summary: string, ctx: ExtensionContext, signal?: AbortSignal): boolean {
    const goal = this.requireOwned(id, ctx, "complete", signal);
    if (goal.status === "completed") return false;
    goal.progress = summary; goal.completedAt = Date.now();
    // Retain this audit's fence for idempotent retries without granting execution.
    goal.status = 'completed'; goal.automatic = false;
    this.activity.reset(); this.cancelRequest(); this.clearWait(); this.transition('idle'); this.save(); this.armCompletion();
    return true;
  }
  block(id: string, reason: string, evidence: string, ctx: ExtensionContext, signal?: AbortSignal): void {
    this.requireOwned(id, ctx, "execute", signal); this.goal!.progress = evidence; this.pauseFor('blocked', reason);
  }
  /**
   * waitFor resumes only after every listed job/agent settles (or one asks its parent), or at
   * the deadline. IDs already settled are reported and skipped; if none remain, nothing waits.
   */
  wait(id: string, reason: string, delay: number | undefined, ctx: ExtensionContext, waitFor?: string[], signal?: AbortSignal): { waiting: boolean; settled: string[] } {
    const goal = this.requireOwned(id, ctx, "execute", signal);
    const ids = [...new Set(waitFor ?? [])];
    // Unknown IDs throw NOT_FOUND/HISTORY_READ_ONLY here, so the model sees them at the call.
    const settled = ids.filter(item => this.waits.settlement(item).settled);
    if (ids.length && settled.length === ids.length) return { waiting: false, settled };
    this.activity.reset();
    this.cancelRequest(); goal.waiting = "jobs"; goal.progress = reason;
    if (ids.length) goal.waitFor = ids.filter(item => !settled.includes(item)); else delete goal.waitFor;
    if (delay !== undefined) goal.resumeAt = Date.now() + delay; else delete goal.resumeAt;
    this.transition("waiting_jobs"); this.save(); this.armWait();
    return { waiting: true, settled };
  }
  private disarmWait(): void { this.waitResources.disarm(); }
  /** Leaves any arranged wait: timer, watch and the persisted wait fields. */
  private clearWait(): void {
    this.disarmWait();
    if (this.goal) { delete this.goal.waiting; delete this.goal.resumeAt; delete this.goal.waitFor; }
  }
  private armWait(): void {
    const goal = this.goal;
    this.waitResources.arm(goal, () => {
      if (this.goal !== goal || goal?.status !== 'active' || !goal.automatic) return;
      this.clearWait(); this.transition('idle'); this.save(); this.request();
    });
  }
  private armCompletion(): void {
    clearTimeout(this.completedTimer);
    const goal = this.goal, captured = this.binding.current;
    if (goal?.status !== "completed" || !captured) return;
    this.completedTimer = setTimeout(() => {
      if (this.binding.isCurrent(captured) && this.goal?.id === goal.id) this.publish();
    }, Math.max(0, goal.completedAt! + 5000 - Date.now()));
  }
}
