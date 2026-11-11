import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const GOAL_ENTRY = "pi-suite:goal";
const goalSchema = Type.Object({
  id: Type.String(), revision: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1, maxLength: 4000 }),
  status: Type.String({ enum: ["active", "paused", "blocked", "failed", "completed", "budget_limited", "stopped"] }),
  // Stopping must not erase the reason an unfinished goal could not proceed.
  stoppedFrom: Type.Optional(Type.String({ enum: ["active", "paused", "blocked", "failed", "budget_limited"] })),
  automatic: Type.Boolean(), resumeRequired: Type.Optional(Type.Boolean()), waiting: Type.Optional(Type.String({ enum: ["user", "jobs"] })),
  budget: Type.Optional(Type.Integer({ minimum: 1 })), usedTokens: Type.Integer({ minimum: 0 }),
  elapsedMs: Type.Number({ minimum: 0 }), turns: Type.Integer({ minimum: 0 }),
  progress: Type.String(), error: Type.Optional(Type.String()),
  resumeAt: Type.Optional(Type.Number()), completedAt: Type.Optional(Type.Number()),
  // goal_wait waitFor: the goal resumes only after all these job/agent IDs settle (or one asks).
  waitFor: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
const entrySchema = Type.Object({ version: Type.Literal(1), goal: Type.Union([goalSchema, Type.Null()]) });
export type GoalStatus = "active" | "paused" | "blocked" | "failed" | "completed" | "budget_limited" | "stopped";
export type Schedule = "running" | "waiting_user" | "waiting_jobs" | "waiting_host" | "detached" | "idle";
export type Goal = Omit<Static<typeof goalSchema>, "status" | "waiting"> & { status: GoalStatus; waiting?: "user" | "jobs" };

export function restoreGoal(ctx: ExtensionContext): Goal | undefined {
  const entry = ctx.sessionManager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === GOAL_ENTRY);
  if (!entry || entry.type !== "custom") return;
  if (!Value.Check(entrySchema, entry.data)) throw new Error("Invalid persisted pi-suite goal");
  return entry.data.goal ? { ...entry.data.goal } as Goal : undefined;
}

export function goalRequiresResume(ctx: ExtensionContext, goal: Goal): boolean {
  // Branch selection restores work, not a grant to undo a cold-start revocation. Read only
  // permission metadata across the session; an explicit grant applies to its revision only.
  const entry = ctx.sessionManager.getEntries().findLast(entry => {
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY) return false;
    const saved = (entry.data as { goal?: Goal } | undefined)?.goal;
    return saved?.id === goal.id && saved.resumeRequired !== undefined;
  });
  if (!entry || entry.type !== "custom") return false;
  if (!Value.Check(entrySchema, entry.data)) throw new Error("Invalid persisted pi-suite goal permission");
  const saved = entry.data.goal as Goal;
  return saved.resumeRequired === true || saved.revision !== goal.revision;
}

export function goalDuration(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  const pair = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pair(minutes % 60)}:${pair(seconds % 60)}` : `${pair(minutes)}:${pair(seconds % 60)}`;
}

export function goalSummary(goal: Goal | undefined, schedule: Schedule, now = Date.now(), elapsedMs = goal?.elapsedMs ?? 0): string | undefined {
  if (!goal || schedule === "detached") return;
  const terminal: Record<Exclude<GoalStatus, "active">, string> = {
    paused: "⏸ goal", blocked: "⚠ goal", failed: "❌ goal",
    completed: "✅ goal", budget_limited: "⏹ goal", stopped: "⏹ goal",
  };
  if (goal.status === "completed" && now >= (goal.completedAt ?? 0) + 5000) return;
  const time = goalDuration(elapsedMs);
  if (goal.status !== "active") return `${terminal[goal.status]} ${time}`;
  // The footer identifies the state; /goal retains the precise wait and error details.
  return `${schedule === 'running' ? '🎯 goal' : !goal.automatic && !goal.waiting ? '⏸ goal' : '⏳ goal'} ${time}`;
}

export function goalContract(goal: Goal): string {
  const executing = goal.status === "active";
  return `${executing ? "Active goal" : "Goal"} ${goal.id}: ${goal.text}\nStatus: ${goal.status} · Revision: ${goal.revision}${goal.stoppedFrom ? ` · Stopped from: ${goal.stoppedFrom}` : ""}\nProgress: ${goal.progress || "not yet recorded"}\n` +
    `Tokens: ${goal.usedTokens}${goal.budget ? `/${goal.budget}` : " (no configured limit)"}.${goal.error ? `\nError: ${goal.error}` : ""}\n` +
    (executing ? "Continue until every requirement is implemented and verified. " :
      "This user-driven turn has completion-only permission: audit existing work without resuming automatic execution. Only explicit /goal resume restores execution; goal_wait and goal_blocked require an active execution turn. ") +
    "Use goal_complete with the exact goalId and verification evidence only after a requirement-by-requirement completion audit; failed, paused, blocked, budget_limited and stopped goals may be closed without resume. Completed calls are idempotent and preserve the original evidence and completion time. " +
    "Use goal_blocked only for the same evidenced external blocker repeated for at least three turns. " +
    "Use goal_wait only when an arranged external event or deadline must wake the work. " +
    "A timed_out/cancelled ask_user is not consent. Never replace the objective with an easier subset.";
}
