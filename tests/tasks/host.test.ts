import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { taskPath } from '../../src/tasks/index.ts';
import { taskStore } from '../../src/tasks/store.ts';

const TOOLS = ['task_list', 'task_get', 'task_edit', 'job_start', 'job_stop'];
function lastTool(context: TranscriptContext): string {
  const result = context.messages.findLast(message => message.role === 'toolResult');
  assert.ok(result && result.role === 'toolResult');
  return result.content.map(part => part.type === 'text' ? part.text : '').join('\n');
}
async function call(h: Awaited<ReturnType<typeof host>>, name: string, params: Parameters<typeof fauxToolCall>[1]): Promise<string> {
  let output = '';
  h.faux.setResponses([
    () => fauxAssistantMessage(fauxToolCall(name, params)),
    context => { output = lastTool(context); return fauxAssistantMessage('observed'); },
  ]);
  await h.session.prompt(`Call ${name}`); await h.idle(); return output;
}

test('native task tools retain captured jobs, memory reload and independent memory fork with a visible limitation', { timeout: 20000 }, async () => {
  const root = agentDir(), h = await host({ root, tools: TOOLS });
  let forked: Awaited<ReturnType<typeof host>> | undefined;
  const runtime = new AgentSessionRuntime(h.session, h.services, async options => {
    forked = await host({ root, tools: TOOLS, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...forked, diagnostics: [] };
  });
  try {
    assert.match(await call(h, 'task_edit', { op: 'batch', changes: [{ op: 'add', title: 'work', children: ['run job', 'acceptance'] }] }), /add 1.*add 1\.1.*group 1.*add 1\.2.*group 1/s);
    assert.equal(existsSync(join(root, '.pi', 'tasks')), false, 'no-session lists never write files');
    await h.session.reload();
    assert.match(await call(h, 'task_list', {}), /1 work · 0\/2 · todo/);
    assert.match(await call(h, 'task_list', { id: '1.1', parentId: '1' }), /INVALID_ARGS/);
    assert.match(await call(h, 'job_start', { command: 'echo should-not-start', taskId: '1' }), /expected to match/);
    const started = await call(h, 'job_start', { command: 'echo linked; read line', taskId: '1.1' });
    const id = /job_[a-f0-9]{8}/.exec(started)![0];
    assert.match(await call(h, 'task_get', { id: '1.1' }), new RegExp(`jobs: ${id}`));
    await call(h, 'task_edit', { op: 'batch', changes: [{ op: 'delete', id: '1.1' }] });
    const jobs = acquireRuntime(root); if (jobs.mode !== 'active') throw new Error('jobs unavailable');
    assert.equal(jobs.manager.peek(id).state, 'running');
    assert.equal(jobs.manager.peek(id).taskId, '1.1');
    await call(h, 'job_stop', { id });
    assert.match(await call(h, 'task_get', { id: '1.2' }), /todo/);
    const source = taskStore(`memory:${root}:${h.session.sessionManager.getSessionId()}`), snapshot = await source.snapshot();
    await runtime.fork(h.session.sessionManager.getLeafId()!, { position: 'at' });
    assert.ok(forked);
    assert.ok(forked.notices.some(notice => notice.type === 'warning' && /not inherited.*in-memory source.*independent task list/.test(notice.text)));
    assert.equal(forked.session.sessionFile, undefined);
    assert.match(await call(forked, 'task_list', { state: 'all' }), /^tasks 0\/0/);
    assert.match(await call(forked, 'task_edit', { op: 'add', title: 'new memory list' }), /add 1/);
    await forked.session.reload();
    assert.match(await call(forked, 'task_list', { state: 'all' }), /1 new memory list/);
    assert.deepEqual(await source.snapshot(), snapshot, 'memory fork does not redirect captured source stores');
    assert.equal(existsSync(join(root, '.pi', 'tasks')), false, 'memory fork never persists a task handoff');
  } finally { await runtime.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('real runtime new/resume/fork and reload preserve independent versioned lists and inherited ID counters', { timeout: 20000 }, async () => {
  const root = agentDir();
  let current = await host({ root, persisted: true, tools: TOOLS });
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({ root, tools: TOOLS, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...current, diagnostics: [] };
  });
  try {
    await call(current, 'task_edit', { op: 'batch', changes: [{ op: 'add', title: 'original', children: ['child', 'removed child'] },
      { op: 'add', parentId: '1', title: 'later child', blockedBy: ['1.1'] }, { op: 'delete', id: '1.2' }] });
    const original = current.session.sessionFile!, originalId = current.session.sessionManager.getSessionId();
    const originalStore = taskStore(taskPath(root, originalId), taskPath(root, originalId));
    assert.equal((await originalStore.snapshot()).version, 3);
    await runtime.newSession();
    assert.match(await call(current, 'task_list', { state: 'all' }), /^tasks 0\/0/);
    await runtime.switchSession(original);
    assert.match(await call(current, 'task_list', {}), /original/);
    const snapshot = await originalStore.snapshot();
    await runtime.fork(current.session.sessionManager.getLeafId()!, { position: 'at' });
    assert.notEqual(current.session.sessionManager.getSessionId(), originalId);
    const copy = taskStore(taskPath(root, current.session.sessionManager.getSessionId()), taskPath(root, current.session.sessionManager.getSessionId()));
    assert.deepEqual(await copy.snapshot(), snapshot, 'fork includes nextChild, dependencies, state and all counters');
    assert.equal(snapshot.tasks.find(task => task.id === '1')?.nextChild, 4);
    assert.match(await call(current, 'task_list', {}), /1 original/);
    await call(current, 'task_edit', { op: 'batch', changes: [{ op: 'update', id: '1.1', status: 'done' }, { op: 'add', title: 'fork group' }] });
    await current.session.reload();
    assert.match(await call(current, 'task_list', { state: 'all' }), /1 original · 1\/2 · todo.*2 fork group/s);
    await runtime.switchSession(original);
    assert.match(await call(current, 'task_list', { state: 'all' }), /1 original · 0\/2 · todo/);
    assert.equal((await originalStore.snapshot()).nextId, 2);
    await call(current, 'task_edit', { op: 'delete', id: '1', cascade: true });
    await runtime.fork(current.session.sessionManager.getLeafId()!, { position: 'at' });
    assert.match(await call(current, 'task_list', { state: 'all' }), /^tasks 0\/0/);
    assert.match(await call(current, 'task_edit', { op: 'add', title: 'after empty fork' }), /add 2/);
    assert.deepEqual((await originalStore.snapshot()).tasks, [], 'fork edits never change the emptied source');
  } finally { await runtime.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('task reminders use request context only, shorten for doing children, reset on use and honor project disable', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-reminder-')), h = await host({ root, tools: TOOLS });
  const shown: boolean[] = [];
  const ask = async () => {
    h.faux.setResponses([context => { shown.push(JSON.stringify(context.messages).includes('Task reminder:')); return fauxAssistantMessage('working'); }]);
    await h.session.prompt('Continue work'); await h.idle();
  };
  try {
    await call(h, 'task_edit', { op: 'batch', changes: [{ op: 'add', title: 'group', children: ['child'] }] });
    await ask(); await ask(); await ask(); await ask();
    assert.deepEqual(shown, [false, false, true, false], 'todo interval is four turns from the task call');
    await call(h, 'task_edit', { op: 'batch', changes: [{ op: 'update', id: '1.1', status: 'doing' }] });
    shown.length = 0; await ask(); await ask(); await ask();
    assert.deepEqual(shown, [true, false, false], 'doing interval is two turns, injected once until task usage resets it');
    assert.ok(!JSON.stringify(h.session.sessionManager.getEntries()).includes('Task reminder:'), 'reminders never persist in the transcript');
    mkdirSync(join(root, '.pi'), { recursive: true }); writeFileSync(join(root, '.pi', 'pi-suite.json'), JSON.stringify({ tasks: { reminders: false } }));
    await h.session.reload(); shown.length = 0;
    await call(h, 'task_list', {}); await ask(); await ask(); await ask(); await ask();
    assert.deepEqual(shown, [false, false, false, false]);
  } finally { await h.dispose(); rmSync(root, { recursive: true, force: true }); }
});
