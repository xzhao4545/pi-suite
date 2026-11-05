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

const TOOLS = ['task_list', 'task_edit', 'job_start', 'job_stop'];
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

test('native task tools link jobs to execution tasks; deletion keeps the job running and memory reload retains the list', { timeout: 20000 }, async () => {
  const root = agentDir(), h = await host({ root, tools: TOOLS });
  try {
    assert.match(await call(h, 'task_edit', { changes: [{ op: 'add', title: 'work', children: ['run job', 'acceptance'] }] }), /add #1.*add #2 parent #1.*add #3 parent #1/s);
    assert.equal(existsSync(join(root, '.pi', 'tasks')), false, 'no-session lists never write files');
    await h.session.reload();
    assert.match(await call(h, 'task_list', {}), /#1 work · 0\/2 · todo/);
    assert.match(await call(h, 'task_list', { id: '2', parentId: '1' }), /INVALID_ARGS/);
    assert.match(await call(h, 'job_start', { command: 'echo should-not-start', taskId: '1' }), /No execution task/);
    const started = await call(h, 'job_start', { command: 'echo linked; read line', taskId: '2' });
    const id = /job_[a-f0-9]{8}/.exec(started)![0];
    assert.match(await call(h, 'task_list', { id: '2', detail: true }), new RegExp(`jobs: ${id}`));
    await call(h, 'task_edit', { changes: [{ op: 'delete', id: '2' }] });
    const runtime = acquireRuntime(root); if (runtime.mode !== 'active') throw new Error('jobs unavailable');
    assert.equal(runtime.manager.peek(id).state, 'running');
    assert.equal(runtime.manager.peek(id).taskId, '2');
    await call(h, 'job_stop', { id });
    assert.match(await call(h, 'task_list', { id: '3' }), /todo/);
  } finally { await h.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('real runtime new/resume/fork and reload preserve independent versioned lists and inherited ID counters', { timeout: 20000 }, async () => {
  const root = agentDir();
  let current = await host({ root, persisted: true, tools: TOOLS });
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({ root, tools: TOOLS, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...current, diagnostics: [] };
  });
  try {
    await call(current, 'task_edit', { changes: [{ op: 'add', title: 'original', children: ['child'] }] });
    const original = current.session.sessionFile!, originalId = current.session.sessionManager.getSessionId();
    const originalStore = taskStore(taskPath(root, originalId), taskPath(root, originalId));
    assert.equal((await originalStore.snapshot()).version, 1);
    await runtime.newSession();
    assert.match(await call(current, 'task_list', { includeDone: true }), /^tasks 0 items/);
    await runtime.switchSession(original);
    assert.match(await call(current, 'task_list', {}), /original/);
    await runtime.fork(current.session.sessionManager.getLeafId()!, { position: 'at' });
    assert.notEqual(current.session.sessionManager.getSessionId(), originalId);
    assert.match(await call(current, 'task_list', {}), /#1 original/);
    await call(current, 'task_edit', { changes: [{ op: 'update', id: '2', status: 'done' }, { op: 'add', title: 'fork group' }] });
    await current.session.reload();
    assert.match(await call(current, 'task_list', { includeDone: true }), /#1 original · 1\/1 · done.*#3 fork group/s);
    await runtime.switchSession(original);
    assert.match(await call(current, 'task_list', { includeDone: true }), /#1 original · 0\/1 · todo/);
    assert.equal((await originalStore.snapshot()).nextId, 3);
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
    await call(h, 'task_edit', { changes: [{ op: 'add', title: 'group', children: ['child'] }] });
    await ask(); await ask(); await ask(); await ask();
    assert.deepEqual(shown, [false, false, true, false], 'todo interval is four turns from the task call');
    await call(h, 'task_edit', { changes: [{ op: 'update', id: '2', status: 'doing' }] });
    shown.length = 0; await ask(); await ask(); await ask();
    assert.deepEqual(shown, [true, false, false], 'doing interval is two turns, injected once until task usage resets it');
    assert.ok(!JSON.stringify(h.session.sessionManager.getEntries()).includes('Task reminder:'), 'reminders never persist in the transcript');
    mkdirSync(join(root, '.pi'), { recursive: true }); writeFileSync(join(root, '.pi', 'pi-suite.json'), JSON.stringify({ tasks: { reminders: false } }));
    await h.session.reload(); shown.length = 0;
    await call(h, 'task_list', {}); await ask(); await ask(); await ask(); await ask();
    assert.deepEqual(shown, [false, false, false, false]);
  } finally { await h.dispose(); rmSync(root, { recursive: true, force: true }); }
});
