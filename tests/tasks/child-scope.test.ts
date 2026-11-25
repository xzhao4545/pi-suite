import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { listTasks, taskCall } from '../support/tasks.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { taskStore } from '../../src/tasks/store.ts';
import { ToolError } from '../../src/runtime/errors.ts';

const scopeError = (error: unknown) => error instanceof ToolError && error.code === 'TASK_SCOPE';

test('SDK child CRUD and reminders stay private; memory resume reuses the child session target', {timeout: 15000}, async () => {
  const root = agentDir(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const h = await host({root}), manager = agentRuntime().owner, ctx = h.session.extensionRunner.createContext();
  const config = loadConfig(root, root); config.agents.persistSessions = false;
  const parent = taskStore(`memory:${root}:${ctx.sessionManager.getSessionId()}`);
  try {
    await parent.edit([{op: 'add', title: 'parent-only group', children: ['parent-only work']}], parent.current.generation);
    const before = await parent.snapshot(); let updates = 0, reminders = '';
    const off = parent.subscribe(() => { updates++; });
    h.faux.setResponses([
      listTasks(),
      taskCall('task_edit', generation => ({generation, op: 'add', title: 'private group', children: ['private work', 'discard']})),
      taskCall('task_edit', generation => ({generation, op: 'batch', changes: [
          {op: 'update', id: '1.1', title: 'private actual work'}, {op: 'delete', id: '1.2'}, {op: 'start', id: '1.1'}]})),
      async context => {
        assert.equal(context.messages.findLast(message => message.role === 'toolResult')?.isError, false);
        entered.resolve(); await finish.promise; return fauxAssistantMessage(fauxToolCall('bash', {command: 'printf child-step-one'}));
      },
      fauxAssistantMessage(fauxToolCall('bash', {command: 'printf child-step-two'})),
      context => {
        reminders = JSON.stringify(context.messages.filter(message => message.role === 'user' && JSON.stringify(message.content).includes('Task reminder:')));
        return fauxAssistantMessage('private result');
      },
    ]);
    const run = await manager.start({prompt: 'organize privately', background: false}, {ctx, taskStore: parent}, config);
    await entered.promise;
    const store = run.taskStore!, runner = run.session!.extensionRunner;
    assert.strictEqual(store, taskStore(`memory:${root}:${run.sessionManager!.getSessionId()}`));
    assert.notStrictEqual(store, parent);
    assert.deepEqual(store.current.tasks.map(task => task.title), ['private group', 'private actual work']);
    const tool = run.session!.getToolDefinition('task_get')!;
    await assert.rejects(tool.execute('no-assignment', {scope: 'assigned', id: '1.1', generation: store.current.generation}, new AbortController().signal, undefined,
      runner.createContext() as never), scopeError);
    finish.resolve(); assert.equal((await run.done.promise).state, 'completed', run.record.error);
    assert.match(reminders, /private actual work/); assert.doesNotMatch(reminders, /parent-only/);
    h.faux.setResponses([fauxAssistantMessage('resumed private result')]);
    const resumed = await manager.send(run.record.id, 'continue privately', {ctx, taskStore: parent}, config);
    assert.equal((await resumed.run.done.promise).state, 'completed', resumed.run.record.error);
    assert.strictEqual(resumed.run.taskStore, store);
    assert.deepEqual(await parent.snapshot(), before); assert.equal(updates, 0); off();
  } finally { finish.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('assigned scope reads and changes only the delegated task; colliding private IDs and denied batches never redirect writes', {timeout: 15000}, async () => {
  const root = agentDir(), entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  const h = await host({root}), manager = agentRuntime().owner, ctx = h.session.extensionRunner.createContext();
  const parent = taskStore(`memory:${root}:${ctx.sessionManager.getSessionId()}`);
  try {
    await parent.edit([{op: 'add', title: 'parent group', children: ['assigned work', 'parent secret']},
      {op: 'update', id: '1.2', blockedBy: ['1.1']}], parent.current.generation);
    h.faux.setResponses([async () => { entered.resolve(); await finish.promise; return fauxAssistantMessage('assigned result'); }]);
    const run = await manager.start({prompt: 'complete assigned work', taskId: '1.1', taskGeneration: parent.current.generation, background: false}, {ctx, taskStore: parent}, loadConfig(root, root));
    await entered.promise;
    const childCtx = run.session!.extensionRunner.createContext();
    // The assignment captured the parent generation at agent_start; private reads use the child list.
    const assignedGeneration = run.record.taskGeneration!;
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = run.session!.getToolDefinition(name)!;
      const generation = args.scope === 'assigned' ? assignedGeneration : run.taskStore!.current.generation;
      const params = tool.prepareArguments ? tool.prepareArguments({...args, generation}) : {...args, generation};
      return tool.execute('assigned-contract', params, new AbortController().signal, undefined, childCtx as never);
    };
    assert.match(run.session!.getToolDefinition('task_edit')!.description, /assigned parent task is 1\.1/);
    await call('task_edit', {op: 'add', title: 'private group', children: ['private work']});
    assert.match(JSON.stringify((await call('task_get', {id: '1.1'})).content), /private work/);
    assert.match(JSON.stringify((await call('task_get', {scope: 'assigned', id: '1.1'})).content), /assigned work/);
    const before = await parent.snapshot();
    for (const args of [
      {op: 'clear'}, {op: 'add', title: 'forbidden'}, {op: 'update', id: '1.1', description: 'forbidden'},
      {op: 'delete', id: '1.1'}, {op: 'done', id: '1.2'},
      {op: 'batch', changes: [{op: 'start', id: '1.1'}, {op: 'done', id: '1.2'}]},
    ]) await assert.rejects(call('task_edit', {scope: 'assigned', ...args}), error => scopeError(error) && /assigned task 1\.1/.test(String(error)));
    await assert.rejects(call('task_get', {scope: 'assigned', id: '1.2'}), scopeError);
    assert.deepEqual(await parent.snapshot(), before, 'denied batches are atomic');
    await call('task_edit', {scope: 'assigned', op: 'batch', changes: [
      {op: 'start', id: '1.1'}, {op: 'block', id: '1.1', reason: 'waiting'}, {op: 'unblock', id: '1.1'}]});
    const done = await call('task_edit', {scope: 'assigned', op: 'done', id: '1.1'});
    assert.doesNotMatch(JSON.stringify(done), /parent secret/);
    assert.deepEqual((done.details as {derived: unknown[]; progress: unknown[]}).derived, []);
    assert.deepEqual((done.details as {progress: unknown[]}).progress, []);
    assert.equal(parent.current.tasks.find(task => task.id === '1.1')?.status, 'done');
    assert.equal(run.taskStore!.current.tasks.find(task => task.id === '1.1')?.status, 'todo');
    await call('task_edit', {op: 'update', id: '1.1', description: 'private note'});
    assert.equal(parent.current.tasks.find(task => task.id === '1.1')?.description, undefined);
    // Clearing never stops the live child, but its captured assignment cannot hit reused IDs.
    await parent.clear(assignedGeneration);
    await parent.edit([{op: 'add', title: 'replacement group', children: ['replacement work']}], parent.current.generation);
    const replacement = await parent.snapshot();
    await assert.rejects(call('task_get', {scope: 'assigned', id: '1.1'}), {code: 'TASK_STALE'});
    await assert.rejects(call('task_edit', {scope: 'assigned', op: 'done', id: '1.1'}), {code: 'TASK_STALE'});
    assert.equal(run.controller.signal.aborted, false);
    assert.deepEqual(await parent.snapshot(), replacement);
    finish.resolve(); assert.equal((await run.done.promise).state, 'completed', run.record.error);
    await assert.rejects(manager.send(run.record.id, 'resume expired assignment', {ctx, taskStore: parent}, loadConfig(root, root)), {code: 'TASK_STALE'});
  } finally { finish.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});
