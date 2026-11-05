import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AgentSessionRuntime, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall, type JsonObject, type TranscriptContext } from '@earendil-works/pi-ai';
import { visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { transcriptText, transcript } from '../../src/agents/records.ts';
import { workflowRuntime, WorkflowManager } from '../../src/agents/workflow/manager.ts';
import { workflowEntries, workflowEntryData, taskFromEntry } from '../../src/agents/workflow/entry.ts';
import { collapse, buildPhaseGroups } from '../../src/agents/workflow/progress/index.ts';
import { listSavedWorkflows, readSavedWorkflow, resolveWorkflowScript } from '../../src/agents/workflow/saved.ts';
import { WorkflowProgress } from '../../src/agents/workflow/ui/progress.ts';
import { showWorkflow } from '../../src/agents/workflow/ui/menu.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { Dock } from '../../src/ui/dock.ts';

const script = (body: string) => `export const meta = {name: 'Host workflow', description: '宿主验证', phases: [{title: 'Review'}]};\n${body}`;
function file(path: string, text: string) { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); }
async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (!await condition()) { if (Date.now() > deadline) throw new Error('Condition not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext, pi!: ExtensionAPI;
  const h = await host({root, persisted: true, tools: ['agent_workflow', 'agent_list', 'agent_send', 'job_list', 'wait'], extend: api => {
    pi = api; api.on('session_start', (_event, current) => { ctx = current; });
  }});
  return {...h, root, get ctx() { return ctx; }, get pi() { return pi; }, manager: workflowRuntime(), agents: agentRuntime(),
    async cleanup() { await h.dispose(); rmSync(root, {recursive: true, force: true}); }};
}
async function invoke(h: Awaited<ReturnType<typeof setup>>, name: string, args: JsonObject) {
  if (name === 'wait') args = {timeoutMs: 4000, ...args};
  return h.session.getToolDefinition(name)!.execute(`test:${name}`, args, new AbortController().signal, undefined, h.ctx as never);
}
async function launch(h: Awaited<ReturnType<typeof setup>>, args: JsonObject) {
  const result = await invoke(h, 'agent_workflow', args);
  const data = result.details as {id: string; scriptPath: string; resultPath: string};
  assert.match(data.id, /^wf_[a-f0-9]{12}$/); return h.manager.get(data.id);
}

test('real workflow tool is background, shares schema/gates/wait and restores child references without duplicate notices', {timeout: 15000}, async () => {
  const h = await setup();
  try {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    h.faux.setResponses([async () => { entered.resolve(); await release.promise; return fauxAssistantMessage(fauxToolCall('StructuredOutput', {answer: 'ok'})); },
      fauxAssistantMessage('structured done'), fauxAssistantMessage('plain done')]);
    const task = await launch(h, {script: script(`const first = await agent('JSON_STEP', {schema: {type: 'object', properties: {answer: {type: 'string'}}, required: ['answer']}, gate: 'test "$PWD" = "${h.root}"; if read input; then exit 1; fi'}); return [first, await agent('FAST_STEP', {gate: 'true', phase: 'Review'})];`)});
    assert.equal(task.status, 'running'); assert.ok(existsSync(task.scriptPath!));
    await entered.promise;
    const wait = invoke(h, 'wait', {ids: [task.id]}); release.resolve(); await wait;
    assert.equal(task.status, 'completed', task.error); assert.deepEqual(task.value, [{answer: 'ok'}, 'plain done']);
    assert.equal(readFileSync(task.resultPath, 'utf8'), JSON.stringify(task.value, null, 2));
    assert.equal(task.notified, true, 'wait consumes the workflow notification');
    assert.equal(((await invoke(h, 'agent_list', {state: 'all'})).details as {agents: unknown[]}).agents.length, 0);
    assert.equal(((await invoke(h, 'job_list', {state: 'all'})).details as {jobs: unknown[]}).jobs.length, 0);
    assert.equal(h.manager.jobManager().activeIds(h.ctx.sessionManager.getSessionId()).length, 0);
    const before = h.faux.state.callCount;
    const replay = await launch(h, {scriptPath: task.scriptPath!, resumeFromRunId: task.id});
    await invoke(h, 'wait', {ids: [replay.id]}); assert.equal(replay.replayedCount, 2); assert.equal(h.faux.state.callCount, before);
    const entries = workflowEntries(h.session.sessionManager.getBranch());
    const restoredAgents = new AgentManager(async () => {}, async () => []);
    const restored = new WorkflowManager(restoredAgents, () => h.manager.jobManager()); restored.restore(entries);
    assert.equal(restored.get(task.id).doneCount, 2); assert.equal(restored.get(task.id).notified, true);
    assert.equal(restored.get(task.id).children.length, 2);
    for (const child of restoredAgents.records()) {
      assert.ok(child.result); assert.match(transcriptText(transcript(child)), /JSON_STEP|FAST_STEP/);
    }
    assert.equal(h.session.sessionManager.getBranch().filter(e => e.type === 'custom_message' && JSON.stringify(e.content).includes('Workflow result')).length, 0);
  } finally { await h.cleanup(); }
});

test('workflow child resume preserves its original schema/model/type/tools and parent wait can answer its question', {timeout: 15000}, async () => {
  const h = await setup(), typePath = join(h.root, '.pi', 'agents', 'fixed.md');
  file(typePath, '---\nname: fixed\ntools: [read]\n---\nFIXED_CONTRACT');
  const off = h.agents.subscribeEvents((kind, run) => {
    if (kind === 'completed' && run.record.workflowId && run.record.prompt === 'FIRST') {
      file(typePath, '---\nname: fixed\ntools: [bash]\n---\nCHANGED_CONTRACT');
      file(join(h.root, 'pi-suite.json'), '{"agents":{"defaultModel":"missing/model"}}');
    }
  });
  try {
    const childResponses = [fauxAssistantMessage(fauxToolCall('StructuredOutput', {answer: 'first'})), fauxAssistantMessage('first done'),
      (context: TranscriptContext) => { assert.match(JSON.stringify(context.messages), /FIRST/); return fauxAssistantMessage(fauxToolCall('ask_user', {question: 'Continue?', allowFreeform: true})); },
      fauxAssistantMessage(fauxToolCall('StructuredOutput', {answer: 'continued'})), fauxAssistantMessage('continued done')];
    let childCall = 0, receivedQuestion = false, activeTools: string[] = [];
    h.faux.setResponses(Array(15).fill((context: TranscriptContext) => {
      if (JSON.stringify(context.messages).includes('WORKFLOW_PARENT')) {
        const waiting = [...h.agents.runs.values()].find(run => run.question);
        if (waiting) { receivedQuestion = true; activeTools = waiting.session!.getActiveToolNames().sort(); return fauxAssistantMessage(fauxToolCall('agent_send', {id: waiting.record.id, message: 'yes'})); }
        const task = [...h.manager.tasks.values()][0];
        return h.manager.settled(task.id) ? fauxAssistantMessage('parent received') : fauxAssistantMessage(fauxToolCall('wait', {ids: [task.id], timeoutMs: 4000}));
      }
      const response = childResponses[childCall++]; assert.ok(response);
      return typeof response === 'function' ? response(context) : response;
    }));
    const task = await launch(h, {script: script(`await agent('FIRST', {agentType: 'fixed', label: 'same', schema: {type: 'object', properties: {answer: {type: 'string'}}, required: ['answer']}}); return await agent('FOLLOW_UP', {resume: 'same'});`)});
    await h.session.prompt('WORKFLOW_PARENT: wait and answer child questions');
    assert.equal(receivedQuestion, true);
    const records = [...h.agents.runs.values()].filter(run => run.record.workflowId === task.id);
    assert.equal(records.length, 2); assert.equal(records[0].record.id, records[1].record.id);
    assert.equal(records[0].record.model, records[1].record.model); assert.strictEqual(records[0].type, records[1].type);
    assert.deepEqual(activeTools, ['StructuredOutput', 'ask_user', 'read']);
    assert.equal(task.status, 'completed', task.error); assert.deepEqual(task.value, {answer: 'continued'});
    assert.deepEqual(records[0].options.structuredOutput, records[1].options.structuredOutput);
  } finally { off(); await h.cleanup(); }
});

test('reload/new/resume preserve workflow and queued-agent owners; quit waits for real gates to stop', {timeout: 15000}, async () => {
  const root = agentDir(); file(join(root, 'pi-suite.json'), '{"agents":{"maxConcurrent":1}}');
  let current = await host({root, persisted: true, tools: ['agent_workflow']});
  const owner = current.session.sessionManager.getSessionId(), original = current.session.sessionFile!;
  const workflow = workflowRuntime(), agents = agentRuntime();
  const block = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  let ctx!: ExtensionContext;
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({root, tools: ['agent_workflow'], responses: [fauxAssistantMessage('parent received')],
      sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent,
      extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
    return {...current, diagnostics: []};
  });
  try {
    ctx = current.session.extensionRunner.createContext() as ExtensionContext;
    // Pi flushes the initial session tree after its first conversation message.
    // Persist the parent anchor before testing a switch away and back.
    current.faux.setResponses([fauxAssistantMessage('parent ready')]); await current.session.prompt('Prepare the owner session');
    current.faux.setResponses(Array(12).fill(async (context: {messages: unknown}) => {
      if (JSON.stringify(context.messages).includes('BLOCK_POOL')) { entered.resolve(); await block.promise; }
      return fauxAssistantMessage('received');
    }));
    const config = loadConfig(root);
    const blocking = await agents.start({prompt: 'BLOCK_POOL'}, {ctx}, config); await entered.promise;
    const queued = await agents.start({prompt: 'QUEUED'}, {ctx}, config); assert.equal(queued.record.state, 'queued');
    const task = await workflow.start({script: script(`await agent('before', {gate: 'sleep 0.4'}); return await agent('after');`)}, {ctx}, config);
    await until(() => collapse(task.workflowProgress).agents.some(row => row.gateJobId));
    await current.session.reload(); await runtime.newSession();
    block.resolve(); await workflow.finished(task.id); await queued.done.promise; await blocking.done.promise;
    assert.equal(task.status, 'completed', task.error); assert.equal(queued.record.state, 'completed', queued.record.error);
    for (const record of agents.records()) assert.equal(record.ownerSessionId, owner);
    assert.equal(current.session.sessionManager.getBranch().filter(e => e.type === 'custom_message' && JSON.stringify(e.content).includes(task.id)).length, 0);
    await runtime.switchSession(original); await until(() => task.notified); await current.idle();
    assert.strictEqual(workflowRuntime(), workflow); assert.equal(task.notified, true);
    const notices = () => current.session.sessionManager.getBranch().filter(e => e.type === 'custom_message' && JSON.stringify(e.content).includes(task.id));
    assert.equal(notices().length, 1); await current.session.reload(); assert.equal(notices().length, 1);
    current.faux.setResponses([fauxAssistantMessage('long gate')]);
    const stopped = await workflow.start({script: script(`return agent('gate', {gate: 'sleep 20'});`)}, {ctx}, loadConfig(root));
    await until(() => collapse(stopped.workflowProgress).agents.some(row => row.gateJobId));
    const jobId = collapse(stopped.workflowProgress).agents[0].gateJobId!;
    await runtime.dispose();
    assert.equal(stopped.status, 'killed', stopped.error); assert.equal(workflow.settled(stopped.id), true);
    assert.equal(workflow.jobManager().peek(jobId).cleanup.state, 'managed_scope_confirmed');
  } finally { block.resolve(); await runtime.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('saved workflow precedence/trust/packages, malformed journals and persistence errors stay explicit', {timeout: 15000}, async () => {
  const h = await setup();
  try {
    const pkg = join(h.root, 'package');
    file(join(pkg, 'package.json'), JSON.stringify({name: 'flows', pi: {extensions: [], subagents: {workflows: ['./flows']}}}));
    file(join(pkg, 'flows', 'pack.js'), script('return "package";'));
    file(join(h.root, 'settings.json'), JSON.stringify({packages: [pkg]}));
    file(join(h.root, 'workflows', 'same.js'), script('return "user";'));
    file(join(h.root, '.agents', 'workflows', 'same.js'), script('return "agents";'));
    file(join(h.root, '.pi', 'workflows', 'same.js'), script('return "pi";'));
    assert.match((readSavedWorkflow('same', h.root, {trusted: true}) as {script: string}).script, /return "pi"/);
    assert.match((readSavedWorkflow('same', h.root, {trusted: false}) as {script: string}).script, /return "user"/);
    assert.deepEqual(listSavedWorkflows(h.root, {trusted: true}), ['pack', 'same']);
    assert.deepEqual(listSavedWorkflows(h.root, {trusted: true, packageGate: false}), ['same']);
    assert.equal(resolveWorkflowScript({script: 'x', name: 'same'}, h.root, {trusted: true}).ok, false);
    file(join(h.root, '.pi', 'workflows', 'same.js'), 'return "plain JS";');
    assert.equal(readSavedWorkflow('same', h.root, {trusted: true}).ok, false, 'invalid high-priority resource cannot fall through');
    h.faux.setResponses([fauxAssistantMessage('journal answer')]);
    const prior = await launch(h, {script: script('return agent("journal");')}); await invoke(h, 'wait', {ids: [prior.id]});
    assert.equal(collapse(prior.workflowProgress).agents[0].state, 'done', JSON.stringify(prior.workflowProgress));
    const journal = readFileSync(prior.journalPath!, 'utf8'); file(prior.journalPath!, journal + '{"index":');
    const replay = await launch(h, {scriptPath: prior.scriptPath!, resumeFromRunId: prior.id}); await invoke(h, 'wait', {ids: [replay.id]});
    assert.match(replay.logs.join('\n'), /incomplete final append/); assert.equal(replay.replayedCount, 1);
    file(prior.journalPath!, 'bad\n' + journal);
    await assert.rejects(launch(h, {scriptPath: prior.scriptPath!, resumeFromRunId: prior.id}), /journal/i);
    const configure = async (value: object) => {
      file(join(h.root, 'pi-suite.json'), JSON.stringify(value));
      await h.session.extensionRunner.emit({type: 'session_start', reason: 'reload'});
    };
    h.pi.setActiveTools(['agent_workflow', 'wait']);
    await configure({agents: {workflows: false}}); assert.deepEqual(h.pi.getActiveTools(), ['wait']);
    file(join(h.root, '.pi', 'agents', 'visible-special.md'), '---\nname: visible-special\ndescription: VISIBLE_DESCRIPTION\n---\nRead');
    await configure({agents: {workflows: true}});
    assert.deepEqual(h.pi.getActiveTools(), ['wait', 'agent_workflow']);
    assert.match(h.session.agent.state.tools.find(tool => tool.name === 'agent_workflow')!.description, /VISIBLE_DESCRIPTION/);
    h.pi.setActiveTools(['wait']);
    await configure({agents: {workflows: false}}); await configure({agents: {workflows: true}});
    assert.deepEqual(h.pi.getActiveTools(), ['wait'], 'the controller restores only its own withdrawal');
    h.pi.setActiveTools(['wait', 'agent_workflow']);
    const directory = join(h.root, 'pi-suite', 'agents', 'workflows', h.ctx.sessionManager.getSessionId());
    rmSync(directory, {recursive: true}); file(directory, 'not a directory');
    await assert.rejects(launch(h, {script: script('return 1;')}), /ENOTDIR|EEXIST/);
  } finally { await h.cleanup(); }
});

test('native workflow UI wraps phones, keeps exact phases and retains reader/search through pause controls', {timeout: 15000}, async () => {
  const h = await setup();
  try {
    h.faux.setResponses([fauxAssistantMessage('child')]);
    const task = await launch(h, {script: script('return agent("ui");')}); await invoke(h, 'wait', {ids: [task.id]});
    task.workflowProgress.push({type: 'workflow_phase', index: 0, title: 'Review extra'},
      {type: 'workflow_agent', index: 1, label: '长名称'.repeat(35), state: 'done', phaseIndex: 0},
      {type: 'workflow_log', message: 'literal ```log```'}); task.progressVersion++;
    task.logs.push('literal ```log```');
    assert.deepEqual(buildPhaseGroups(task.workflowProgress, task.meta?.phases).map(group => group.title), ['Review', 'Agents', 'Review extra']);
    const view = new WorkflowProgress(task);
    for (const width of [40, 60, 120]) for (const line of view.render(width)) assert.ok(visibleWidth(line) <= width);
    assert.match(view.render(40).join('\n'), /literal ```log```/);
    const restored = taskFromEntry(workflowEntryData(task)); assert.equal(restored.doneCount, 2);
    let frames = 0, reader: unknown;
    task.status = 'running'; task.control = {pause() {}, resume() {}, isPaused: () => task.status === 'paused', skip: () => false, retry: () => false};
    const context = {...h.ctx, ui: {...h.ctx.ui, custom: async (factory: Function) => new Promise<void>(resolve => {
      const frame = factory(terminal(), h.ctx.ui.theme, {}, resolve);
      frame.render(40); frames++;
      if (frames === 1) {
        reader = frame.reader; frame.reader.scroll(3); frame.reader.query = 'literal';
        frame.handleInput('\x1b[D'); frame.handleInput('\x1b[D'); frame.handleInput('\r');
      } else { assert.strictEqual(frame.reader, reader); assert.equal(frame.reader.query, 'literal'); frame.handleInput('\x1b'); }
    })}} as unknown as ExtensionContext;
    await showWorkflow(context, {workflows: {manager: h.manager} as never, agents: {} as never, dock: new Dock(), config: () => loadConfig(h.root)}, task);
    assert.equal(frames, 2); assert.equal(task.status, 'paused');
    task.status = 'completed'; task.control = undefined;
  } finally { await h.cleanup(); }
});
