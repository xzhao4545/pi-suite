import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { TaskStore } from '../../src/tasks/store.ts';
import { taskViews } from '../../src/tasks/model.ts';
import { queryTasks } from '../../src/tasks/query.ts';
import { changeSchema } from '../../src/tasks/types.ts';

test('two-level batch changes recompute both groups; invalid batches are atomic and IDs are never reused', async () => {
  const store = new TaskStore();
  const created = await store.edit([{ op: 'add', title: '登录改造', children: ['实现接口', '验证回调'] }, { op: 'add', title: '发布' }]);
  assert.deepEqual(created.changes.map(task => task.id), ['1', '2', '3', '4']);
  await store.edit([{ op: 'update', id: '2', status: 'done' }, { op: 'update', id: '3', status: 'doing' }]);
  let data = await store.snapshot();
  assert.deepEqual(queryTasks(data, { parentId: '1' }).map(task => task.id), ['1', '3']);
  assert.deepEqual(queryTasks(data, { parentId: '1' })[0].progress, { done: 1, total: 2 });
  assert.equal(queryTasks(data, { id: '2' })[0].status, 'done');
  assert.throws(() => queryTasks(data, { id: '2', parentId: '1' }), /exclusive/);
  assert.throws(() => queryTasks(data, { parentId: '2' }), /must identify a group/);
  const moved = await store.edit([{ op: 'update', id: '3', parentId: '4' }, { op: 'update', id: '2', status: 'todo', description: 'acceptance' }]);
  assert.deepEqual(moved.progress, [{ id: '1', done: 0, total: 1, status: 'todo' }, { id: '4', done: 0, total: 1, status: 'doing' }]);
  const before = await store.snapshot();
  for (const invalid of [
    { op: 'add', parentId: '2', title: 'third level' },
    { op: 'update', id: '1', status: 'done' },
    { op: 'update', id: '1', parentId: '4' },
    { op: 'delete', id: '1' },
  ] as const) {
    await assert.rejects(store.edit([{ op: 'add', title: 'must roll back' }, invalid]), /changes\[1\]/);
    assert.deepEqual(await store.snapshot(), before);
  }
  assert.equal(Value.Check(changeSchema, { op: 'add', title: 'nested', children: [{ title: 'not a title string' }] }), false);
  await store.edit([{ op: 'update', id: '2', description: '' }, { op: 'delete', id: '4', cascade: true }]);
  const added = await store.edit([{ op: 'add', title: 'next group', children: ['next child'] }]);
  assert.deepEqual(added.changes.map(task => task.id), ['5', '6']);
  data = await store.snapshot(); assert.equal(data.tasks.find(task => task.id === '2')?.description, undefined);
  assert.ok(!data.tasks.some(task => task.id === '3' || task.id === '4'));
  await store.edit([{ op: 'update', id: '2', status: 'done' }]);
  assert.equal(taskViews(await store.snapshot()).find(task => task.id === '1')?.status, 'done');
  assert.ok(!queryTasks(await store.snapshot(), {}).some(task => task.id === '1'));
  assert.equal(queryTasks(await store.snapshot(), { includeDone: true }).length, 4);
});

test('canonical dependencies expose reverse edges, warn on invalid/open blockers and clear deleted edges', async () => {
  const store = new TaskStore();
  await store.edit([{ op: 'add', title: 'group', children: ['one', 'two', 'three'] }]);
  await store.edit([{ op: 'update', id: '3', blockedBy: ['2'] }]);
  let views = taskViews(await store.snapshot());
  assert.deepEqual(views.find(task => task.id === '2')?.blocks, ['3']);
  const warnings = await store.edit([{ op: 'update', id: '2', blockedBy: ['2', '3', '99'] }, { op: 'update', id: '3', status: 'doing' }]);
  assert.equal(warnings.warnings.length, 4);
  assert.match(warnings.warnings.join('\n'), /itself.*block each other.*does not exist.*open blockers/s);
  await store.edit([{ op: 'update', id: '2', blockedBy: [] }, { op: 'update', id: '3', blockedBy: ['4'] }, { op: 'delete', id: '4' }]);
  views = taskViews(await store.snapshot());
  assert.deepEqual(views.find(task => task.id === '2')?.blocks, []);
  assert.deepEqual(views.find(task => task.id === '3')?.blockedBy, []);
});
