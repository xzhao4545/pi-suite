import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir, testShell } from '../support/jobs.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { transcript, transcriptText, recordsIn } from '../../src/agents/records.ts';
import { taskStore } from '../../src/tasks/store.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { active, type Execution } from '../../src/agents/types.ts';
import { resolveWorkspace } from '../../src/jobs/workspace.ts';
import { resolveSettings } from '../../src/agents/models.ts';
import { resolveType } from '../../src/agents/catalog.ts';

async function setup(persisted = false) {
  const root = agentDir();
  let ctx!: ExtensionContext;
  const h = await host({ root, persisted, tools: ['agent_start', 'agent_send', 'agent_read', 'agent_list', 'agent_stop', 'wait'],
    extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  return { ...h, root, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
function until(manager: AgentManager, condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Condition not reached')); }, 5000);
    const off = manager.subscribe(() => { if (condition()) { clearTimeout(timer); off(); resolve(); } });
  });
}

test('SDK child persists a bounded run leaf, resumes with a fresh run ID and retains prior history', { timeout: 15000 }, async () => {
  const h = await setup(true);
  try {
    h.faux.setResponses([fauxAssistantMessage('first result'), fauxAssistantMessage('second result')]);
    const first = await h.manager.start({ prompt: 'first task', background: false }, { ctx: h.ctx }, h.config);
    const finished = await first.done.promise;
    assert.equal(finished.state, 'completed', finished.error);
    assert.equal(finished.result, 'first result');
    assert.ok(finished.sessionFile);
    const saved = SessionManager.open(finished.sessionFile!);
    assert.equal(recordsIn(saved.getEntries())[0].runId, finished.runId);
    const resumed = await h.manager.send(finished.id, 'second task', { ctx: h.ctx }, h.config);
    assert.equal(resumed.action, 'resumed');
    const second = await resumed.run.done.promise;
    assert.equal(second.id, finished.id); assert.notEqual(second.runId, finished.runId);
    assert.equal(second.state, 'completed', second.error); assert.equal(second.result, 'second result');
    assert.ok(transcriptText(transcript(second, resumed.run)).includes('first task'));
    assert.ok(!transcriptText(transcript(finished)).includes('second task'));
    assert.equal(h.faux.state.callCount, 2, 'reading history performs no requests');
    assert.ok(recordsIn(h.session.sessionManager.getBranch()).some(record => record.runId === second.runId));
    await h.session.reload();
    assert.equal(agentRuntime().get(first.record.id).record.runId, second.runId);
  } finally { await h.cleanup(); }
});

test('shared two-pool queue bypasses a saturated head, keeps charging stable and wakes stopped queued runs', { timeout: 15000 }, async () => {
  const h = await setup();
  const gates = new Map<string, PromiseWithResolvers<void>>();
  const manager = new AgentManager(async run => { const gate = Promise.withResolvers<void>(); gates.set(run.record.name, gate); await gate.promise; }, async () => []);
  try {
    const config = { ...h.config, agents: { ...h.config.agents, maxConcurrent: 1, maxConcurrentForeground: 1 } };
    const scope = { ctx: h.ctx };
    const first = await manager.start({ prompt: 'work', name: 'foreground1', background: false }, scope, config);
    const blocked = await manager.start({ prompt: 'work', name: 'foreground2', background: false }, scope, config);
    const background = await manager.start({ prompt: 'work', name: 'background1' }, scope, config);
    const pending = await manager.start({ prompt: 'work', name: 'background2' }, scope, config);
    assert.equal(first.record.state, 'starting'); assert.equal(blocked.record.state, 'queued');
    assert.equal(background.record.state, 'starting'); assert.equal(pending.record.state, 'queued');
    const stopped = await manager.stop(blocked.record.id);
    assert.equal(stopped.state, 'stopped'); assert.equal((await blocked.done.promise).state, 'stopped');
    manager.configure({ ...config, agents: { ...config.agents, maxConcurrent: 2, maxConcurrentForeground: 0 } });
    assert.equal(pending.chargedPool, 'background'); assert.equal(first.chargedPool, 'foreground');
    for (const gate of gates.values()) gate.resolve();
    await Promise.all([first.done.promise, background.done.promise, pending.done.promise]);
    assert.equal(manager.records().filter(record => active(record.state)).length, 0);
  } finally { await h.cleanup(); }
});

test('child asks its parent through native tools; frontend wait returns, answer continues and shared tasks remain on owner list', { timeout: 15000 }, async () => {
  const h = await setup();
  const store = taskStore(`test:${h.root}`);
  await store.edit([{ op: 'add', title: 'group', children: ['child'] }]);
  let run!: Execution;
  try {
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('ask_user', { question: 'Which target?', options: [{ id: 'a', title: 'Alpha' }], timeoutMs: 0 })),
      fauxAssistantMessage('Parent saw question'),
      context => { assert.match(JSON.stringify(context.messages), /"optionIds":\["a"\]/); return fauxAssistantMessage(fauxToolCall('task_edit', { changes: [{ op: 'update', id: '2', status: 'doing' }] })); },
      fauxAssistantMessage('child finished'),
    ]);
    run = await h.manager.start({ prompt: 'ask then work', taskId: '2', background: false }, { ctx: h.ctx, taskStore: store }, h.config);
    await until(h.manager, () => Boolean(run.question));
    assert.equal(run.record.state, 'waiting');
    await h.idle();
    const sent = await h.manager.send(run.record.id, 'a', { ctx: h.ctx }, h.config);
    assert.equal(sent.action, 'answered');
    const result = await run.done.promise;
    assert.equal(result.state, 'completed', result.error);
    const data = await store.snapshot();
    assert.equal(data.tasks.find(task => task.id === '2')?.status, 'doing');
    assert.equal(data.tasks.find(task => task.id === '2')?.owner, run.record.id);
  } finally { await h.cleanup(); }
});

test('stop cascades to a child-created job after child settlement, joins repeated requests and leaves unrelated jobs alone', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    writeFileSync(join(h.root, 'pi-suite.json'), JSON.stringify({ jobs: { launchPolicy: [{ command: 'echo created; read line', decision: 'allow' }] } }));
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo created; read line' })),
      fauxAssistantMessage('started background job'),
    ]);
    const child = await h.manager.start({ prompt: 'start a job', background: false }, { ctx: h.ctx }, h.config);
    const done = await child.done.promise;
    assert.equal(done.state, 'completed', done.error);
    const runtime = acquireRuntime(h.root); if (runtime.mode !== 'active') throw new Error('jobs unavailable');
    const jobs = (await runtime.manager.list(await resolveWorkspace(h.root))).jobs;
    const owned = jobs.map(row => row.job).find(job => job.creator?.runId === done.runId);
    assert.ok(owned); assert.equal(owned.state, 'running');
    assert.deepEqual(owned.creator?.ancestors, []);
    const sibling = await runtime.manager.start({ command: 'echo sibling; read line', cwd: h.root, ownerSessionId: h.ctx.sessionManager.getSessionId(), anchorEntryId: null }, testShell());
    const a = h.manager.stop(done.id), b = h.manager.stop(done.id);
    assert.equal(a, b);
    const outcome = await a;
    assert.ok(outcome.affected.some(item => item.id === owned.id && item.state === 'stopped'));
    assert.equal(runtime.manager.peek(owned.id).cleanup.rootExited, true);
    assert.equal(runtime.manager.peek(sibling.id).state, 'running');
  } finally { await h.cleanup(); }
});

test('native foreground start returns a question, parent answers and shared wait observes final settlement', { timeout: 15000 }, async () => {
  const h = await setup();
  let childId = '', asked = false, completed = false;
  try {
    const respond: Parameters<typeof h.faux.setResponses>[0][number] = context => {
      const child = JSON.stringify(context.messages.filter(message => message.role === 'user')).includes('child-question-task');
      const result = context.messages.findLast(message => message.role === 'toolResult');
      if (child) {
        if (!result) return fauxAssistantMessage(fauxToolCall('ask_user', { question: 'Proceed?', timeoutMs: 0 }));
        assert.match(JSON.stringify(result), /confirmed/); completed = true; return fauxAssistantMessage('child result');
      }
      if (!result) return fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'child-question-task', background: false }));
      const output = result.content.map(part => part.type === 'text' ? part.text : '').join('\n');
      if (result.toolName === 'agent_start') {
        assert.match(output, /waiting.*Proceed/s); asked = true; childId = /agent_[a-f0-9]{8}/.exec(output)![0];
        return fauxAssistantMessage(fauxToolCall('agent_send', { id: childId, message: 'confirmed' }));
      }
      if (result.toolName === 'agent_send') return fauxAssistantMessage(fauxToolCall('wait', { ids: [childId] }));
      assert.match(output, /completed/); return fauxAssistantMessage('parent finished');
    };
    h.faux.setResponses(Array.from({ length: 10 }, () => respond));
    await h.session.prompt('Delegate and answer'); await h.idle();
    assert.equal(asked, true); assert.equal(completed, true);
    assert.equal(h.manager.get(childId).record.state, 'completed');
  } finally { await h.cleanup(); }
});

test('nested child bypasses an occupied pool and stops with the actual parent run', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    mkdirSync(join(h.root, '.pi', 'agents'), { recursive: true });
    writeFileSync(join(h.root, '.pi', 'agents', 'nested.md'), '---\nname: nested\nallowed_subagents: all\n---\nDelegate the task.');
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'grandchild task', background: false })),
      fauxAssistantMessage('nested result'),
      fauxAssistantMessage('parent result'),
    ]);
    const config = { ...h.config, agents: { ...h.config.agents, maxConcurrent: 1, maxConcurrentForeground: 1 } };
    const parent = await h.manager.start({ type: 'nested', prompt: 'parent task', background: false }, { ctx: h.ctx }, config);
    const done = await parent.done.promise;
    assert.equal(done.state, 'completed', done.error);
    const nested = [...h.manager.runs.values()].find(run => run.record.parentRunId === parent.record.runId);
    assert.ok(nested); assert.equal(nested.record.state, 'completed'); assert.equal(nested.chargedPool, undefined);
    assert.deepEqual(nested.record.ancestors, [parent.record.runId]); assert.equal(nested.record.persisted, false);
  } finally { await h.cleanup(); }
});

test('model/thinking sources merge per field and explicit provider identity never substitutes a model', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    await h.session.modelRuntime.setRuntimeApiKey(h.ctx.model!.provider, 'offline-test');
    const name = `${h.ctx.model!.provider}/${h.ctx.model!.id}`;
    writeFileSync(join(h.root, 'pi-suite.json'), JSON.stringify({ agents: { types: { Explore: { model: name, thinking: 'low' } } } }));
    mkdirSync(join(h.root, '.pi'), { recursive: true });
    writeFileSync(join(h.root, '.pi', 'pi-suite.json'), JSON.stringify({ agents: { types: { Explore: { thinking: 'high' } } } }));
    const config = loadConfig(h.root, h.root), type = resolveType(h.root, 'explore');
    const settings = resolveSettings(h.ctx, type, { prompt: 'look' }, config);
    assert.equal(settings.modelSource, 'type'); assert.equal(settings.thinking, 'high');
    assert.equal(resolveSettings(h.ctx, type, { prompt: 'look', thinking: 'off' }, config).thinkingSource, 'parameter');
    assert.throws(() => resolveSettings(h.ctx, type, { prompt: 'look', model: 'missing-provider/offline' }, config), /agent_start.model.*unavailable/);
    assert.equal(h.faux.state.callCount, 0);
  } finally { await h.cleanup(); }
});

test('actual SDK abort cancels a parent question and timeout never submits its default', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('ask_user', { question: 'Need approval', defaultAnswer: 'yes', timeoutMs: 0 })), fauxAssistantMessage('parent observed')]);
    const run = await h.manager.start({ prompt: 'ask for approval', background: false }, { ctx: h.ctx }, h.config);
    await until(h.manager, () => Boolean(run.question)); await h.idle();
    const outcome = await h.manager.stop(run.record.id);
    assert.equal(outcome.state, 'stopped'); assert.equal(run.question, undefined);
    assert.match(transcriptText(transcript(run.record, run)), /cancelled/);
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('ask_user', { question: 'Need approval', defaultAnswer: 'yes', timeoutMs: 10 })), fauxAssistantMessage('parent observed timeout')]);
    const expired = await h.manager.start({ prompt: 'ask and expire', background: false }, { ctx: h.ctx }, h.config);
    const result = await expired.done.promise;
    assert.equal(result.state, 'stopped', result.error);
    assert.match(transcriptText(transcript(result, expired)), /timed_out.*"response":null/s);
  } finally { await h.cleanup(); }
});
