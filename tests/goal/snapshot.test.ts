import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { GOAL_ENTRY, goalRequiresResume, readGoalSnapshot } from '../../src/goal/snapshot.ts';
import { goalUserState } from '../../src/goal/state.ts';

const base = { id: 'goal', revision: 1, text: 'Verify the original requirement', status: 'active', automatic: true,
  budget: 1000, usedTokens: 27, elapsedMs: 900, turns: 3, progress: 'Evidence', error: 'Original error' };

test('v1 migration preserves diagnostics and data without widening execution permission; v2 is explicit', () => {
  const cases = [
    [{ status: 'failed' }, 'request_failed', true], [{ status: 'blocked' }, 'blocked', true],
    [{ status: 'budget_limited' }, 'budget', true], [{ status: 'paused' }, 'manual', true],
    [{ status: 'stopped', stoppedFrom: 'blocked' }, 'historical_stop', true],
    [{ automatic: false }, 'compaction_failed', false], [{ automatic: false, error: undefined }, 'cancelled', false],
    [{ automatic: false, waiting: 'user' }, 'cancelled', false],
    [{ autoStopReason: 'no_tools', automatic: false }, 'no_tools', true],
    [{ resumeRequired: true }, 'permission', true],
  ] as const;
  for (const [changes, kind, explicit] of cases) {
    const raw = { version: 1, goal: { ...base, ...changes } }, original = structuredClone(raw);
    const goal = readGoalSnapshot(raw)!;
    assert.equal(goal.status, 'paused'); assert.equal(goal.automatic, false);
    assert.equal(goal.reason?.kind, kind); assert.equal(goal.resumeRequired, explicit);
    assert.equal(goal.id, base.id); assert.equal(goal.revision, base.revision); assert.equal(goal.progress, base.progress);
    assert.equal(goal.elapsedMs, 900); assert.equal(goal.usedTokens, 27); assert.equal(goal.budget, 1000); assert.equal(goal.turns, 3);
    assert.deepEqual(raw, original); assert.deepEqual(readGoalSnapshot({ version: 2, goal }), goal);
    assert.ok(!('stoppedFrom' in goal) && !('autoStopReason' in goal));
    assert.equal(goalUserState(goal, 'idle'), 'paused');
  }
  const waiting = readGoalSnapshot({ version: 1, goal: { ...base, waiting: 'jobs', waitFor: ['job_deadbeef'], resumeAt: 5000 } })!;
  assert.equal(goalUserState(waiting, 'waiting_jobs'), 'waiting'); assert.deepEqual(waiting.waitFor, ['job_deadbeef']);
  assert.equal(goalUserState({ ...waiting, waiting: undefined }, 'idle'), 'running');
  const completed = readGoalSnapshot({ version: 1, goal: { ...base, status: 'completed', automatic: false, completedAt: 123 } })!;
  assert.equal(goalUserState(completed, 'detached'), 'completed'); assert.equal(completed.completedAt, 123);
  assert.throws(() => readGoalSnapshot({ version: 2, goal: { ...base, automatic: false } }), /permission/);
  assert.throws(() => readGoalSnapshot({ version: 2, goal: { ...base, status: 'paused', automatic: false, reason: { kind: 'manual' }, resumeRequired: false } }), /permission/);
  assert.throws(() => readGoalSnapshot({ version: 3, goal: base }), /Invalid persisted/);
});

test('legacy stop retains automatic guard; snapshot permission blocks stale branches and grants only selected revision', () => {
  const entries: { type: 'custom'; customType: string; data: unknown }[] = [{ type: 'custom', customType: GOAL_ENTRY, data: { version: 1,
    goal: { ...base, status: 'stopped', automatic: false, stoppedFrom: 'active', autoStopReason: 'repeated_tools' } } }];
  const ctx = { sessionManager: { getEntries: () => entries } } as unknown as ExtensionContext;
  const goal = readGoalSnapshot({ version: 1, goal: base })!;
  const paused = readGoalSnapshot(entries[0].data)!;
  assert.equal(paused.reason?.kind, 'historical_stop'); assert.equal(paused.reason?.previous, 'active');
  assert.equal(paused.reason?.automaticStop, 'repeated_tools'); assert.equal(paused.resumeRequired, true);
  assert.ok(goalRequiresResume(ctx, goal), 'legacy auto guard without resumeRequired is still a revocation');
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 1, goal: { ...base, status: 'active', automatic: true } } });
  assert.equal(goalRequiresResume(ctx, goal), undefined, 'v1 explicit resume cleared the automatic guard without a marker');
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 2, goal: { ...paused, resumeRequired: true } } });
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 1, goal: base } });
  assert.ok(goalRequiresResume(ctx, goal), 'unmarked branch save cannot override explicit revocation');
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 2, goal: { ...goal, resumeRequired: false } } });
  assert.equal(goalRequiresResume(ctx, goal), undefined);
  assert.ok(goalRequiresResume(ctx, { ...goal, revision: 2 }), 'grant cannot authorize another revision');
});
