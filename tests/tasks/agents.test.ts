import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSessionRuntime, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { listTasks, taskCall } from '../support/tasks.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { taskPath } from '../../src/tasks/index.ts';
import { taskStore } from '../../src/tasks/store.ts';
import { taskViews } from '../../src/tasks/model.ts';

function lastTool(context: TranscriptContext) {
  const result = context.messages.findLast(message => message.role === 'toolResult');
  if (result?.role === 'toolResult') assert.equal(result.isError, false, JSON.stringify(result.content));
  return result;
}

test('two SDK children update only their assigned progress concurrently without deriving completion from settlement', {timeout: 15000}, async () => {
  const root = agentDir(), barrier = Promise.withResolvers<void>();
  let ctx!: ExtensionContext, arrived = 0;
  const h = await host({root, persisted: true, tools: ['task_edit', 'agent_start'],
    extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const manager = agentRuntime().owner;
  const invoke = (name: string, params: object) => h.session.getToolDefinition(name)!.execute('tasks-concurrent', params,
    new AbortController().signal, undefined, ctx as never);
  try {
    h.faux.setResponses([fauxAssistantMessage('parent seed')]); await h.session.prompt('seed durable owner');
    const path = taskPath(root, ctx.sessionManager.getSessionId()), store = taskStore(path, path);
    await store.snapshot();
    const ownerGeneration = store.current.generation;
    await invoke('task_edit', {generation: ownerGeneration, op: 'batch', changes: [{op: 'add', title: 'parallel work', children: ['first', 'second']}]});
    const response = async (context: TranscriptContext) => {
      const id = JSON.stringify(context.messages.find(message => message.role === 'user')).includes('first child') ? '1.1' : '1.2';
      const result = lastTool(context);
      if (!result) return fauxAssistantMessage(fauxToolCall('task_get', {generation: ownerGeneration, scope: 'assigned', id}));
      if (result.toolName === 'task_get') {
        assert.match(JSON.stringify(result.content), /parallel work|first|second/);
        // Both children read their assigned task before either issues a progress write.
        if (++arrived === 2) barrier.resolve();
        await barrier.promise;
        return fauxAssistantMessage(fauxToolCall('task_edit', {generation: ownerGeneration, scope: 'assigned', op: 'start', id}));
      }
      return fauxAssistantMessage(`child ${id} finished`);
    };
    h.faux.setResponses(Array(6).fill(response));
    const calls = ['first child', 'second child'].map(prompt => invoke('agent_start', {prompt, taskId: prompt === 'first child' ? '1.1' : '1.2', taskGeneration: ownerGeneration, background: false}));
    await Promise.all(calls);
    assert.equal(arrived, 2);
    const runs = [...manager.runs.values()]; assert.equal(runs.length, 2);
    const data = await store.snapshot();
    for (const run of runs) {
      assert.strictEqual(run.parent.taskStore, store);
      assert.equal(run.record.state, 'completed', run.record.error);
      const task = data.tasks.find(task => task.id === run.record.taskId)!;
      assert.equal(task.owner, run.record.id); assert.equal(task.status, 'doing');
      assert.equal(task.description, undefined);
      assert.notStrictEqual(run.taskStore, store); assert.equal(run.taskStore?.current.tasks.length, 0);
    }
    assert.deepEqual(taskViews(data).find(task => task.id === '1')?.progress, {done: 0, total: 2});
    assert.deepEqual(readdirSync(join(root, '.pi', 'tasks')), [`tasks-${ctx.sessionManager.getSessionId()}.json`], 'empty child lists create no files');
  } finally { barrier.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('SDK child retains private and assigned stores across parent reload/fork and historical resume; stop leaves actual progress', {timeout: 20000}, async () => {
  const root = agentDir(), entered = Promise.withResolvers<void>(), continueChild = Promise.withResolvers<void>();
  const resumedEntered = Promise.withResolvers<void>(), finishResume = Promise.withResolvers<void>();
  let ctx!: ExtensionContext;
  const extend = (pi: ExtensionAPI) => {
    pi.on('session_start', (_event, context) => { ctx = context; });
  };
  const tools = ['task_edit', 'task_list', 'task_get', 'agent_send'];
  let current = await host({root, persisted: true, tools, extend});
  const first = current, manager = agentRuntime().owner;
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({root, tools, extend, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent});
    return {...current, diagnostics: []};
  });
  try {
    first.faux.setResponses([fauxAssistantMessage('parent seed')]); await first.session.prompt('seed durable owner');
    const originalFile = first.session.sessionFile!, originalId = ctx.sessionManager.getSessionId();
    const originalPath = taskPath(root, originalId), originalStore = taskStore(originalPath, originalPath);
    await originalStore.snapshot();
    const ownerGeneration = originalStore.current.generation;
    await first.session.getToolDefinition('task_edit')!.execute('tasks-lifecycle', {generation: ownerGeneration, op: 'batch', changes: [{op: 'add', title: 'owned work', children: ['execution']},
      {op: 'update', id: '1.1', status: 'doing'}]}, new AbortController().signal, undefined, ctx as never);
    first.faux.setResponses([async () => {
      entered.resolve(); await continueChild.promise; return listTasks();
    }, taskCall('task_edit', generation => ({generation, op: 'batch', changes: [
        {op: 'add', title: 'private work', children: ['private execution']},
        {op: 'update', id: '1.1', description: 'original child after fork'}]})),
    context => { lastTool(context); return fauxAssistantMessage(fauxToolCall('task_edit', {generation: ownerGeneration, scope: 'assigned', op: 'block', id: '1.1', reason: 'parent input needed'})); },
    context => { lastTool(context); return fauxAssistantMessage('original child completed'); }]);
    const run = await manager.start({prompt: 'continue owner task', taskId: '1.1', taskGeneration: ownerGeneration, background: false}, {ctx, taskStore: originalStore}, loadConfig(root, root));
    await entered.promise;
    await first.session.reload();
    assert.strictEqual(agentRuntime().owner, manager); assert.strictEqual(run.parent.taskStore, originalStore);
    await runtime.fork(current.session.sessionManager.getLeafId()!, {position: 'at'});
    const forkId = ctx.sessionManager.getSessionId(); assert.notEqual(forkId, originalId);
    const forkPath = taskPath(root, forkId), forkStore = taskStore(forkPath, forkPath);
    const forkSeed = await forkStore.snapshot();
    assert.equal(forkSeed.tasks.find(task => task.id === '1.1')?.owner, run.record.id);
    continueChild.resolve();
    assert.equal((await run.done.promise).state, 'completed', run.record.error);
    assert.equal(run.record.ownerSessionId, originalId); assert.strictEqual(run.parent.taskStore, originalStore);
    assert.equal((await originalStore.snapshot()).tasks.find(task => task.id === '1.1')?.description, undefined);
    assert.equal((await originalStore.snapshot()).tasks.find(task => task.id === '1.1')?.status, 'blocked');
    const privateStore = run.taskStore!;
    assert.equal((await privateStore.snapshot()).tasks.find(task => task.id === '1.1')?.description, 'original child after fork');
    assert.deepEqual(await forkStore.snapshot(), forkSeed, 'the original child cannot edit the fork copy');

    manager.sweep(Date.now() + 10 * 60_000 + 1);
    assert.equal(manager.get(run.record.id).run, undefined);
    await runtime.switchSession(originalFile);
    assert.equal(ctx.sessionManager.getSessionId(), originalId);
    current.faux.setResponses([listTasks(), taskCall('task_edit', generation => ({generation, op: 'batch', changes: [{op: 'update', id: '1.1', description: 'resumed child progress'}]})),
      async context => { lastTool(context); resumedEntered.resolve(); await finishResume.promise; return fauxAssistantMessage('resume interrupted'); }]);
    const resumed = await current.session.getToolDefinition('agent_send')!.execute('tasks-resume', {id: run.record.id, message: 'resume owner task'},
      new AbortController().signal, undefined, ctx as never);
    assert.equal((resumed.details as {action: string}).action, 'resumed');
    const next = manager.get(run.record.id).run!;
    await resumedEntered.promise;
    assert.equal(next.record.id, run.record.id); assert.notEqual(next.record.runId, run.record.runId);
    assert.equal(next.record.taskId, '1.1'); assert.equal(next.record.ownerSessionId, originalId);
    assert.strictEqual(next.parent.taskStore, originalStore); assert.strictEqual(next.taskStore, privateStore);
    const stopping = manager.stop(next.record.id, next.record.runId); finishResume.resolve();
    await stopping; assert.equal((await next.done.promise).state, 'stopped');
    const task = (await originalStore.snapshot()).tasks.find(task => task.id === '1.1')!;
    assert.equal(task.owner, run.record.id); assert.equal(task.description, undefined); assert.equal(task.status, 'blocked');
    assert.equal((await privateStore.snapshot()).tasks.find(task => task.id === '1.1')?.description, 'resumed child progress');
    assert.deepEqual(await forkStore.snapshot(), forkSeed);
  } finally { continueChild.resolve(); finishResume.resolve(); await runtime.dispose(); rmSync(root, {recursive: true, force: true}); }
});
