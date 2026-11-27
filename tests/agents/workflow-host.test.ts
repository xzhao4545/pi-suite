import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { dirname, join } from 'node:path';
import { AgentSessionRuntime, SessionManager, ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall, type JsonObject, type TranscriptContext } from '@earendil-works/pi-ai';
import { getKeybindings, visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { AGENT_OWNER, WORKFLOW_OWNER } from '../../src/agents/registry.ts';
import { transcriptText, transcript } from '../../src/agents/records.ts';
import { workflowRuntime, WorkflowManager } from '../../src/agents/workflow/manager.ts';
import { workflowEntries, workflowEntryData, taskFromEntry } from '../../src/agents/workflow/entry.ts';
import { collapse, buildPhaseGroups } from '../../src/agents/workflow/progress/index.ts';
import { listSavedWorkflows, readSavedWorkflow, resolveWorkflowScript } from '../../src/agents/workflow/saved.ts';
import { WorkflowProgress } from '../../src/agents/workflow/ui/progress.ts';
import { showWorkflow } from '../../src/agents/workflow/ui/menu.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { Dock } from '../../src/ui/dock.ts';
import { BrowserView } from '../../src/ui/browser.ts';
import { DetailsView } from '../../src/ui/details.ts';
import { focusBrowser } from '../support/browser.ts';

const script = (body: string) => `export const meta = {name: 'Host workflow', description: '宿主验证', phases: [{title: 'Review'}]};\n${body}`;
function file(path: string, text: string) { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); }
async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (!await condition()) { if (Date.now() > deadline) throw new Error('Condition not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext, pi!: ExtensionAPI;
  const h = await host({root, persisted: true, tools: ['agent_workflow', 'agent_start', 'agent_list', 'agent_send', 'job_list', 'wait'], extend: api => {
    pi = api; api.on('session_start', (_event, current) => { ctx = current; });
  }});
  return {...h, root, get ctx() { return ctx; }, get pi() { return pi; }, manager: workflowRuntime().owner, agents: agentRuntime().owner,
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
    // Replay through an occupied real host: an idle direct launch may legitimately
    // deliver its result before the caller has entered wait. That is not a replayed child.
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('agent_workflow', {scriptPath: task.scriptPath!, resumeFromRunId: task.id})),
      () => fauxAssistantMessage(fauxToolCall('wait', {ids: [[...h.manager.tasks.keys()].at(-1)!]})),
      fauxAssistantMessage('Replay inspected'),
    ]);
    await h.session.prompt('Replay the workflow and inspect its result'); await h.idle();
    const replay = [...h.manager.tasks.values()].at(-1)!;
    assert.equal(replay.replayedCount, 2); assert.equal(h.faux.state.callCount, before + 3);
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

test('agent_workflow replays persisted result details without the workflow cache', {timeout: 15000}, async () => {
  const h = await setup();
  try {
    const args = {script: script('return 1;')};
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('agent_workflow', args)),
      () => fauxAssistantMessage(fauxToolCall('wait', {ids: [[...h.manager.tasks.keys()].at(-1)!]})),
      fauxAssistantMessage('Workflow inspected'),
    ]);
    await h.session.prompt('Run the workflow');
    const result = SessionManager.open(h.session.sessionFile!).getBranch()
      .flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'agent_workflow'
        ? [entry.message] : [])[0];
    assert.ok(result && !result.isError);
    // Resolve only the load-time renderer, as when agents are disabled. It has no task lookup.
    const renderer = h.session.extensionRunner.resolveToolRenderers('agent_workflow', () => undefined);
    const tool = new ToolExecutionComponent('agent_workflow', result.toolCallId, args, {outputPad: 2}, renderer, terminal(30, 120), h.root);
    tool.updateResult(result);
    const shown = () => tool.render(120).map(stripVTControlCharacters).filter(line => line.trim()).join('\n');
    assert.match(shown(), /^[^\n]*Workflow.*0\/0 agents[^\n]*$/);
    tool.setExpanded(true);
    assert.match(shown(), /usage: 0 tokens · 0 tools/);
    assert.match(shown(), /resultPath:/);
    assert.doesNotMatch(shown(), /wf_[a-f0-9]{12} running ·/);
  } finally { await h.cleanup(); }
});

test('workflow child resume preserves its original schema/model/type/tools and parent wait can answer its question', {timeout: 15000}, async () => {
  const h = await setup(), typePath = join(h.root, '.pi', 'agents', 'fixed.md');
  file(typePath, '---\nname: fixed\ntools: [read]\npersist_session: false\n---\nFIXED_CONTRACT');
  const off = h.agents.subscribeEvents((kind, run) => {
    if (kind === 'completed' && run.record.workflowId && run.record.prompt === 'FIRST') {
      h.agents.sweep(Date.now() + 10 * 60_000 + 1);
      assert.strictEqual(h.agents.get(run.record.id).run, run, 'active workflow retains its memory-only continuation');
      file(typePath, '---\nname: fixed\ntools: [bash]\n---\nCHANGED_CONTRACT');
      file(join(h.root, 'pi-suite.json'), '{"agents":{"defaultModel":"missing/model"}}');
    }
  });
  try {
    const childResponses = [fauxAssistantMessage(fauxToolCall('StructuredOutput', {answer: 'first'})), fauxAssistantMessage('first done'),
      (context: TranscriptContext) => { assert.match(JSON.stringify(context.messages), /FIRST/); return fauxAssistantMessage(fauxToolCall('ask_user', {question: 'Continue?'})); },
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
    h.agents.sweep(Date.now() + 10 * 60_000 + 1);
    for (const run of records) {
      assert.equal(h.agents.get(run.record.id, run.record.runId).run, undefined, 'workflow close releases its child executions');
      assert.ok(h.agents.get(run.record.id, run.record.runId).record.result);
    }
  } finally { off(); await h.cleanup(); }
});

test('reload/new/resume preserve workflow and queued-agent owners; quit waits for real gates to stop', {timeout: 15000}, async () => {
  const root = agentDir(); file(join(root, 'pi-suite.json'), '{"agents":{"maxConcurrent":1}}');
  let current = await host({root, persisted: true, tools: ['agent_workflow']});
  const owner = current.session.sessionManager.getSessionId(), original = current.session.sessionFile!;
  const workflow = workflowRuntime().owner, agents = agentRuntime().owner;
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
    assert.strictEqual(workflowRuntime().owner, workflow); assert.equal(task.notified, true);
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

test('cross-load owners preserve active controls, then replace both runtimes when idle', {timeout: 15000}, async () => {
  const h = await setup();
  try {
    h.faux.setResponses([fauxAssistantMessage('finished')]);
    const finished = await h.agents.start({prompt: 'completed run', background: false}, {ctx: h.ctx}, loadConfig(h.root));
    await finished.done.promise;
    const workflow = await launch(h, {script: script('while (true) {}')});
    assert.equal(h.agents.busy(), false);
    // The SDK reloads extension factories but leaves their ESM modules cached. Mark the
    // registered owners with a different identity to exercise production admission.
    const globals = globalThis as unknown as Record<symbol, Map<string, {implementation: symbol}>>;
    const previous = Symbol('previous load');
    for (const key of [AGENT_OWNER, WORKFLOW_OWNER]) globals[Symbol.for(key)].get(h.root)!.implementation = previous;
    assert.equal(agentRuntime().owner, h.agents, 'the workflow still depends on the idle agents owner');
    assert.ok(agentRuntime().stale);

    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('ask_user', {question: 'Continue?'})),
      ...Array(4).fill((context: TranscriptContext) => fauxAssistantMessage(context.messages.some(message => message.role === 'toolResult'
        && message.toolName === 'ask_user') ? 'answered' : 'parent notice'))]);
    const waiting = await h.agents.start({prompt: 'ask parent', background: false}, {ctx: h.ctx}, loadConfig(h.root));
    await until(() => Boolean(waiting.question));
    // The question wakes the parent; the SDK rejects reload while that response streams.
    await h.idle();
    await h.session.reload();
    assert.ok(h.notices.some(notice => notice.type === 'warning' && notice.text.includes('earlier pi-suite load')));
    await assert.rejects(invoke(h, 'agent_start', {prompt: 'new run'}), /RUNTIME_UNAVAILABLE/);
    await assert.rejects(invoke(h, 'agent_send', {id: finished.record.id, message: 'resume'}), /RUNTIME_UNAVAILABLE/);
    await assert.rejects(invoke(h, 'agent_workflow', {script: script('return 1;')}), /RUNTIME_UNAVAILABLE/);
    const reply = await invoke(h, 'agent_send', {id: waiting.record.id, message: 'yes'});
    assert.equal((reply.details as {action: string}).action, 'answered');
    assert.equal((await waiting.done.promise).result, 'answered');
    await h.manager.stop(workflow.id);
    await h.idle();
    assert.equal(h.agents.busy(), false);
    await h.session.reload();
    assert.notEqual(agentRuntime().owner, h.agents);
    assert.notEqual(workflowRuntime().owner, h.manager);
    assert.equal(workflowRuntime().owner.agents, agentRuntime().owner);
    assert.ok(h.agents.closed && h.manager.closed);
    assert.equal(agentRuntime().owner.get(finished.record.id).record.runId, finished.record.runId);
    assert.equal(workflowRuntime().owner.get(workflow.id).status, 'killed');
  } finally { await h.cleanup(); }
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
    const description = h.session.agent.state.tools.find(tool => tool.name === 'agent_workflow')!.description;
    assert.match(description, /Enabled agentType names:.*visible-special/);
    assert.doesNotMatch(description, /VISIBLE_DESCRIPTION|Script body hooks/);
    assert.match(description, /Read the pi-suite-workflow skill before you write or edit a workflow script/);
    assert.ok(Buffer.byteLength(description) < 1200, 'the model sees routing and parameters, not the full guide');
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
    const context = {...h.ctx, ui: {...h.ctx.ui, custom: async (factory: Function) => new Promise<void>((resolve, reject) => {
      Promise.resolve(factory(terminal(), h.ctx.ui.theme, getKeybindings() as never, resolve)).then(frame => {
        frame.render(40); frames++;
        if (frames === 1) {
          const available = () => frame.actions.filter((action: {available?: () => boolean}) => action.available?.() !== false).map((action: {label: string}) => action.label);
          assert.deepEqual(available(), ['Open children / gates', 'Pause', 'Stop']);
          // Settlement can occur with the same detail frame open; its action set follows it.
          task.status = 'completed';
          assert.deepEqual(available(), ['Open children / gates', 'Replay journal']);
          task.status = 'running';
          reader = frame.reader; frame.reader.scroll(3); frame.reader.query = 'literal';
          frame.handleInput('p');
        } else { assert.strictEqual(frame.reader, reader); assert.equal(frame.reader.query, 'literal'); frame.handleInput('\x1b'); }
      }).catch(reject);
    })}} as unknown as ExtensionContext;
    await showWorkflow(context, {workflows: {manager: h.manager} as never, agents: {} as never, dock: new Dock(), config: () => loadConfig(h.root)}, task);
    assert.equal(frames, 2); assert.equal(task.status, 'paused');
    task.status = 'completed'; task.control = undefined;
    file(join(h.root, 'workflows', 'browser.js'), script('return "SAVED_SOURCE_MARKER";'));
    let browserPhase = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      const done = (value: unknown) => { dispose?.(); resolve(value as never); };
      Promise.resolve(factory(terminal(), h.ctx.ui.theme, getKeybindings() as never, done)).then(frame => {
        dispose = frame.dispose?.bind(frame);
        for (const width of [40, 60, 120]) assert.ok(frame.render(width).every(line => visibleWidth(line) <= width));
        if (browserPhase++ === 1) { assert.ok(frame instanceof DetailsView); frame.handleInput('\x1b'); return; }
        assert.ok(frame instanceof BrowserView);
        if (browserPhase === 1) { frame.handleInput('/'); frame.handleInput('Host'); frame.handleInput('\r'); frame.handleInput('\r'); }
        else if (browserPhase === 3) frame.handleInput('s');
        else if (browserPhase === 4) {
          focusBrowser(frame, 'Filter'); frame.handleInput('browser'); assert.match(frame.render(120).join('\n'), /SAVED_SOURCE_MARKER/);
          frame.handleInput('\r'); frame.handleInput('2');
        } else if (browserPhase === 5) {
          assert.match(frame.render(120).map(stripVTControlCharacters).join('\n'), /Subagents ▸ Types.*2 Types/);
          frame.handleInput('4');
        } else {
          assert.equal(browserPhase, 6); assert.match(frame.render(120).map(stripVTControlCharacters).join('\n'), /Workflows · Saved/);
          assert.equal(frame.getSelectedItem()?.value, 'browser'); assert.match(frame.render(120).join('\n'), /SAVED_SOURCE_MARKER/);
          focusBrowser(frame, 'Filter'); frame.handleInput('\x1b'); frame.handleInput('\x1b');
        }
      }).catch(reject);
    });
    const calls = h.faux.state.callCount;
    await h.session.extensionRunner.getCommand('subagents')!.handler('workflows', {...h.ctx, ui: {...h.ctx.ui, custom}} as ExtensionCommandContext);
    assert.equal(browserPhase, 6); assert.equal(h.faux.state.callCount, calls);
  } finally { await h.cleanup(); }
});
