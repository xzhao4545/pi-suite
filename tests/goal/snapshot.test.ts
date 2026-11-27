import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { GOAL_ENTRY, importGoal, readGoalSnapshot } from '../../src/goal/snapshot.ts';
import { goalUserState } from '../../src/goal/state.ts';

const base = { id: 'goal', revision: 1, text: 'Verify the original requirement', status: 'active', automatic: true,
  budget: 1000, usedTokens: 27, elapsedMs: 900, turns: 3, progress: 'Evidence', error: 'Original error' };

test('snapshot migration preserves diagnostics and uses the pause kind instead of the old resume flag', () => {
  const cases = [
    [{ status: 'failed' }, 'request_failed'], [{ status: 'blocked' }, 'blocked'],
    [{ status: 'budget_limited' }, 'budget'], [{ status: 'paused' }, 'manual'],
    [{ status: 'stopped', stoppedFrom: 'blocked' }, 'historical_stop'],
    [{ automatic: false }, 'compaction_failed'], [{ automatic: false, error: undefined }, 'cancelled'],
    [{ automatic: false, waiting: 'user' }, 'cancelled'],
    [{ autoStopReason: 'no_tools', automatic: false }, 'no_tools'],
    [{ resumeRequired: true }, 'permission'],
  ] as const;
  for (const [changes, kind] of cases) {
    const raw = { version: 1, goal: { ...base, ...changes } }, original = structuredClone(raw);
    const goal = readGoalSnapshot(raw)!;
    assert.equal(goal.status, 'paused'); assert.equal(goal.automatic, false);
    assert.equal(goal.reason?.kind, kind);
    assert.equal(goal.id, base.id); assert.equal(goal.revision, base.revision); assert.equal(goal.progress, base.progress);
    assert.equal(goal.elapsedMs, 900); assert.equal(goal.usedTokens, 27); assert.equal(goal.budget, 1000); assert.equal(goal.turns, 3);
    assert.deepEqual(raw, original); assert.deepEqual(readGoalSnapshot({ version: 2, goal: { ...goal, resumeRequired: true } }), goal);
    assert.ok(!('stoppedFrom' in goal) && !('autoStopReason' in goal) && !('resumeRequired' in goal));
    assert.equal(goalUserState(goal, 'idle'), 'paused');
  }
  const waiting = readGoalSnapshot({ version: 1, goal: { ...base, waiting: 'jobs', waitFor: ['job_deadbeef'], resumeAt: 5000 } })!;
  assert.equal(goalUserState(waiting, 'waiting_jobs'), 'waiting'); assert.deepEqual(waiting.waitFor, ['job_deadbeef']);
  assert.equal(goalUserState({ ...waiting, waiting: undefined }, 'idle'), 'running');
  const completed = readGoalSnapshot({ version: 1, goal: { ...base, status: 'completed', automatic: false, completedAt: 123 } })!;
  assert.equal(goalUserState(completed, 'detached'), 'completed'); assert.equal(completed.completedAt, 123);
  assert.throws(() => readGoalSnapshot({ version: 2, goal: { ...base, automatic: false } }), /permission/);
  assert.throws(() => readGoalSnapshot({ version: 2, goal: { ...base, status: 'paused', automatic: false } }), /permission/);
  assert.throws(() => readGoalSnapshot({ version: 3, goal: base }), /Invalid persisted/);
});

test('legacy import uses latest physical append, ignores selected leaf and reports damaged newest data', () => {
  const entries: { type: 'custom'; customType: string; data: unknown }[] = [{ type: 'custom', customType: GOAL_ENTRY,
    data: { version: 1, goal: { ...base, status: 'stopped', automatic: false, stoppedFrom: 'active', autoStopReason: 'repeated_tools' } } }];
  const ctx = { sessionManager: { getEntries: () => entries, getBranch: () => entries.slice(0, 1) } } as unknown as ExtensionContext;
  const paused = importGoal(ctx)!;
  assert.equal(paused.reason?.kind, 'historical_stop'); assert.equal(paused.reason?.automaticStop, 'repeated_tools');
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 2, goal: { ...base, revision: 2 } } });
  assert.equal(importGoal(ctx)?.revision, 2);
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 2, goal: null } });
  assert.equal(importGoal(ctx), undefined);
  entries.push({ type: 'custom', customType: GOAL_ENTRY, data: { version: 2, goal: { broken: true } } });
  assert.throws(() => importGoal(ctx), /Invalid persisted/);
});
