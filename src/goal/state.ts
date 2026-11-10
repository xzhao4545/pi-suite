import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const GOAL_ENTRY = "pi-suite:goal";
const goalSchema = Type.Object({
  id: Type.String(), revision: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1, maxLength: 4000 }),
  status: Type.String({ enum: ["active", "paused", "blocked", "failed", "completed", "budget_limited"] }),
  automatic: Type.Boolean(), waiting: Type.Optional(Type.String({ enum: ["user", "jobs"] })),
  budget: Type.Optional(Type.Integer({ minimum: 1 })), usedTokens: Type.Integer({ minimum: 0 }),
  elapsedMs: Type.Number({ minimum: 0 }), turns: Type.Integer({ minimum: 0 }),
  progress: Type.String(), error: Type.Optional(Type.String()),
  resumeAt: Type.Optional(Type.Number()), completedAt: Type.Optional(Type.Number()),
  // goal_wait waitFor: the goal resumes only after all these job/agent IDs settle (or one asks).
  waitFor: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });
const entrySchema = Type.Object({ version: Type.Literal(1), goal: Type.Union([goalSchema, Type.Null()]) });
export type GoalStatus = "active" | "paused" | "blocked" | "failed" | "completed" | "budget_limited";
export type Schedule = "running" | "waiting_user" | "waiting_jobs" | "waiting_host" | "detached" | "idle";
export type Goal = Omit<Static<typeof goalSchema>, "status" | "waiting"> & { status: GoalStatus; waiting?: "user" | "jobs" };

/** A manually prepared copy keeps the goal record, but never inherits automatic wakes. */
export function pausedGoalCopy(data: unknown): Static<typeof entrySchema> {
  if (!Value.Check(entrySchema, data)) throw new Error("Invalid persisted pi-suite goal");
  if (!data.goal) return data;
  const goal = { ...data.goal, automatic: false };
  if (goal.status === 'active') goal.status = 'paused';
  delete goal.waiting; delete goal.waitFor; delete goal.resumeAt;
  return { version: 1, goal };
}

export function restoreGoal(ctx: ExtensionContext): Goal | undefined {
  const entry = ctx.sessionManager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === GOAL_ENTRY);
  if (!entry || entry.type !== "custom") return;
  if (!Value.Check(entrySchema, entry.data)) throw new Error("Invalid persisted pi-suite goal");
  return entry.data.goal ? { ...entry.data.goal } as Goal : undefined;
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
    completed: "✅ goal", budget_limited: "⏹ goal",
  };
  if (goal.status === "completed" && now >= (goal.completedAt ?? 0) + 5000) return;
  const time = goalDuration(elapsedMs);
  if (goal.status !== "active") return `${terminal[goal.status]} ${time}`;
  // The footer identifies the state; /goal retains the precise wait and error details.
  return `${schedule === 'running' ? '🎯 goal' : !goal.automatic && !goal.waiting ? '⏸ goal' : '⏳ goal'} ${time}`;
}

export function goalContract(goal: Goal): string {
  return `Active goal ${goal.id}: ${goal.text}\nProgress: ${goal.progress || "not yet recorded"}\n` +
    `Tokens: ${goal.usedTokens}${goal.budget ? `/${goal.budget}` : " (no configured limit)"}.\n` +
    "Continue until every requirement is implemented and verified. Use goal_complete with the exact goalId and verification evidence only after a requirement-by-requirement completion audit. " +
    "Use goal_blocked only for the same evidenced external blocker repeated for at least three turns. " +
    "Use goal_wait only when an arranged external event or deadline must wake the work. " +
    "A timed_out/cancelled ask_user is not consent. Never replace the objective with an easier subset.";
}
