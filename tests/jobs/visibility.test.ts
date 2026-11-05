import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, type FauxResponseFactory, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir, settled, testShell } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { JobsModule } from '../../src/jobs/index.ts';
import { acquireRuntime, PROTOCOL_VERSION } from '../../src/jobs/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import type { JobSummary } from '../../src/jobs/types.ts';

function promptOf(context: TranscriptContext): string {
  const content = context.messages.findLast(message => message.role === 'user')?.content;
  return typeof content === 'string' ? content : content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
}
const output = (value: {content: {type: string; text?: string}[]}) => value.content.filter(part => part.type === 'text').map(part => part.text).join('\n');

test('SDK session list and activity share branch and creator scope across working directories without taking child notifications', { timeout: 15000 }, async () => {
  const root = agentDir(), target = join(root, 'target'); mkdirSync(target); mkdirSync(join(root, 'agents'));
  writeFileSync(join(root, 'agents', 'delegator.md'), '---\nname: delegator\nallowed_subagents: all\nextensions: false\nskills: false\n---\nDelegate.');
  const suiteConfig = {jobs: {launchPolicy: ['HIDDEN', 'VISIBLE_FIRST', 'NESTED']
    .map(prompt => ({command: `echo ${prompt}_JOB; read line`, decision: 'allow'}))}};
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify(suiteConfig));
  let ctx!: ExtensionContext;
  const h = await host({root, tools: ['job_list', 'job_read', 'job_write'], extend: pi => {
    pi.on('session_start', (_event, context) => { ctx = context; });
  }});
  const agents = agentRuntime(), config = loadConfig(root, root), runtime = acquireRuntime(root);
  assert.equal(runtime.mode, 'active'); if (runtime.mode !== 'active') throw new Error('jobs unavailable');
  const jobs = runtime.manager;
  h.faux.setResponses(Array(40).fill((context => {
    const prompt = promptOf(context), lastUser = context.messages.findLastIndex(message => message.role === 'user');
    const result = context.messages.slice(lastUser + 1).findLast(message => message.role === 'toolResult');
    if (prompt === 'VISIBLE_SECOND') return result ? fauxAssistantMessage('second finished')
      : fauxAssistantMessage(fauxToolCall('agent_start', {prompt: 'NESTED', background: false}));
    if (['HIDDEN', 'VISIBLE_FIRST', 'NESTED'].includes(prompt)) return result ? fauxAssistantMessage('child finished')
      : fauxAssistantMessage(fauxToolCall('job_start', {command: `echo ${prompt}_JOB; read line`, cwd: target}));
    return fauxAssistantMessage('notice received');
  }) satisfies FauxResponseFactory));
  const invoke = (name: string, params: object) => h.session.getToolDefinition(name)!.execute('visibility', params, new AbortController().signal, undefined, ctx as never);
  const list = async (params: object = {}) => (await invoke('job_list', params)).details as {jobs: JobSummary[]; nextCursor?: string};
  const ids = (rows: JobSummary[]) => rows.map(job => job.id).sort();
  const registration = (globalThis as unknown as Record<symbol, {protocolVersion: number; control: import('../../src/jobs/control.ts').ControlBridge}>)[Symbol.for('pi-suite.jobs.runtime')];
  const bridge = registration.control;
  try {
    h.session.sessionManager.appendCustomEntry('visibility', {branch: 'base'}); const base = h.session.sessionManager.getLeafId()!;
    h.session.sessionManager.appendCustomEntry('visibility', {branch: 'hidden'});
    const hidden = await agents.start({type: 'delegator', prompt: 'HIDDEN', background: false}, {ctx}, config); await hidden.done.promise;
    await jobs.start({...JobsModule.owner(ctx), cwd: target, command: 'read hidden'}, testShell());
    h.session.sessionManager.branch(base); h.session.sessionManager.appendCustomEntry('visibility', {branch: 'current'});
    const first = await agents.start({type: 'delegator', prompt: 'VISIBLE_FIRST', background: false}, {ctx}, config); await first.done.promise;
    const second = (await agents.send(first.record.id, 'VISIBLE_SECOND', {ctx}, config)).run; await second.done.promise;
    agents.sweep(Date.now() + 10 * 60_000 + 1);
    const roots = [first.record.runId, second.record.runId], childJobs = jobs.createdBy(roots);
    assert.equal(childJobs.length, 2); assert.ok(childJobs.every(job => job.cwd === target && job.ownerSessionId !== ctx.sessionManager.getSessionId()));
    const request = {...JobsModule.owner(ctx), cwd: target, command: 'read visible'};
    const direct = await jobs.start(request, testShell());
    const duplicate = await jobs.start({...request, creator: {agentId: first.record.id, runId: first.record.runId, ancestors: []}}, testShell());
    await jobs.start({...request, ownerSessionId: 'foreign-session'}, testShell());
    await jobs.start({...request, creator: {workflowId: 'wf_gate', runId: 'run_gate', ancestors: roots}}, testShell());
    const finished = await jobs.start({...request, ownerSessionId: 'foreign-session', command: 'echo SETTLED_JOB', closeInput: true,
      creator: {agentId: 'agent_descendant', runId: 'run_descendant', ancestors: roots}}, testShell()); await jobs.wait(finished.id);
    const active = [...childJobs, direct, duplicate];
    assert.deepEqual(ids((await list()).jobs), ids(active)); assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 4');
    assert.deepEqual(ids((await list({state: 'all'})).jobs), ids([...active, finished]));
    const firstPage = await list({limit: 2}), secondPage = await list({limit: 2, cursor: firstPage.nextCursor});
    assert.ok(firstPage.nextCursor); assert.deepEqual(ids([...firstPage.jobs, ...secondPage.jobs]), ids(active));
    const workspace = (await list({scope: 'workspace', state: 'all'})).jobs;
    assert.deepEqual(workspace, [], 'target jobs do not broaden the explicit root workspace view');

    // A storage await may overlap completion; the merged owner view must be read afterwards.
    const originalList = jobs.list.bind(jobs);
    jobs.list = async workspace => { await jobs.stop(duplicate.id); return originalList(workspace); };
    try { assert.deepEqual(ids((await list()).jobs), ids([...childJobs, direct])); } finally { jobs.list = originalList; }
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 3');
    assert.match(output(await invoke('job_read', {id: childJobs[0].id})), /VISIBLE_FIRST_JOB/);
    await invoke('job_write', {id: childJobs[0].id, input: 'finish', submit: true}); await settled(jobs, childJobs[0].id); await h.idle();
    assert.notEqual(jobs.peek(childJobs[0].id).notified, true, 'a host-visible child result still belongs to its child session');
    assert.ok(!h.session.sessionManager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification'
      && JSON.stringify(entry.content).includes(childJobs[0].id)));
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 2');

    writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({...suiteConfig, modules: {agents: false}}));
    await h.session.reload();
    assert.deepEqual(ids((await list()).jobs), ids([childJobs[1], direct]));
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 2', 'saved visible child runs preserve leftover jobs when agents are disabled');

    assert.ok(bridge.version === 3);
    const {sessionJobs: _sessionJobs, ...v2Jobs} = bridge.jobs;
    registration.protocolVersion = PROTOCOL_VERSION - 1; registration.control = {version: 2, jobs: v2Jobs, quit: () => bridge.quit()};
    await h.session.reload();
    assert.match(h.notices.at(-1)!.text, /Status shows direct jobs on this branch only/);
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 1');
    await assert.rejects(invoke('job_list', {}), /RUNTIME_UNAVAILABLE.*complete session queries require v3/);
    assert.deepEqual((await list({scope: 'workspace'})).jobs, []);
    assert.match(output(await invoke('job_read', {id: childJobs[1].id})), /NESTED_JOB/);
  } finally {
    registration.control = bridge; await h.dispose(); rmSync(root, {recursive: true, force: true});
  }
});
