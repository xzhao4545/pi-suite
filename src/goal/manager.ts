import { randomUUID } from "node:crypto";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { SessionBinding, Binding } from "../runtime/binding.ts";
import type { Notifications } from "../runtime/notifications.ts";
import type { StatusPublisher } from "../ui/status.ts";
import { GOAL_ENTRY, goalContract, goalSummary, restoreGoal, type Goal, type GoalStatus, type Schedule } from "./state.ts";

export class GoalManager {
  goal?: Goal;
  schedule: Schedule = "detached";
  private runGoalId?: string;
  private runRevision?: number;
  private runBinding?: Binding;
  private runningSince?: number;
  private lastError?: string;
  private waitTimer?: ReturnType<typeof setTimeout>;
  private completedTimer?: ReturnType<typeof setTimeout>;

  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private notifications: Notifications, private status: StatusPublisher) {
    notifications.setAdmission(() => !this.goal || this.goal.status === "active" && this.goal.automatic && this.goal.waiting !== "user");
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
    this.cancelRequest(); this.elapsed();
    clearTimeout(this.waitTimer); clearTimeout(this.completedTimer);
    this.waitTimer = undefined; this.completedTimer = undefined;
    this.runGoalId = undefined; this.runBinding = undefined;
    this.schedule = "detached";
    this.status.setGoal(undefined);
  }
  shutdown(): void { if (this.goal) this.save(); this.detach(); }
  start(text: string, ctx: ExtensionContext, budget?: number): void {
    this.cancelRequest(); this.elapsed(); clearTimeout(this.waitTimer); clearTimeout(this.completedTimer);
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
      if (this.goal.waiting === "jobs") { delete this.goal.waiting; delete this.goal.resumeAt; clearTimeout(this.waitTimer); }
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
    delete this.goal.waiting; delete this.goal.resumeAt; delete this.goal.error;
    clearTimeout(this.waitTimer); this.transition("idle"); this.save(); this.request();
  }
  clear(ctx: ExtensionContext): void {
    const abortRun = this.owned;
    this.cancelRequest(); this.elapsed(); clearTimeout(this.waitTimer); clearTimeout(this.completedTimer);
    this.goal = undefined; this.transition("idle"); this.save();
    if (abortRun) ctx.abort();
  }
  private stop(status: GoalStatus, error?: string): void {
    this.cancelRequest(); clearTimeout(this.waitTimer);
    this.goal!.status = status; this.goal!.automatic = false;
    if (error) this.goal!.error = error;
    delete this.goal!.waiting; delete this.goal!.resumeAt;
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
      delete this.goal.waiting; delete this.goal.resumeAt; clearTimeout(this.waitTimer);
      this.save();
    }
    return this.owned;
  }
  startRun(): void {
    if (!this.owned) return;
    this.cancelRequest();
    if (this.goal?.waiting === "jobs") {
      delete this.goal.waiting; delete this.goal.resumeAt; clearTimeout(this.waitTimer); this.save();
    }
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
  wait(id: string, reason: string, delay: number | undefined, ctx: ExtensionContext): void {
    const goal = this.requireOwned(id, ctx); this.cancelRequest(); goal.waiting = "jobs"; goal.progress = reason;
    if (delay !== undefined) goal.resumeAt = Date.now() + delay; else delete goal.resumeAt;
    this.transition("waiting_jobs"); this.save(); this.armWait();
  }
  private armWait(): void {
    clearTimeout(this.waitTimer);
    const goal = this.goal, captured = this.binding.current;
    if (!goal?.resumeAt || !captured) return;
    this.waitTimer = setTimeout(() => {
      if (!this.binding.isCurrent(captured) || this.goal?.id !== goal.id || this.goal.waiting !== "jobs") return;
      delete this.goal.waiting; delete this.goal.resumeAt; this.transition("idle"); this.save(); this.request();
    }, Math.max(0, goal.resumeAt - Date.now()));
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
