import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Goal, PauseKind } from './state.ts';

export const GOAL_ENTRY = 'pi-suite:goal';
const waitFields = {
  waiting: Type.Optional(Type.String({ enum: ['user', 'jobs'] })), resumeAt: Type.Optional(Type.Number()),
  waitFor: Type.Optional(Type.Array(Type.String())),
};
const fields = {
  id: Type.String(), revision: Type.Integer({ minimum: 0 }), text: Type.String({ minLength: 1, maxLength: 4000 }),
  automatic: Type.Boolean(), resumeRequired: Type.Optional(Type.Boolean()),
  budget: Type.Optional(Type.Integer({ minimum: 1 })), usedTokens: Type.Integer({ minimum: 0 }),
  elapsedMs: Type.Number({ minimum: 0 }), turns: Type.Integer({ minimum: 0 }),
  progress: Type.String(), error: Type.Optional(Type.String()), completedAt: Type.Optional(Type.Number()), ...waitFields,
};
const legacySchema = Type.Object({ ...fields,
  status: Type.String({ enum: ['active', 'paused', 'blocked', 'failed', 'completed', 'budget_limited', 'stopped'] }),
  stoppedFrom: Type.Optional(Type.String({ enum: ['active', 'paused', 'blocked', 'failed', 'budget_limited'] })),
  autoStopReason: Type.Optional(Type.String({ enum: ['no_tools', 'repeated_tools'] })),
}, { additionalProperties: false });
export const goalSchema = Type.Object({ ...fields,
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
  Type.Object({ version: Type.Literal(2), goal: Type.Union([goalSchema, Type.Null()]) }, { additionalProperties: false }),
]);
/** Parse once at the storage boundary. Migration never mutates raw JSONL or grants permission. */
export function readGoalSnapshot(data: unknown): Goal | undefined {
  if (!Value.Check(snapshotSchema, data)) throw new Error('Invalid persisted pi-suite goal');
  if (!data.goal) return;
  if (data.version === 2) {
    const goal = structuredClone(data.goal) as Goal;
    if (goal.status === 'active' && (!goal.automatic || goal.resumeRequired || goal.reason) ||
      goal.status === 'paused' && (goal.automatic || !goal.reason || goal.resumeRequired === undefined ||
        !goal.resumeRequired && !['cancelled', 'compaction_failed'].includes(goal.reason.kind)) ||
      goal.status === 'completed' && goal.automatic) {
      throw new Error('Invalid persisted pi-suite goal permission');
    }
    return goal;
  }
  const saved = data.goal as Static<typeof legacySchema>;
  const { autoStopReason, stoppedFrom, status, ...rest } = saved;
  const goal = structuredClone(rest) as Goal;
  goal.status = status === 'completed' ? 'completed' : 'active';
  const kinds: Record<string, PauseKind> = { paused: 'manual', blocked: 'blocked', failed: 'request_failed', budget_limited: 'budget', stopped: 'historical_stop' };
  const kind = kinds[status] ?? (autoStopReason as PauseKind | undefined) ??
    (saved.resumeRequired ? 'permission' : !saved.automatic ? saved.waiting === 'user' ? 'cancelled' : saved.error ? 'compaction_failed' : 'cancelled' : undefined);
  if (kind && status !== 'completed') {
    goal.status = 'paused'; goal.automatic = false;
    goal.reason = { kind, ...stoppedFrom ? { previous: stoppedFrom } : {},
      ...autoStopReason && kind !== autoStopReason ? { automaticStop: autoStopReason as 'no_tools' | 'repeated_tools' } : {} };
    // Esc, failed manual compact and system ask cancellation accepted ordinary user input
    // in v1. Manual stops, guards and cold revocations must not gain that grant.
    goal.resumeRequired = Boolean(saved.resumeRequired || kinds[status] || autoStopReason);
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
