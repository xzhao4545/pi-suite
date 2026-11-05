import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  type ExtensionContext, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import piSuite from '../../src/index.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { workflowRuntime } from '../../src/agents/workflow/manager.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { isWorkflowGate } from '../../src/jobs/types.ts';
import { agentDir, testShell } from '../support/jobs.ts';

test('SDK uses real project module admission, preserves child config and joins disabled execution owners on quit', {timeout: 15000}, async () => {
  const user = agentDir(), project = join(user, 'project'), target = join(user, 'target');
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = user;
  for (const cwd of [project, target]) mkdirSync(join(cwd, '.pi'), {recursive: true});
  const initial = {ask: false, tasks: false, jobs: false, goal: false, agents: true};
  const changed = {ask: true, tasks: true, jobs: true, goal: true, agents: false};
  const write = (cwd: string, modules: typeof initial) => writeFileSync(join(cwd, '.pi', 'pi-suite.json'), JSON.stringify({modules}));
  write(project, initial); write(target, changed);
  assert.notEqual(process.cwd(), project);
  const faux = fauxProvider({provider: `suite-modules-${randomUUID()}`, models: [{id: 'offline'}]});
  const settingsManager = SettingsManager.inMemory({retry: {enabled: false}, compaction: {enabled: false}});
  let ctx!: ExtensionContext, completions = 0;
  const errors: string[] = [];
  const statuses = new Map<string, string | undefined>();
  const loader = new DefaultResourceLoader({cwd: project, agentDir: user, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [pi => {
      pi.registerProvider(faux.provider);
      pi.registerTool({name: 'manual_selection', label: 'Manual selection', description: 'Existing tool selected by the host',
        parameters: Type.Object({}), async execute() { return {content: [{type: 'text', text: 'ok'}], details: {}}; }});
      // Disable an already registered tool before the suite registers its new tools.
      // An unrestricted SDK session proves that late registration preserves this choice.
      pi.on('session_start', (_event, context) => {
        pi.setActiveTools(pi.getActiveTools().filter(name => name !== 'manual_selection'));
        context.ui.setStatus('goal', 'External goal');
      });
      piSuite(pi);
      pi.on('session_start', (_event, context) => { ctx = context; });
    }],
  });
  await loader.reload();
  const {session, extensionsResult} = await createAgentSession({cwd: project, agentDir: user,
    settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(project), model: faux.getModel()});
  const moduleTools = {ask: 'ask_user', tasks: 'task_list', jobs: 'job_list', goal: 'goal_complete', agents: 'agent_start'};
  const admitted = (modules: typeof initial) => {
    for (const [module, name] of Object.entries(moduleTools)) {
      assert.equal(Boolean(session.getToolDefinition(name)), modules[module as keyof typeof initial], name);
      assert.equal(session.getActiveToolNames().includes(name), modules[module as keyof typeof initial], `${name} active`);
      if (module !== 'ask') assert.equal(Boolean(session.extensionRunner.getCommand(module)), modules[module as keyof typeof initial], `${module} command`);
    }
    assert.ok(session.extensionRunner.getCommand('suite'));
    if (!modules.goal) assert.equal(statuses.get('goal'), 'External goal', 'disabled suite goal preserves another provider');
    assert.ok(session.getToolDefinition('manual_selection'));
    assert.equal(session.getActiveToolNames().includes('manual_selection'), false);
    assert.deepEqual(errors, []);
  };
  try {
    assert.deepEqual(extensionsResult.errors, []);
    assert.equal(session.getToolDefinition('agent_start'), undefined, 'factory waits for the real session context');
    await session.bindExtensions({mode: 'tui', onError: error => errors.push(error.error),
      uiContext: {setStatus(key: string, text?: string) { statuses.set(key, text); }, setWidget() {}, notify() {}, addAutocompleteProvider() { completions++; }} as unknown as ExtensionUIContext});
    assert.equal(ctx.cwd, project); admitted(initial);
    assert.equal(completions, 1, 'first startup initializes mentions despite the SDK handler snapshot');

    const manager = agentRuntime();
    faux.setResponses([() => {
      const run = [...manager.runs.values()][0];
      assert.equal(run.record.cwd, target); assert.equal(run.configCwd, project);
      assert.equal(run.config.modules.tasks, false); assert.equal(run.config.modules.jobs, false);
      assert.equal(run.session!.getToolDefinition('task_list'), undefined);
      assert.equal(run.session!.getToolDefinition('job_list'), undefined);
      assert.ok(run.session!.getActiveToolNames().includes('ask_user'), 'child questions retain their parent protocol');
      return fauxAssistantMessage('target child completed');
    }]);
    const run = await manager.start({prompt: 'inspect target', background: false}, {ctx}, loadConfig(project), undefined, {cwd: target});
    assert.equal((await run.done.promise).state, 'completed', run.record.error);

    write(project, changed);
    const original = session.getToolDefinition('agent_start');
    for (const reason of ['new', 'resume', 'fork'] as const) {
      await session.extensionRunner.emit({type: 'session_start', reason});
      admitted(initial); assert.strictEqual(session.getToolDefinition('agent_start'), original);
    }
    await session.extensionRunner.emit({type: 'session_tree', newLeafId: null, oldLeafId: null});
    admitted(initial); assert.equal(completions, 1, 'rebinding keeps one completion wrapper');
    await session.reload(); admitted(changed);
    assert.equal(ctx.cwd, project); assert.equal(completions, 1, 'disabled agents do not add another wrapper');

    const enabled = {ask: true, tasks: true, jobs: true, goal: true, agents: true};
    const disabled = {ask: false, tasks: false, jobs: false, goal: false, agents: false};
    write(project, enabled); await session.reload(); admitted(enabled);
    const owner = ctx.sessionManager.getSessionId(), runtime = acquireRuntime(user);
    assert.ok(runtime.mode === 'active');
    const jobs = runtime.manager, workflow = workflowRuntime(), entered = Promise.withResolvers<void>();
    // The provider ends only on the SDK's real abort signal, so quit must join its child.
    faux.setResponses([async (_context, options) => {
      entered.resolve();
      await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => resolve(), {once: true}));
      return fauxAssistantMessage('aborted child');
    }, fauxAssistantMessage('workflow child completed')]);
    const child = await manager.start({prompt: 'stay alive after disabling agents', background: false}, {ctx}, loadConfig(project));
    await entered.promise;
    const job = await jobs.start({command: 'echo MODULE_QUIT_JOB; read line', cwd: project, mode: 'pty',
      ownerSessionId: owner, anchorEntryId: null}, testShell());
    const gateReady = Promise.withResolvers<string>();
    const off = jobs.subscribe(() => {
      const gate = jobs.sessionJobs(owner).find(item => isWorkflowGate(item) && item.state === 'running');
      if (gate) gateReady.resolve(gate.id);
    });
    const task = await workflow.start({script: `export const meta = {name: 'Module quit', description: 'Verify owner cleanup'}; return await agent('gate', {gate: 'sleep 20'});`}, {ctx}, loadConfig(project));
    const gateId = await Promise.race([gateReady.promise, workflow.finished(task.id).then(() => {
      throw new Error(task.error ?? 'Workflow finished before its gate started');
    })]); off();
    write(project, disabled); await session.reload(); admitted(disabled);
    assert.equal(child.record.state, 'running'); assert.equal(Boolean(child.settled), false);
    assert.equal(task.status, 'running'); assert.equal(workflow.settled(task.id), false);
    assert.equal(jobs.peek(job.id).state, 'running'); assert.equal(jobs.peek(gateId).state, 'running');
    assert.equal(jobs.closed, false); assert.equal(manager.closed, false); assert.equal(workflow.closed, false);

    await session.extensionRunner.emit({type: 'session_shutdown', reason: 'quit'});
    assert.deepEqual(errors, []);
    assert.equal(child.settled, true); assert.equal(child.record.state, 'stopped'); assert.equal(child.session, undefined);
    assert.equal(task.status, 'killed', task.error); assert.equal(workflow.settled(task.id), true);
    for (const id of [job.id, gateId]) {
      const stopped = jobs.peek(id);
      assert.equal(stopped.state, 'stopped'); assert.equal(stopped.cleanup.rootExited, true);
      assert.equal(stopped.cleanup.state, 'managed_scope_confirmed');
    }
    assert.equal(jobs.closed, true); assert.equal(manager.closed, true); assert.equal(workflow.closed, true);
    assert.equal(statuses.get('goal'), 'External goal', 'quit clears only the suite’s owned status keys');
  } finally {
    await session.abort(); await session.extensionRunner.emit({type: 'session_shutdown', reason: 'quit'}); session.dispose();
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(user, {recursive: true, force: true});
  }
});
