import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { convertResponsesTools } from '../../node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js';
import { host } from '../support/host.ts';
import { TaskStore } from '../../src/tasks/store.ts';
import { taskViews } from '../../src/tasks/model.ts';
import { editArguments } from '../../src/tasks/schema.ts';

const names = ['task_list', 'task_get', 'task_edit', 'job_list', 'job_get', 'agent_list', 'agent_get'];
test('registered object schemas survive Provider conversion; query repair, grouped byte pages and short edits preserve facts', {timeout: 15000}, async () => {
  const h = await host({tools: names});
  const ctx = h.session.extensionRunner.createContext();
  const tool = (name: string) => h.session.getToolDefinition(name)!;
  const invoke = (name: string, params: object) => tool(name).execute('protocol', params, new AbortController().signal, undefined, ctx as never);
  try {
    const converted = convertResponsesTools(names.map(name => ({name, description: tool(name).description,
      parameters: JSON.parse(JSON.stringify(tool(name).parameters))})), {strict: false});
    for (const definition of converted) {
      assert.ok('parameters' in definition); assert.equal(definition.parameters.type, 'object');
      assert.ok(!('anyOf' in definition.parameters), 'top-level parameters must remain an object');
    }
    for (const [name, args] of [
      ['task_list', {groupId: '1', state: 'all'}], ['task_get', {id: '2'}], ['task_edit', {op: 'done', id: '2'}],
      ['job_list', {state: 'finished'}], ['job_get', {id: 'job_12345678'}], ['agent_list', {agentId: 'agent_12345678', state: 'all'}],
      ['agent_get', {id: 'agent_12345678', runId: 'run_87654321', detail: true}],
    ] as const) assert.equal(Value.Check(tool(name).parameters, args), true);
    assert.throws(() => tool('task_list').prepareArguments!({detail: true, id: '1', includeDone: true, parentId: '1'}), /task_list.*groupId.*task_get/);
    assert.throws(() => editArguments({op: 'done', id: '2', changes: [{op: 'start', id: '3'}]}), /No changes committed/);
    const created = await invoke('task_edit', {op: 'add', title: '组', children: Array.from({length: 30}, (_, i) => `${i} 标题`.repeat(30))});
    assert.equal((created.details as {changes: unknown[]}).changes.length, 31);
    const found: string[] = []; let cursor: string | undefined;
    do {
      const result = await invoke('task_list', {groupId: '1', state: 'all', limit: 100, ...cursor ? {cursor} : {}});
      const page = result.details as {tasks: {id: string}[]; nextCursor?: string};
      assert.equal(page.tasks[0].id, '1');
      for (const task of page.tasks) if (task.id !== '1') found.push(task.id);
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      assert.ok(Buffer.byteLength(text) <= 4096); cursor = page.nextCursor;
      if (cursor) assert.match(text, /"groupId":"1","state":"all"/);
    } while (cursor);
    assert.equal(new Set(found).size, 30); assert.equal(found.length, 30);
    const done = await invoke('task_edit', {op: 'done', id: '2'});
    assert.match(JSON.stringify(done.content), /done #2/);
    const repeated = await invoke('task_edit', {op: 'done', id: '2'});
    assert.match(JSON.stringify(repeated.content), /unchanged #2/);
  } finally { await h.dispose(); }
});

test('short task operations preserve concurrent work, derived blockers and atomic failures', async () => {
  const store = new TaskStore(); await store.edit([{op: 'add', title: 'group', children: ['one', 'two', 'three']}]);
  await store.edit([{op: 'start', id: '2'}, {op: 'start', id: '3'}, {op: 'update', id: '4', blockedBy: ['2']}]);
  assert.equal(taskViews(await store.snapshot()).filter(task => task.parentId && task.status === 'doing').length, 2);
  await store.edit([{op: 'block', id: '3', reason: 'server unavailable'}, {op: 'block', id: '4', reason: 'manual'}]);
  await store.edit([{op: 'unblock', id: '4'}]);
  assert.equal(taskViews(await store.snapshot()).find(task => task.id === '4')!.status, 'blocked', 'unblock cannot erase open dependencies');
  const before = await store.snapshot();
  await assert.rejects(store.edit([{op: 'done', id: '2'}, {op: 'block', id: '1'}]), /no changes committed/);
  assert.deepEqual(await store.snapshot(), before);
  await store.edit([{op: 'done', id: '3'}, {op: 'block', id: '3', reason: 'should not reopen'}]);
  assert.equal(store.current.tasks.find(task => task.id === '3')!.status, 'done');
  assert.equal(store.current.tasks.find(task => task.id === '3')!.blockedReason, undefined);
  await store.edit([{op: 'add', title: 'dependent group'}, {op: 'update', id: '4', parentId: '5'}]);
  const unlocked = await store.edit([{op: 'done', id: '2'}]);
  assert.deepEqual(unlocked.derived.map(change => [change.id, change.before, change.status]), [['4', 'blocked', 'todo']]);
  assert.ok(unlocked.progress.some(group => group.id === '5' && group.status === 'todo'), 'cross-group dependency changes enter the same receipt');
});
