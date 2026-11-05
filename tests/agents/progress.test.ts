import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir, testShell } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import type { AgentManager } from '../../src/agents/manager.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { ToolError } from '../../src/runtime/errors.ts';
import { JobsModule } from '../../src/jobs/index.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { LIST_LIMITS } from '../../src/runtime/tools.ts';

async function setup(config: object = {}) {
  const root = agentDir(); writeFileSync(join(root, 'pi-suite.json'), JSON.stringify(config));
  const metered = fauxProvider({ provider: 'suite-progress', models: [{ id: 'probe' }], tokensPerSecond: 10000, tokenSize: { min: 200, max: 200 } });
  let ctx!: ExtensionContext;
  const h = await host({ root, tools: ['agent_list', 'agent_read'], extend: pi => {
    pi.registerProvider({ ...metered.provider, auth: { apiKey: { name: 'Offline auth', resolve: async () => ({ auth: {} }) } } });
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  await h.session.modelRuntime.refresh({ allowNetwork: false });
  return { ...h, root, ctx, metered, manager: agentRuntime(), config: loadConfig(root, root),
    invoke: (name: string, params: object) => h.session.getToolDefinition(name)!.execute('progress', params, new AbortController().signal, undefined, ctx as never),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
function file(path: string, body: string) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); }
function userText(context: TranscriptContext): string {
  const content = context.messages.findLast(message => message.role === 'user')?.content;
  return typeof content === 'string' ? content : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
}
function toolResult(context: TranscriptContext) {
  const lastUser = context.messages.findLastIndex(message => message.role === 'user');
  return context.messages.slice(lastUser + 1).findLast(message => message.role === 'toolResult');
}
const output = (value: { content: { type: string; text?: string }[] }) => value.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
function until(manager: AgentManager, condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Condition not reached')); }, 5000);
    const off = manager.subscribe(() => { if (condition()) { clearTimeout(timer); off(); resolve(); } });
  });
}

test('SDK model content exposes bounded parallel activity, queued state, live usage and streaming progress', { timeout: 15000 }, async () => {
  const h = await setup({ agents: { maxConcurrentForeground: 1 } }), key = `progress:${h.root}`;
  const state = { entered: { alpha: Promise.withResolvers<void>(), beta: Promise.withResolvers<void>() },
    release: { alpha: Promise.withResolvers<void>(), beta: Promise.withResolvers<void>() } };
  (globalThis as unknown as Record<string, unknown>)[key] = state;
  file(join(h.root, 'extensions', 'probe.ts'), `export default pi => pi.registerTool({name:'progress_probe',label:'Probe',description:'Wait for the selected barrier',executionMode:'parallel',
    parameters:{type:'object',properties:{label:{type:'string'},payload:{type:'string'}},required:['label','payload']},
    async execute(_id,args,_signal,update) { const state=globalThis[${JSON.stringify(key)}]; state.entered[args.label].resolve();
      update({content:[{type:'text',text:'LIVE_'+args.label}],details:{}}); await state.release[args.label].promise;
      return {content:[{type:'text',text:'DONE_'+args.label}],details:{}}; }});`);
  file(join(h.root, 'agents', 'probe.md'), '---\nname: probe\nmodel: suite-progress/probe\ntools: progress_probe\nextensions: true\nskills: false\n---\nProbe.');
  const long = 'ARGUMENT_HEAD_' + 'x'.repeat(1200) + '_ARGUMENT_TAIL';
  h.metered.setResponses([fauxAssistantMessage([fauxToolCall('progress_probe', { label: 'alpha', payload: long }),
    fauxToolCall('progress_probe', { label: 'beta', payload: 'SECOND_PARAMETER' })]), fauxAssistantMessage('STREAM_VISIBLE '.repeat(80)), fauxAssistantMessage('queued finished')]);
  let observed: string | undefined, target = '';
  const respond: FauxResponseFactory = context => {
    const result = toolResult(context);
    if (!result) return fauxAssistantMessage(fauxToolCall('agent_list', { id: target }));
    observed = output(result); return fauxAssistantMessage('progress inspected');
  };
  h.faux.setResponses(Array(10).fill(respond));
  const query = async (id: string, inspect: (value: string) => void) => {
    target = id; observed = undefined; await h.session.prompt('QUERY_PROGRESS');
    assert.ok(observed, 'agent_list content must reach the model'); inspect(observed);
  };
  try {
    const run = await h.manager.start({ type: 'probe', prompt: 'parallel probe', background: false }, { ctx: h.ctx }, h.config);
    await Promise.all([state.entered.alpha.promise, state.entered.beta.promise]);
    const queued = await h.manager.start({ type: 'probe', prompt: 'queued probe', background: false }, { ctx: h.ctx }, h.config);
    await query(queued.record.id, value => { assert.match(value, /state: queued/); assert.match(value, /turns: 0 · toolUses: 0 · elapsedMs: 0/); });
    await query(run.record.id, value => {
      assert.match(value, /state: running/); assert.match(value, /alpha/); assert.match(value, /SECOND_PARAMETER/);
      assert.match(value, /ARGUMENT_HEAD/); assert.doesNotMatch(value, /ARGUMENT_TAIL/);
      assert.match(value, /toolUses: 2/); assert.match(value, /lastUpdateAt:/); assert.match(value, /usage:.*total \d+.*cost \$/);
    });
    assert.ok(run.record.usage!.tokens.total > 0);
    state.release.alpha.resolve(); await until(h.manager, () => !run.record.activity?.includes('alpha'));
    await query(run.record.id, value => { assert.match(value, /SECOND_PARAMETER/); assert.doesNotMatch(value, /activity:.*alpha/); });
    const streamed = Promise.withResolvers<void>();
    const off = run.session!.subscribe(event => { if (event.type === 'message_update' && JSON.stringify(event.message).includes('STREAM_VISIBLE')) streamed.resolve(); });
    state.release.beta.resolve(); await streamed.promise;
    const reading = await h.invoke('agent_read', { id: run.record.id, stream: 'transcript' });
    assert.match(output(reading), /STREAM_VISIBLE/);
    await query(run.record.id, value => { assert.match(value, /activity: Generating response/); assert.match(value, /turns: 2 · toolUses: 2/); });
    off(); assert.equal((await run.done.promise).state, 'completed'); assert.equal((await queued.done.promise).state, 'completed');
  } finally { state.release.alpha.resolve(); state.release.beta.resolve(); delete (globalThis as unknown as Record<string, unknown>)[key]; await h.cleanup(); }
});

test('agent progress uses all execution roots for active descendant jobs and bounds recent run text without losing query failures', { timeout: 15000 }, async () => {
  const h = await setup({ jobs: { launchPolicy: [{ command: 'echo CHILD_JOB; read line', decision: 'allow' }, { command: 'echo NESTED_JOB; read line', decision: 'allow' }] } });
  file(join(h.root, 'agents', 'delegator.md'), '---\nname: delegator\nallowed_subagents: all\nextensions: false\nskills: false\n---\nDelegate.');
  mkdirSync(join(h.root, 'target'));
  let observed: string | undefined, target = '';
  h.faux.setResponses(Array(70).fill((context => {
    const prompt = userText(context), result = toolResult(context);
    if (prompt === 'JOB_PARENT') return !result ? fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo CHILD_JOB; read line', cwd: 'target', name: 'owned-one' })) : fauxAssistantMessage('first finished');
    if (prompt === 'JOB_PARENT_SECOND') return !result ? fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'JOB_NESTED', background: false })) : fauxAssistantMessage('second finished');
    if (prompt === 'JOB_NESTED') return !result ? fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo NESTED_JOB; read line', name: 'owned-descendant' })) : fauxAssistantMessage('nested finished');
    if (prompt.startsWith('QUIET_')) return fauxAssistantMessage('quiet finished');
    if (!result) return fauxAssistantMessage(fauxToolCall('agent_list', { id: target }));
    observed = output(result); return fauxAssistantMessage('jobs inspected');
  }) satisfies FauxResponseFactory));
  const original = JobsModule.prototype.createdBy;
  try {
    const first = await h.manager.start({ type: 'delegator', prompt: 'JOB_PARENT', background: false }, { ctx: h.ctx }, h.config); await first.done.promise;
    await (await h.manager.send(first.record.id, 'JOB_PARENT_SECOND', { ctx: h.ctx }, h.config)).run.done.promise;
    for (let i = 2; i <= LIST_LIMITS.defaultLimit; i++) await (await h.manager.send(first.record.id, `QUIET_${i}`, { ctx: h.ctx }, h.config)).run.done.promise;
    const runtime = acquireRuntime(h.root); if (runtime.mode !== 'active') throw new Error('jobs unavailable');
    const jobs = runtime.manager, roots = h.manager.records().filter(record => record.id === first.record.id).map(record => record.runId);
    const owned = jobs.createdBy(roots); assert.equal(owned.length, 2);
    const request = { cwd: h.root, ownerSessionId: 'foreign-owner', anchorEntryId: 'other-branch', closeInput: true,
      creator: { agentId: first.record.id, runId: first.record.runId, ancestors: [] } };
    const finished = await jobs.start({ ...request, command: 'echo FINISHED_JOB', name: 'finished-owned' }, testShell()); await jobs.wait(finished.id);
    const cleanup = await jobs.start({ ...request, command: 'echo CLEANUP_JOB', name: 'cleanup-owned' }, testShell()); await jobs.wait(cleanup.id);
    const unrelated = await jobs.start({ ...request, command: 'read line', closeInput: false,
      creator: { agentId: 'agent_00000000', runId: 'run_00000000', ancestors: [] } }, testShell());
    target = first.record.id;
    await h.session.prompt('QUERY_JOBS');
    assert.ok(observed, 'agent_list content must reach the model');
    {
      const value = observed;
      assert.match(value, /jobs: 2 active/); for (const job of owned) { assert.ok(value.includes(job.id)); assert.match(value, new RegExp(`${job.id} running · cleanup`)); }
      assert.ok(!value.includes(finished.id)); assert.ok(!value.includes(cleanup.id)); assert.ok(!value.includes(unrelated.id));
      const recent = value.split('\n').find(line => line.startsWith('runs:'))!;
      assert.match(recent, /runs: 20\/21 · 1 more via workspace history/); assert.ok(!recent.includes(first.record.runId));
      assert.doesNotMatch(value, /echo CHILD_JOB|echo NESTED_JOB/);
    }
    const details = (await h.invoke('agent_list', { id: target })).details as { jobs: { id: string; cleanup: string }[]; runs: unknown[] };
    assert.equal(details.runs.length, 21); assert.deepEqual(new Set(details.jobs.map(job => job.id)), new Set(owned.map(job => job.id)));
    // A control bridge may report process exit before cleanup completes. Keep that job active.
    JobsModule.prototype.createdBy = function (runIds) { return original.call(this, runIds).map(job => job.id === cleanup.id ? { ...job, cleanup: { ...job.cleanup, state: 'pending' as const } } : job); };
    const pending = await h.invoke('agent_list', { id: target });
    assert.match(output(pending), new RegExp(`${cleanup.id} completed · cleanup pending`));
    JobsModule.prototype.createdBy = () => { throw new ToolError('RUNTIME_UNAVAILABLE', 'Legacy owner cannot query creation scope'); };
    const unavailable = await h.invoke('agent_list', { id: target });
    assert.match(output(unavailable), /state: completed/); assert.match(output(unavailable), /jobs unavailable:.*Legacy owner/);
    assert.match((unavailable.details as { jobsUnavailable: string }).jobsUnavailable, /Legacy owner/);
    JobsModule.prototype.createdBy = () => { throw new Error('Unexpected ownership query failure'); };
    await assert.rejects(h.invoke('agent_list', { id: target }), /Unexpected ownership query failure/);
  } finally { JobsModule.prototype.createdBy = original; await h.cleanup(); }
});

test('model progress includes parent waiting and failed notification exposes actual SDK usage and error while reading cancels another result', { timeout: 15000 }, async () => {
  const h = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  file(join(h.root, 'input.txt'), 'a successful tool before provider failure');
  let observed = false, failedId = '', cancelledRunId = '';
  h.faux.setResponses(Array(30).fill((async context => {
    const prompt = userText(context), result = toolResult(context);
    if (prompt.includes('HOLD_PARENT')) { entered.resolve(); await release.promise; return fauxAssistantMessage('parent finished'); }
    if (prompt === 'ASK_PARENT') return !result ? fauxAssistantMessage(fauxToolCall('ask_user', { question: 'Which action?', allowFreeform: true, timeoutMs: 0 })) : fauxAssistantMessage('answered');
    if (prompt === 'FAIL_AFTER_TOOL') return !result ? fauxAssistantMessage(fauxToolCall('read', { path: 'input.txt' }))
      : fauxAssistantMessage('partial answer', { stopReason: 'error', errorMessage: 'PROVIDER_REFUSED' });
    if (prompt === 'READ_CANCEL') return fauxAssistantMessage('read this result');
    const text = JSON.stringify(context.messages);
    assert.ok(text.includes(failedId)); assert.match(text, /error: PROVIDER_REFUSED/); assert.match(text, /usage:.*total \d+.*cost \$/);
    assert.ok(!text.includes(cancelledRunId)); observed = true; return fauxAssistantMessage('failure understood');
  }) satisfies FauxResponseFactory));
  const parent = h.session.prompt('HOLD_PARENT'); await entered.promise;
  try {
    const asking = await h.manager.start({ prompt: 'ASK_PARENT', background: false }, { ctx: h.ctx }, h.config);
    await until(h.manager, () => Boolean(asking.question));
    assert.match(output(await h.invoke('agent_list', { id: asking.record.id })), /state: waiting · waitingFor: parent/);
    await h.manager.send(asking.record.id, 'continue', { ctx: h.ctx }, h.config); await asking.done.promise;
    const failed = await h.manager.start({ prompt: 'FAIL_AFTER_TOOL' }, { ctx: h.ctx }, h.config);
    const finished = await failed.done.promise; failedId = failed.record.runId;
    assert.equal(finished.state, 'failed'); assert.ok(finished.usage!.tokens.total > 0);
    const cancelled = await h.manager.start({ prompt: 'READ_CANCEL' }, { ctx: h.ctx }, h.config); await cancelled.done.promise; cancelledRunId = cancelled.record.runId;
    await h.invoke('agent_read', { id: cancelled.record.id });
    release.resolve(); await parent; await h.idle(); assert.equal(observed, true);
    const notices = h.session.sessionManager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification');
    assert.equal(notices.length, 1); assert.ok(JSON.stringify(notices).includes(failed.record.runId)); assert.ok(!JSON.stringify(notices).includes(cancelled.record.runId));
    const callCount = h.faux.state.callCount;
    h.manager.changed(); await h.idle(); assert.equal(h.faux.state.callCount, callCount);
  } finally { release.resolve(); await parent; await h.cleanup(); }
});
