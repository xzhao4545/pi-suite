import { randomUUID } from "node:crypto";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { SessionBinding, Binding } from "../runtime/binding.ts";
import { isQuestion, type Notifications } from "../runtime/notifications.ts";
import type { StatusPublisher } from "../ui/status.ts";
import type { WaitRegistry } from "../runtime/wait.ts";
import { ToolError } from "../runtime/errors.ts";
import { GOAL_ENTRY, goalContract, goalSummary, restoreGoal, type Goal, type GoalStatus, type Schedule } from "./state.ts";

export class GoalManager {
  goal?: Goal;
  schedule: Schedule = "detached";
  private runGoalId?: string;
  private runRevision?: number;
  private runBinding?: Binding;
  private runningSince?: number;
  private lastError?: string;
  private waitTimer?: NodeJS.Timeout;
  private waitWatch?: () => void;
  private completedTimer?: NodeJS.Timeout;

  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications, private status: StatusPublisher,
    private waits: WaitRegistry) {
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
  private cancelRequest(): void {
    if (this.goal && this.binding.current) this.notifications.cancel(this.binding.current.sessionId, this.requestId);
  }
  private elapsed(): void {
    if (this.goal && this.runningSince !== undefined) this.goal.elapsedMs += Math.max(0, Date.now() - this.runningSince);
    this.runningSince = undefined;
  }
  private transition(schedule: Schedule): void {
    this.elapsed(); this.schedule = schedule;
    if (schedule === "running" && this.goal?.status === "active") this.runningSince = Date.now();
    this.publish();
  }
  private save(): void {
    this.elapsed();
    if (this.schedule === "running" && this.goal?.status === "active") this.runningSince = Date.now();
    this.pi.appendEntry(GOAL_ENTRY, { version: 1, goal: this.goal ? { ...this.goal } : null });
    this.publish();
  }
  private publish(): void {
    const queued = Boolean(this.goal && this.binding.current && this.notifications.has(this.binding.current.sessionId, this.requestId));
    this.status.setGoal(goalSummary(this.goal, this.schedule, queued));
  }
  restore(ctx: ExtensionContext, _reason: SessionStartEvent["reason"]): void {
    this.detach(); this.goal = restoreGoal(ctx);
    this.transition(this.goal?.waiting === "user" ? "waiting_user" : this.goal?.waiting === "jobs" ? "waiting_jobs" : "idle");
    if (this.goal?.status === "active" && this.goal.automatic) {
      if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) this.stop("budget_limited");
      else if (!this.goal.waiting) this.request();
      else this.armWait();
    }
    this.armCompletion();
  }
  detach(): void {
    this.cancelRequest(); this.elapsed(); this.disarmWait();
    clearTimeout(this.completedTimer); this.completedTimer = undefined;
    this.runGoalId = undefined; this.runBinding = undefined;
    this.schedule = "detached";
    this.status.setGoal(undefined);
  }
  shutdown(): void { if (this.goal) this.save(); this.detach(); }
  start(text: string, ctx: ExtensionContext, budget?: number): void {
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
      this.goal.text = text; this.goal.revision++;
      // A changed objective invalidates its arranged job wait as well as old tools.
      // An unanswered user prompt keeps its explicit resume requirement.
      if (this.goal.waiting === "jobs") this.clearWait();
    }
    if (budget !== undefined) this.goal.budget = budget;
    this.save();
    if (this.goal.status === "active" && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) {
      this.stop("budget_limited"); if (this.owned) ctx.abort();
    }
    if (abortOldRun) ctx.abort();
    if (text !== undefined && this.goal.status === "active" && this.goal.automatic) this.request();
  }
  pause(ctx: ExtensionContext): void { if (!this.goal) throw new Error("No goal to pause"); this.stop("paused"); if (this.owned) ctx.abort(); }
  resume(): void {
    if (!this.goal || this.goal.status === "completed") throw new Error("No unfinished goal to resume");
    if (this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) throw new Error("Raise the token budget above current usage before resuming");
    this.goal.status = "active"; this.goal.automatic = true;
    this.clearWait(); delete this.goal.error;
    this.transition("idle"); this.save(); this.request();
  }
  clear(ctx: ExtensionContext): void {
    const abortRun = this.owned;
    this.cancelRequest(); this.elapsed(); this.disarmWait(); clearTimeout(this.completedTimer);
    this.goal = undefined; this.transition("idle"); this.save();
    if (abortRun) ctx.abort();
  }
  private stop(status: GoalStatus, error?: string): void {
    this.cancelRequest();
    this.goal!.status = status; this.goal!.automatic = false;
    if (error) this.goal!.error = error;
    this.clearWait();
    this.transition("idle"); this.save();
  }
  private request(): void {
    const goal = this.goal, current = this.binding.current;
    if (!goal || !current || goal.status !== "active" || !goal.automatic || goal.waiting) return;
    this.notifications.enqueue(current.sessionId, this.requestId, goalContract(goal));
    this.publish();
  }
  beforeStart(userInput: boolean): boolean {
    this.runGoalId = this.goal?.status === "active" && (this.goal.automatic || userInput) ? this.goal.id : undefined;
    this.runRevision = this.goal?.revision;
    this.runBinding = this.binding.current;
    if (this.owned && this.goal?.status === "active") {
      this.cancelRequest(); this.goal.automatic = true;
      this.clearWait();
      this.save();
    }
    return this.owned;
  }
  startRun(): void {
    if (!this.owned) return;
    this.cancelRequest();
    if (this.goal?.waiting === "jobs") { this.clearWait(); this.save(); }
    this.transition("running");
  }
  endRun(error?: string): void {
    if (!this.owned || this.goal?.status !== "active") return;
    this.lastError = error;
    if (!this.goal.waiting) this.transition("waiting_host");
  }
  messageEnd(event: MessageEndEvent, ctx: ExtensionContext): void {
    // Edits invalidate tool/control ownership, but an in-flight response still belongs
    // to the same cumulative token budget even if it finishes after the edit.
    if (!this.goal || this.runGoalId !== this.goal.id || !this.runBinding || !this.binding.isCurrent(this.runBinding) || event.message.role !== "assistant") return;
    this.goal.usedTokens += event.message.usage.totalTokens;
    this.goal.turns++; this.save();
    if (this.goal.status === "active" && this.goal.budget !== undefined && this.goal.usedTokens >= this.goal.budget) { this.stop("budget_limited"); ctx.abort(); }
  }
  beforeSettle(event: AgentBeforeSettleEvent): void {
    if (!this.owned || this.goal?.status !== "active") return;
    if (event.outcome === "error") { this.stop("failed", this.lastError ?? "Model request failed"); return; }
    if (event.outcome === "aborted") { this.suspend(); return; }
    if (!this.goal.waiting && this.goal.automatic) { this.transition("idle"); this.request(); }
  }
  settled(aborted: boolean): void {
    if (this.owned && this.goal?.status === "active") {
      if (aborted && !this.goal.waiting) this.suspend();
      else if (!this.goal.waiting) this.transition("idle");
    }
    this.runGoalId = undefined; this.runBinding = undefined; this.lastError = undefined;
  }
  private suspend(): void { this.cancelRequest(); this.goal!.automatic = false; this.transition("idle"); this.save(); }
  userPrompt(start: boolean): void {
    if (!this.owned || this.goal?.status !== "active") return;
    this.transition(start ? "waiting_user" : this.goal.waiting === "user" ? "waiting_user" : "running");
  }
  askResult(answered: boolean, ctx: ExtensionContext): void {
    if (!this.owned || this.goal?.status !== "active" || ctx.sessionManager.getSessionId() !== this.binding.current?.sessionId) return;
    if (answered) this.transition("running");
    else { this.goal.waiting = "user"; this.goal.automatic = false; this.cancelRequest(); this.transition("waiting_user"); this.save(); }
  }
  beforeCompact(): void { if (this.goal?.status === "active") this.transition("waiting_host"); }
  compacted(willRetry: boolean): void {
    if (this.goal?.status !== "active") return;
    if (this.goal.waiting) { this.transition(this.goal.waiting === "user" ? "waiting_user" : "waiting_jobs"); return; }
    // Manual compact aborts before its public before-compact event. Completion is the
    // explicit recovery signal that restores automatic permission after that abort.
    this.goal.automatic = true; this.save();
    if (!willRetry) { this.transition("idle"); this.request(); this.notifications.afterHostOperation(); }
  }
  compactFailed(error?: string): void {
    if (this.goal?.status !== "active") return;
    this.goal.automatic = false; if (error) this.goal.error = error;
    this.transition(this.goal.waiting === "user" ? "waiting_user" : this.goal.waiting === "jobs" ? "waiting_jobs" : "idle"); this.save();
  }
  requireOwned(id: string, ctx: ExtensionContext): Goal {
    if (!this.goal || this.goal.id !== id || this.goal.status !== "active" || !this.owned || ctx.sessionManager.getSessionId() !== this.binding.current?.sessionId) {
      throw new Error("The tool call does not own the active goalId");
    }
    return this.goal;
  }
  complete(id: string, summary: string, ctx: ExtensionContext): void {
    const goal = this.requireOwned(id, ctx); goal.progress = summary; goal.completedAt = Date.now();
    this.stop("completed"); this.armCompletion();
  }
  block(id: string, reason: string, evidence: string, ctx: ExtensionContext): void {
    this.requireOwned(id, ctx); this.goal!.progress = evidence; this.stop("blocked", reason);
  }
  /**
   * waitFor resumes only after every listed job/agent settles (or one asks its parent), or at
   * the deadline. IDs already settled are reported and skipped; if none remain, nothing waits.
   */
  wait(id: string, reason: string, delay: number | undefined, ctx: ExtensionContext, waitFor?: string[]): { waiting: boolean; settled: string[] } {
    const goal = this.requireOwned(id, ctx);
    const ids = [...new Set(waitFor ?? [])];
    // Unknown IDs throw NOT_FOUND/HISTORY_READ_ONLY here, so the model sees them at the call.
    const settled = ids.filter(item => this.waits.settlement(item).settled);
    if (ids.length && settled.length === ids.length) return { waiting: false, settled };
    this.cancelRequest(); goal.waiting = "jobs"; goal.progress = reason;
    if (ids.length) goal.waitFor = ids.filter(item => !settled.includes(item)); else delete goal.waitFor;
    if (delay !== undefined) goal.resumeAt = Date.now() + delay; else delete goal.resumeAt;
    this.transition("waiting_jobs"); this.save(); this.armWait();
    return { waiting: true, settled };
  }
  private disarmWait(): void {
    clearTimeout(this.waitTimer); this.waitTimer = undefined;
    this.waitWatch?.(); this.waitWatch = undefined;
  }
  /** Leaves any arranged wait: timer, watch and the persisted wait fields. */
  private clearWait(): void {
    this.disarmWait();
    if (this.goal) { delete this.goal.waiting; delete this.goal.resumeAt; delete this.goal.waitFor; }
  }
  private waitedDone(ids: string[]): boolean {
    // After a Pi restart a listed object can be history only. It can no longer settle in this
    // process, so it stops holding the goal instead of blocking it forever.
    const states = ids.map(item => {
      try { return this.waits.settlement(item); } catch (error) { if (error instanceof ToolError) return undefined; throw error; }
    });
    return states.every(state => !state || state.settled) || states.some(state => state?.question);
  }
  private armWait(): void {
    this.disarmWait();
    const goal = this.goal, captured = this.binding.current;
    if (goal?.waiting !== "jobs" || !captured) return;
    const resume = () => {
      if (!this.binding.isCurrent(captured) || this.goal?.id !== goal.id || this.goal.waiting !== "jobs") return;
      this.clearWait(); this.transition("idle"); this.save(); this.request();
    };
    if (goal.resumeAt) this.waitTimer = setTimeout(resume, Math.max(0, goal.resumeAt - Date.now()));
    if (!goal.waitFor) return;
    // A module disabled since the wait was arranged cannot report; its IDs no longer hold the goal.
    const ids = goal.waitFor.filter(item => this.waits.has(item));
    if (this.waitedDone(ids)) { resume(); return; }
    this.waitWatch = this.waits.watch(ids, () => { if (this.waitedDone(ids)) resume(); });
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
