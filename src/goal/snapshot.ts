import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Goal, PauseKind } from './state.ts';

export const GOAL_ENTRY = 'pi-suite:goal';
const waitFields = {
  waiting: Type.Optional(Type.String({ enum: ['user', 'jobs'] })), resumeAt: Type.Optional(Type.Number()),
  waitFor: Type.Optional(Type.Array(Type.String())),
};
const storedFields = {
  id: Type.String(), revision: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1, maxLength: 4000 }),
  automatic: Type.Boolean(), resumeRequired: Type.Optional(Type.Boolean()),
  budget: Type.Optional(Type.Integer({ minimum: 1 })), usedTokens: Type.Integer({ minimum: 0 }),
  elapsedMs: Type.Number({ minimum: 0 }), turns: Type.Integer({ minimum: 0 }),
  progress: Type.String(), error: Type.Optional(Type.String()), completedAt: Type.Optional(Type.Number()), ...waitFields,
};
const legacySchema = Type.Object({ ...storedFields,
  status: Type.String({ enum: ['active', 'paused', 'blocked', 'failed', 'completed', 'budget_limited', 'stopped'] }),
  stoppedFrom: Type.Optional(Type.String({ enum: ['active', 'paused', 'blocked', 'failed', 'budget_limited'] })),
  autoStopReason: Type.Optional(Type.String({ enum: ['no_tools', 'repeated_tools'] })),
}, { additionalProperties: false });
export const storedGoalSchema = Type.Object({ ...storedFields,
  status: Type.String({ enum: ['active', 'paused', 'completed'] }),
  reason: Type.Optional(Type.Object({
    kind: Type.String({ enum: ['manual', 'blocked', 'request_failed', 'budget', 'no_tools', 'repeated_tools', 'shutdown', 'startup', 'cancelled', 'compaction_failed', 'historical_stop', 'permission'] }),
    previous: Type.Optional(Type.String()),
    automaticStop: Type.Optional(Type.String({ enum: ['no_tools', 'repeated_tools'] })),
    wait: Type.Optional(Type.Object({ ...waitFields, waiting: Type.String({ enum: ['user', 'jobs'] }) }, { additionalProperties: false })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
const snapshotSchema = Type.Union([
  Type.Object({ version: Type.Literal(1), goal: Type.Union([legacySchema, Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ version: Type.Literal(2), goal: Type.Union([storedGoalSchema, Type.Null()]) }, { additionalProperties: false }),
]);

export function normalizeStoredGoal(saved: Static<typeof storedGoalSchema>): Goal {
  // A saved kind is authoritative; old flags can disagree with the current resume policy.
  const { resumeRequired: _obsolete, ...rest } = saved;
  const goal = structuredClone(rest) as Goal;
  if (goal.status === 'active' && (!goal.automatic || goal.reason) ||
    goal.status === 'paused' && (goal.automatic || !goal.reason) ||
    goal.status === 'completed' && goal.automatic) {
    throw new Error('Invalid persisted pi-suite goal permission');
  }
  return goal;
}

/** Parse at the storage boundary without mutating raw JSONL. */
export function readGoalSnapshot(data: unknown): Goal | undefined {
  if (!Value.Check(snapshotSchema, data)) throw new Error('Invalid persisted pi-suite goal');
  if (!data.goal) return;
  if (data.version === 2) return normalizeStoredGoal(data.goal);
  const { autoStopReason, stoppedFrom, status, resumeRequired, ...rest } = data.goal;
  const goal = structuredClone(rest) as Goal;
  goal.status = status === 'completed' ? 'completed' : 'active';
  const kinds: Record<string, PauseKind> = { paused: 'manual', blocked: 'blocked', failed: 'request_failed', budget_limited: 'budget', stopped: 'historical_stop' };
  const kind = kinds[status] ?? (autoStopReason as PauseKind | undefined) ??
    (resumeRequired ? 'permission' : !rest.automatic ? rest.waiting === 'user' ? 'cancelled' : rest.error ? 'compaction_failed' : 'cancelled' : undefined);
  if (kind && status !== 'completed') {
    goal.status = 'paused'; goal.automatic = false;
    goal.reason = { kind, ...stoppedFrom ? { previous: stoppedFrom } : {},
      ...autoStopReason && kind !== autoStopReason ? { automaticStop: autoStopReason as 'no_tools' | 'repeated_tools' } : {} };
    if (goal.waiting) goal.reason.wait = { waiting: goal.waiting, resumeAt: goal.resumeAt, waitFor: goal.waitFor };
    delete goal.waiting; delete goal.resumeAt; delete goal.waitFor;
  }
  if (goal.status === 'completed') {
    goal.automatic = false;
    if (autoStopReason) goal.reason = { kind: autoStopReason as PauseKind };
  }
  return goal;
}
export function importGoal(ctx: ExtensionContext): Goal | undefined {
  // getEntries preserves physical append order across every leaf. A damaged latest
  // record must fail migration rather than reviving an earlier successful goal.
  const entry = ctx.sessionManager.getEntries().findLast(entry => entry.type === 'custom' && entry.customType === GOAL_ENTRY);
  return entry?.type === 'custom' ? readGoalSnapshot(entry.data) : undefined;
}
