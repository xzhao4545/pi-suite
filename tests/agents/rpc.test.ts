import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEventBus, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { AgentsModule } from '../../src/agents/index.ts';
import { AgentRpc } from '../../src/agents/rpc/index.ts';
import type { EventBus, RpcReply } from '../../src/agents/rpc/handlers.ts';
import { compileJsonSchema } from '../../src/agents/output/schema.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { Dock } from '../../src/ui/dock.ts';

function request<T = void>(events: EventBus, method: string, params: Record<string, unknown> = {}): Promise<RpcReply<T>> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID(), channel = `subagents:rpc:${method}`;
    const timer = setTimeout(() => { off(); reject(new Error(`${method} did not reply`)); }, 3000);
    const off = events.on(`${channel}:reply:${requestId}`, data => { clearTimeout(timer); off(); resolve(data as RpcReply<T>); });
    events.emit(channel, { requestId, ...params });
  });
}
function data<T>(reply: RpcReply<T>): T {
  assert.equal(reply.success, true, !reply.success ? reply.error : '');
  return (reply as { success: true; data: T }).data;
}
async function setup() {
  const root = agentDir();
  let events!: EventBus, ctx!: ExtensionContext, ready = 0;
  const h = await host({ root, tools: ['agent_start', 'agent_list'], extend: pi => {
    events = pi.events;
    pi.events.on('subagents:ready', () => ready++);
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  return { ...h, root, get events() { return events; }, get ctx() { return ctx; }, manager: agentRuntime(), ready: () => ready,
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test('RPC binds after all factories, detaches/rebinds without duplicate replies and consumes completion before any parent wake', { timeout: 15000 }, async () => {
  const h = await setup();
  const lifecycle: string[] = [], usage: unknown[] = [];
  const unsub = ['created', 'started', 'completed'].map(kind => h.events.on(`subagents:${kind}`, raw => {
    lifecycle.push(kind);
    if (kind === 'completed') h.events.emit('subagents:rpc:consume', { requestId: 'sync-consume', agentId: (raw as { id: string }).id });
  }));
  unsub.push(h.events.on('subagents:usage', raw => usage.push(raw)));
  try {
    assert.equal(h.ready(), 1, 'a later factory subscribed before ready');
    assert.deepEqual(data(await request(h.events, 'ping')), { version: 2 });
    h.faux.setResponses([fauxAssistantMessage('result handled by another extension')]);
    const { id } = data(await request<{ id: string }>(h.events, 'spawn', { type: 'Explore', prompt: 'work', options: { isBackground: true, description: 'RPC task' } }));
    const record = await h.manager.get(id).run!.done.promise;
    await h.idle();
    assert.equal(record.result, 'result handled by another extension');
    assert.equal(record.description, 'RPC task');
    assert.deepEqual(lifecycle, ['created', 'started', 'completed']);
    assert.equal(usage.length, 1);
    assert.equal(h.manager.get(id).run!.consumed, true);
    assert.equal(h.faux.state.callCount, 1, 'synchronous consume schedules no parent request');
    assert.deepEqual(await request(h.events, 'consume', { agentId: id }), { success: true });
    assert.deepEqual(await request(h.events, 'stop', { agentId: id }), { success: false, error: 'Agent is not running' });
    assert.deepEqual(await request(h.events, 'steer', { agentId: id, message: 'late' }), { success: false, error: 'Agent is not running' });
    assert.equal(h.manager.runs.size, 1, 'RPC steer does not resume a settled child');
    await h.session.reload();
    assert.equal(h.ready(), 2);
    let replies = 0;
    const off = h.events.on('subagents:rpc:ping:reply:unique', () => replies++);
    await h.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    h.events.emit('subagents:rpc:ping', { requestId: 'unique' });
    await Promise.resolve(); off();
    assert.equal(replies, 1); assert.equal(h.ready(), 2);
    await h.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'reload' });
    let detached = 0;
    const noReply = h.events.on('subagents:rpc:ping:reply:detached', () => detached++);
    h.events.emit('subagents:rpc:ping', { requestId: 'detached' });
    await Promise.resolve(); noReply(); assert.equal(detached, 0);
  } finally { unsub.forEach(off => off()); await h.cleanup(); }
});

test('RPC startup errors are authoritative and explicit models/options never silently change execution', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    await h.session.modelRuntime.setRuntimeApiKey(h.ctx.model!.provider, 'offline-test');
    const call = (options: unknown) => request<{ id: string }>(h.events, 'spawn', { type: 'Explore', prompt: 'check', options });
    assert.equal((await call({ model: 'missing/offline' })).success, false);
    for (const key of ['parentAgentId', 'workflowId', 'resumeSessionFile', 'isolation', 'run_in_background', 'max_turns']) {
      const reply = await call({ [key]: 'forged' });
      assert.equal(reply.success, false); if (!reply.success) assert.match(reply.error, /Invalid spawn options/);
    }
    assert.equal(h.manager.runs.size, 0, 'invalid boundary data creates no run');
    mkdirSync(join(h.root, '.pi', 'agents'), { recursive: true });
    writeFileSync(join(h.root, '.pi', 'agents', 'broken.md'), '---\nname: broken\nextensions: [missing-extension]\n---\nwork');
    const failed = await request(h.events, 'spawn', { type: 'broken', prompt: 'start' });
    assert.equal(failed.success, false); if (!failed.success) assert.match(failed.error, /missing-extension/);
    h.faux.setResponses([fauxAssistantMessage('correct model')]);
    const { id } = data(await call({ model: h.ctx.model, isBackground: false }));
    const run = h.manager.get(id).run!;
    assert.equal(run.chargedPool, undefined, 'detached non-background runs occupy no foreground slot');
    const off = h.events.on('subagents:completed', raw => {
      h.events.emit('subagents:rpc:consume', { requestId: 'consume-model', agentId: (raw as { id: string }).id });
    });
    await run.done.promise; off(); await h.idle();
    assert.equal(run.record.model, `${h.ctx.model!.provider}/${h.ctx.model!.id}`);
  } finally { await h.cleanup(); }
});

test('queued RPC spawns return immediately, steer and abort share the manager, and ownership rejects nested/workflow/other sessions', { timeout: 15000 }, async () => {
  const h = await setup(), bus = createEventBus();
  const gates: PromiseWithResolvers<void>[] = [];
  const manager = new AgentManager(async run => {
    const gate = Promise.withResolvers<void>(); gates.push(gate);
    run.record.state = 'running'; manager.event('started', run);
    const abort = () => gate.resolve(); run.controller.signal.addEventListener('abort', abort);
    try { await gate.promise; } finally { run.controller.signal.removeEventListener('abort', abort); }
  }, async () => []);
  const config = loadConfig(h.root, h.root); config.agents.maxConcurrent = 1;
  const binding = new SessionBinding(); binding.bind(h.ctx);
  const pi = { events: bus, appendEntry() {}, sendMessage() {} } as unknown as ExtensionAPI;
  const notifications = new Notifications(pi, binding), release = notifications.hold();
  const agents = new AgentsModule(pi, binding, notifications, new StatusPublisher(new Dock()), undefined, undefined, manager);
  agents.bind();
  const rpc = new AgentRpc(pi, binding, agents, () => config); rpc.bind(); rpc.bind();
  try {
    const spawn = (options = {}) => request<{ id: string }>(bus, 'spawn', { type: 'Explore', prompt: 'work', options: { isBackground: true, ...options } });
    const first = data(await spawn()).id;
    let queued = 0;
    const controller = new AbortController();
    const second = data(await spawn({ signal: controller.signal, onQueued: (_id: string, ahead: number) => { queued++; assert.equal(ahead, 0); } })).id;
    assert.equal(queued, 1); assert.equal(manager.get(second).record.state, 'queued');
    assert.deepEqual(await request(bus, 'steer', { agentId: second, message: 'more facts' }), { success: true });
    assert.deepEqual(manager.get(second).run!.pendingMessages, ['more facts']);
    assert.deepEqual(await request(bus, 'consume', { agentId: second }), { success: false, error: 'Agent not found or still running' });
    controller.abort();
    await manager.get(second).run!.done.promise;
    assert.equal(manager.get(second).record.state, 'stopped');
    const bypass = data(await spawn({ bypassQueue: true })).id;
    assert.equal(manager.get(bypass).run!.chargedPool, 'background');
    const record = manager.get(first).record;
    for (const extra of [{ parentAgentId: first }, { workflowId: 'workflow-owned' }, { ownerSessionId: 'other-session' }]) {
      const id = `agent_${randomUUID()}`;
      manager.restore([{ ...record, ...extra, id, runId: `run_${randomUUID()}` }]);
      for (const method of ['stop', 'steer', 'consume']) {
        const reply = await request(bus, method, { agentId: id, message: 'redirect' });
        assert.equal(reply.success, false);
        if (!reply.success) assert.match(reply.error, /Agent not found|owned by another/);
      }
    }
    assert.deepEqual(await request(bus, 'stop', { agentId: first }), { success: true });
    assert.equal(manager.get(first).record.state, 'stopped');
    gates.forEach(gate => gate.resolve());
    await Promise.all([...manager.runs.values()].map(run => run.done.promise));
    const noticeId = `agent:${first}:${manager.get(first).record.runId}:result`;
    assert.equal(notifications.has(binding.current!.sessionId, noticeId), true);
    assert.deepEqual(await request(bus, 'consume', { agentId: first }), { success: true });
    assert.equal(notifications.has(binding.current!.sessionId, noticeId), false, 'late consumption cancels the pending shared notification');
  } finally { rpc.detach(); agents.detach(); release(); await manager.shutdown(); await h.cleanup(); }
});

test('RPC target cwd keeps parent resources/trust and the upstream structured tool retries once then returns validated JSON', { timeout: 15000 }, async () => {
  const h = await setup();
  const target = join(h.root, 'target'), marker = join(h.root, 'executed');
  try {
    mkdirSync(join(target, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(target, '.pi', 'extensions', 'untrusted.ts'), `import { writeFileSync } from 'node:fs'; export default function () { writeFileSync(${JSON.stringify(marker)}, 'bad'); }`);
    mkdirSync(join(h.root, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(h.root, '.pi', 'extensions', 'parent.ts'), `export default function (pi) { pi.on('session_start', (_event, ctx) => { if (ctx.cwd !== ${JSON.stringify(target)} || ctx.isProjectTrusted()) throw new Error('Wrong target cwd/trust'); }); }`);
    const schema = compileJsonSchema({ type: 'object', properties: { answer: { type: 'string', enum: ['validated'] } }, required: ['answer'], additionalProperties: false });
    assert.equal(schema.ok, true); if (!schema.ok) return;
    const off = h.events.on('subagents:completed', raw => h.events.emit('subagents:rpc:consume', { requestId: 'schema-consume', agentId: (raw as { id: string }).id }));
    h.faux.setResponses([fauxAssistantMessage('forgot to use the tool'), context => {
      const child = [...h.manager.runs.values()].find(run => run.options.structuredOutput);
      assert.ok(child?.session?.getActiveToolNames().includes('StructuredOutput'));
      assert.match(JSON.stringify(context.messages), /You did not call StructuredOutput/);
      return fauxAssistantMessage(fauxToolCall('StructuredOutput', { answer: 'wrong' }));
    }, context => {
      const rejected = context.messages.findLast(message => message.role === 'toolResult');
      assert.equal(rejected?.role === 'toolResult' && rejected.isError, true);
      assert.match(JSON.stringify(rejected), /validated/);
      return fauxAssistantMessage(fauxToolCall('StructuredOutput', { answer: 'validated' }));
    }, fauxAssistantMessage('prose discarded')]);
    const { id } = data(await request<{ id: string }>(h.events, 'spawn', { type: 'general-purpose', prompt: 'return JSON', options: { cwd: target, structuredOutput: schema.compiled } }));
    const record = await h.manager.get(id).run!.done.promise; off(); await h.idle();
    assert.equal(record.state, 'completed', record.error);
    assert.equal(record.cwd, target); assert.equal(record.structuredRetried, true);
    assert.equal(record.result, '{"answer":"validated"}');
    assert.equal(record.structuredJson, record.result); assert.equal(h.faux.state.callCount, 4);
    const listed = await h.session.getToolDefinition('agent_list')!.execute('cwd-list', { state: 'all' }, new AbortController().signal, undefined, h.ctx as never);
    assert.ok((listed.details as { agents: { id: string }[] }).agents.some(agent => agent.id === id), 'target-directory agents remain on their owner workspace list');
    assert.equal(existsSync(marker), false);
  } finally { await h.cleanup(); }
});
