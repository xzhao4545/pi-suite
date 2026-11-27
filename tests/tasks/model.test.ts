import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { TaskStore } from '../../src/tasks/store.ts';
import { taskViews } from '../../src/tasks/model.ts';
import { queryTasks } from '../../src/tasks/query.ts';
import { changeSchema } from '../../src/tasks/types.ts';

test('two-level batch changes recompute both groups; invalid batches are atomic and IDs are never reused', async () => {
  const store = new TaskStore();
  const created = await store.edit([{ op: 'add', title: '登录改造', children: ['实现接口', '验证回调'] }, { op: 'add', title: '发布' }], store.current.generation);
  assert.deepEqual(created.changes.map(task => task.id), ['1', '1.1', '1.2', '2']);
  await store.edit([{ op: 'update', id: '1.1', status: 'done' }, { op: 'update', id: '1.2', status: 'doing' }], store.current.generation);
  let data = await store.snapshot();
  assert.deepEqual(queryTasks(data, { parentId: '1' }).map(task => task.id), ['1', '1.2']);
  assert.deepEqual(queryTasks(data, { parentId: '1' })[0].progress, { done: 1, total: 2 });
  assert.equal(queryTasks(data, { id: '1.1' })[0].status, 'done');
  assert.throws(() => queryTasks(data, { id: '1.1', parentId: '1' }), /id and parentId cannot be combined/);
  assert.throws(() => queryTasks(data, { parentId: '1.1' }), /cannot use a child ID/);
  await store.edit([{ op: 'update', id: '1.1', status: 'todo', description: 'acceptance' }], store.current.generation);
  assert.equal(Value.Check(changeSchema, { op: 'update', id: '1.2', parentId: '2' }), false);
  const before = await store.snapshot();
  for (const invalid of [
    { op: 'add', parentId: '1.1', title: 'third level' },
    { op: 'update', id: '1', status: 'done' },
    { op: 'delete', id: '1' },
  ] as const) {
    await assert.rejects(store.edit([{ op: 'add', title: 'must roll back' }, invalid], store.current.generation), /changes\[1\]/);
    assert.deepEqual(await store.snapshot(), before);
  }
  assert.equal(Value.Check(changeSchema, { op: 'add', title: 'nested', children: [{ title: 'not a title string' }] }), false);
  await store.edit([{ op: 'update', id: '1.1', description: '' }, { op: 'delete', id: '2', cascade: true }, { op: 'delete', id: '1.2' }], store.current.generation);
  const added = await store.edit([{ op: 'add', title: 'next group', children: ['next child'] }], store.current.generation);
  assert.deepEqual(added.changes.map(task => task.id), ['3', '3.1']);
  const child = await store.edit([{op: 'add', title: 'replacement', parentId: '1'}], store.current.generation);
  assert.equal(child.changes[0].id, '1.3');
  await store.edit([{op: 'delete', id: '1.3'}], store.current.generation);
  data = await store.snapshot(); assert.equal(data.tasks.find(task => task.id === '1.1')?.description, undefined);
  assert.ok(!data.tasks.some(task => task.id === '1.2' || task.id === '2'));
  await store.edit([{ op: 'update', id: '1.1', status: 'done' }], store.current.generation);
  assert.equal(taskViews(await store.snapshot()).find(task => task.id === '1')?.status, 'done');
  assert.ok(!queryTasks(await store.snapshot(), {}).some(task => task.id === '1'));
  assert.equal(queryTasks(await store.snapshot(), { includeDone: true }).length, 4);
});

test('canonical dependencies expose reverse edges, warn on invalid/open blockers and clear deleted edges', async () => {
  const store = new TaskStore();
  await store.edit([{ op: 'add', title: 'group', children: ['one', 'two', 'three'] }], store.current.generation);
  await store.edit([{ op: 'update', id: '1.2', blockedBy: ['1.1'] }], store.current.generation);
  let views = taskViews(await store.snapshot());
  assert.deepEqual(views.find(task => task.id === '1.1')?.blocks, ['1.2']);
  const warnings = await store.edit([{ op: 'update', id: '1.1', blockedBy: ['1.1', '1.2', '99'] }, { op: 'update', id: '1.2', status: 'doing' }], store.current.generation);
  assert.equal(warnings.warnings.length, 4);
  assert.match(warnings.warnings.join('\n'), /itself.*block each other.*does not exist.*open blockers/s);
  await store.edit([{ op: 'update', id: '1.1', blockedBy: [] }, { op: 'update', id: '1.2', blockedBy: ['1.3'] }, { op: 'delete', id: '1.3' }], store.current.generation);
  views = taskViews(await store.snapshot());
  assert.deepEqual(views.find(task => task.id === '1.1')?.blocks, []);
  assert.deepEqual(views.find(task => task.id === '1.2')?.blockedBy, []);
});
