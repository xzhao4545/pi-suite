import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, stat, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GoalStore, goalPath } from '../../src/goal/store.ts';
import type { Goal } from '../../src/goal/state.ts';
const goal: Goal = { id: 'original', revision: 0, text: 'Audit full objective', status: 'active', automatic: true, usedTokens: 0, turns: 0, elapsedMs: 0, progress: '' };

test('one current atomic state merges late accounting without reviving paused/cleared/replaced goals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-goal-store-')), path = goalPath(root, '../custom/id');
  const a = new GoalStore(path, '../custom/id'), b = new GoalStore(path, '../custom/id');
  try {
    let imports = 0; await a.initialize(() => { imports++; return goal; });
    await b.initialize(() => { imports++; return undefined; }); assert.equal(imports, 1);
    const old = await a.snapshot();
    await b.change(b.current, data => { data.control++; Object.assign(data.goal!, { status: 'paused', automatic: false, resumeRequired: true, reason: { kind: 'manual' } }); });
    await a.account(goal.id, 10, () => true); const paused = await a.snapshot();
    assert.equal(paused.goal?.status, 'paused'); assert.equal(paused.goal?.usedTokens, 10);
    await assert.rejects(a.change(old, data => { data.goal = goal; }), { code: 'GOAL_STALE' });
    await a.change(paused, data => { data.control++; data.goal = null; });
    await b.account(goal.id, 100, () => true);
    const cleared = await b.snapshot(); assert.equal(cleared.goal, null);
    await b.initialize(() => goal); assert.equal(b.current.goal, null, 'clear tombstone prevents JSONL re-import');
    await b.change(cleared, data => { data.control++; data.goal = { ...goal, id: 'replacement' }; });
    await a.account(goal.id, 100, () => true);
    assert.equal((await a.snapshot()).goal?.usedTokens, 0);
    assert.deepEqual(await readdir(dirname(path)), ['state.json'], 'no locks, temporaries, snapshots or meter logs survive');
    const before = await stat(path); await a.change(a.current, () => {}); const after = await stat(path);
    assert.equal(before.mtimeMs, after.mtimeMs, 'unchanged state is not rewritten');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt/missing files and cancelled/failed commits cannot silently reuse or overwrite stale state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-goal-invalid-')), path = goalPath(root, 'main'), store = new GoalStore(path, 'main');
  try {
    await store.initialize(() => goal);
    const saved = await readFile(path, 'utf8'), expected = await store.snapshot(), cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(store.change(expected, data => { data.goal = null; }, cancelled.signal));
    assert.equal(await readFile(path, 'utf8'), saved);
    await writeFile(path, '{damaged');
    await assert.rejects(store.initialize(() => goal), { code: 'GOAL_STORE_INVALID' });
    assert.equal(await readFile(path, 'utf8'), '{damaged');
    await unlink(path); assert.equal((await store.snapshot()).goal, null, 'missing is not cached old Goal');
    await mkdir(path); await assert.rejects(store.initialize(() => goal));
    assert.deepEqual(await readdir(dirname(path)), ['state.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cross-host snapshot/subscription revokes older semantic writes while latest usage remains cumulative', async () => {
  const root = await mkdtemp(join(tmpdir(), 'suite-goal-shared-')), path = goalPath(root, 'main');
  const a = new GoalStore(path, 'main'), b = new GoalStore(path, 'main');
  let changed = 0; const unsubscribe = a.subscribe(() => changed++);
  try {
    await a.initialize(() => goal); const old = await a.snapshot(); await b.initialize(() => undefined);
    await Promise.all([a.account(goal.id, 2, () => true), b.account(goal.id, 3, () => true)]);
    await b.change(b.current, data => { data.goal!.revision++; data.goal!.text = 'New objective revision'; });
    await a.snapshot(); assert.ok(changed >= 2);
    await assert.rejects(a.change(old, data => { data.control++; data.goal!.status = 'active'; }), { code: 'GOAL_STALE' });
    assert.equal(a.current.goal?.usedTokens, 5); assert.equal(a.current.goal?.turns, 2); assert.equal(a.current.goal?.revision, 1);
  } finally { unsubscribe(); await rm(root, { recursive: true, force: true }); }
});
