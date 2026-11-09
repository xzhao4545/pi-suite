import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ToolExecutionComponent, highlightCode,
  type AgentSession, type ExtensionUIContext, type SessionStartEvent } from '@earendil-works/pi-coding-agent';
import { terminal } from '../support/terminal.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';

test('actual loader resolves historical renderers before binding, during reload and after resume/restart without admitting disabled tools', async () => {
  const root = agentDir(); process.env.PI_CODING_AGENT_DIR = root;
  const faux = fauxProvider({ provider: 'tool-history-test', models: [{ id: 'offline' }] });
  const errors: unknown[] = [];
  let current: AgentSession | undefined;
  const open = async (manager: SessionManager, event?: SessionStartEvent) => {
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
      additionalExtensionPaths: [resolve('src/index.ts')], extensionFactories: [pi => pi.registerProvider(faux.provider)] });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({ cwd: root, agentDir: root, resourceLoader: loader,
      settingsManager, sessionManager: manager, sessionStartEvent: event, model: faux.getModel(), tools: ['task_edit', 'task_list'] });
    assert.deepEqual(extensionsResult.errors, []); current = session;
    return session;
  };
  const bind = async (session: AgentSession) => session.bindExtensions({ mode: 'tui',
    uiContext: { setStatus() {}, setWidget() {}, notify() {}, addAutocompleteProvider() {}, onTerminalInput() { return () => {}; } } as unknown as ExtensionUIContext,
    onError: error => errors.push(error) });
  const renderer = (session: AgentSession, name: string) => session.extensionRunner.resolveToolRenderers(name, () => session.getToolDefinition(name));
  const names = ['task_list', 'task_get', 'task_edit', 'job_start', 'job_list', 'job_get', 'job_read', 'job_write', 'job_stop',
    'agent_start', 'agent_list', 'agent_get', 'agent_read', 'agent_send', 'agent_stop', 'agent_workflow',
    'ask_user', 'wait', 'goal_complete', 'goal_blocked', 'goal_wait'];
  const checkEarly = (session: AgentSession) => {
    for (const name of names) {
      assert.equal(session.getToolDefinition(name), undefined, 'render-only registration does not admit model tools');
      assert.equal(renderer(session, name)?.renderShell, 'self', name);
      assert.equal(typeof renderer(session, name)?.renderResult, 'function', name);
    }
    assert.equal(renderer(session, 'unrelated_tool'), undefined);
  };
  const replay = (session: AgentSession, highlightEnabled = true) => {
    const tools = new Map<string, ToolExecutionComponent>(), tui = terminal(30, 120);
    let list!: ToolExecutionComponent;
    for (const entry of session.sessionManager.getBranch()) {
      if (entry.type !== 'message') continue;
      if (entry.message.role === 'assistant') for (const call of entry.message.content) {
        if (call.type === 'toolCall') {
          tools.set(call.id, new ToolExecutionComponent(call.name, call.id, call.arguments,
            { outputPad: 2 }, renderer(session, call.name), tui, root));
          if (call.name === 'task_list') list = tools.get(call.id)!;
        }
      }
      else if (entry.message.role === 'toolResult') tools.get(entry.message.toolCallId)!.updateResult(entry.message);
    }
    for (const name of ['agent_get', 'agent_stop']) {
      const agent = tools.get(`history-${name}`)!;
      const collapsed = agent.render(120).map(stripVTControlCharacters).filter(line => line.trim() && !/^─+$/.test(line.trim()));
      assert.equal(collapsed.length, 1); assert.match(collapsed[0], /History reviewer/); assert.doesNotMatch(collapsed[0], /agent_/);
      agent.setExpanded(true);
      const expanded = agent.render(120).map(stripVTControlCharacters).filter(line => line.trim() && !/^─+$/.test(line.trim()));
      assert.match(expanded[0], /History reviewer/); assert.match(expanded.join('\n'), /agent_00000001/);
    }
    const collapsed = list.render(120).map(stripVTControlCharacters).filter(line => line.trim() && !/^─+$/.test(line.trim()));
    assert.equal(collapsed.length, 1); assert.match(collapsed[0], /Tasks.*1 groups 2 items/);
    list.setExpanded(true);
    assert.match(list.render(120).map(stripVTControlCharacters).join('\n'), /History child two/);
    for (const name of ['bash', 'powershell']) {
      const command = tools.get(`history-${name}`)!;
      const highlighted = highlightCode(name === 'bash' ? 'echo "$HOME" | grep value' : '$name = "world"', name)[0]!;
      assert.equal(command.render(120).join('\n').includes(highlighted), highlightEnabled, `${name} uses the saved option snapshot`);
      assert.match(command.render(120).map(stripVTControlCharacters).join('\n'), /native output/);
      command.setExpanded(true); assert.match(command.render(120).map(stripVTControlCharacters).join('\n'), /native output/);
    }
    return collapsed;
  };
  const close = async (session: AgentSession) => {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose(); current = undefined;
  };
  try {
    const session = await open(SessionManager.create(root, join(root, 'sessions')));
    checkEarly(session); await bind(session);
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('task_edit', { op: 'add', title: 'History group', children: ['History child one', 'History child two'] })),
      fauxAssistantMessage(fauxToolCall('task_list', {})), fauxAssistantMessage('Recorded'),
    ]);
    await session.prompt('Record tasks for history');
    // Persisted details carry identity even when rendering precedes binding or modules are disabled.
    for (const name of ['agent_get', 'agent_stop']) {
      const call = { ...fauxToolCall(name, { id: 'agent_00000001' }), id: `history-${name}` };
      session.sessionManager.appendMessage(fauxAssistantMessage(call));
      session.sessionManager.appendMessage({ role: 'toolResult', toolName: name, toolCallId: call.id, timestamp: Date.now(), isError: false,
        content: [{ type: 'text', text: 'agent_00000001 completed · History reviewer · run_00000001' }],
        details: name === 'agent_get' ? { agent: { id: 'agent_00000001', name: 'History reviewer', state: 'completed' } }
          : { name: 'History reviewer', state: 'completed', cleanup: 'confirmed', affected: [] } });
    }
    for (const [name, command] of [['bash', 'echo "$HOME" | grep value\necho done # comment'], ['powershell', '$name = "world"\nWrite-Host $name']]) {
      const call = { ...fauxToolCall(name!, { command }), id: `history-${name}` };
      session.sessionManager.appendMessage(fauxAssistantMessage(call));
      session.sessionManager.appendMessage({ role: 'toolResult', toolName: name!, toolCallId: call.id, timestamp: Date.now(), isError: false,
        content: [{ type: 'text', text: 'native output' }], details: {} });
    }
    const expected = replay(session), sessionFile = session.sessionFile!;
    // The actual child loader excludes the main suite factory. Rendering must be injected by
    // childSuite and use the admitted config snapshot, even for a different execution directory.
    const target = join(root, 'child-target'); mkdirSync(join(target, '.pi'), { recursive: true });
    mkdirSync(join(root, '.pi'), { recursive: true });
    const manager = agentRuntime();
    for (const highlightEnabled of [true, false]) {
      writeFileSync(join(target, '.pi', 'pi-suite.json'), JSON.stringify({ ui: { highlightBuiltinCommands: !highlightEnabled } }));
      // Ordinary runs refresh their snapshot at slot admission, from configCwd on disk.
      writeFileSync(join(root, '.pi', 'pi-suite.json'), JSON.stringify({ ui: { highlightBuiltinCommands: highlightEnabled }, modules: { tasks: false, jobs: false } }));
      const config = loadConfig(root);
      const prompt = `Render child commands ${highlightEnabled}`;
      faux.setResponses([() => {
        const run = [...manager.runs.values()].find(item => item.record.prompt === prompt)!;
        const child = run.session!;
        assert.equal(run.configCwd, root); assert.equal(run.record.cwd, target);
        assert.equal(run.config.ui.highlightBuiltinCommands, highlightEnabled);
        assert.equal(child.extensionRunner.getCommand('suite'), undefined, 'child does not load the main suite');
        assert.equal(child.getToolDefinition('task_list'), undefined, 'display registration does not admit disabled child tools');
        assert.equal(renderer(child, 'task_list')?.renderShell, 'self', 'unbound child history still has Suite display definitions');
        for (const [name, command] of [['bash', 'echo "$HOME" | grep value'], ['powershell', '$name = "world"']]) {
          const live = renderer(child, name!), mapped = run.renderers?.get(name!);
          assert.ok(live?.renderCall); assert.ok(live?.renderResult);
          if (mapped) assert.equal(mapped.renderResult, live.renderResult, 'captured child Transcript map retains native result slot');
          if (name === 'bash') assert.ok(mapped, 'actual child runner captures the enhanced builtin renderer');
          const tool = new ToolExecutionComponent(name!, `child-${name}`, { command, timeout: 2 },
            { outputPad: 2 }, live, terminal(30, 120), target);
          const call = tool.render(120).join('\n');
          assert.equal(call.includes(highlightCode(command!, name!)[0]!), highlightEnabled, `${name} uses run.config, not target config`);
          assert.match(stripVTControlCharacters(call), /timeout 2s/);
          const result = { content: [{ type: 'text', text: 'unchanged child output' }], details: {}, isError: false };
          const before = JSON.stringify(result);
          tool.updateResult(result, true); tool.updateResult(result); tool.setExpanded(true);
          assert.match(tool.render(120).map(stripVTControlCharacters).join('\n'), /unchanged child output/);
          assert.equal(JSON.stringify(result), before);
        }
        return fauxAssistantMessage('child renderers checked');
      }]);
      const child = await manager.start({ prompt, background: false }, { ctx: session.extensionRunner.createContext() }, config, undefined, { cwd: target });
      assert.equal((await child.done.promise).state, 'completed', child.record.error);
    }
    rmSync(join(root, '.pi', 'pi-suite.json'));
    assert.equal(faux.state.callCount, 5, 'only the three parent turns and two explicitly started children requested the model');
    let beforeStart = false;
    await session.reload({ beforeSessionStart: () => {
      beforeStart = true; checkEarly(session); assert.deepEqual(replay(session), expected);
    } });
    assert.equal(beforeStart, true); assert.deepEqual(replay(session), expected);
    writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ ui: { highlightBuiltinCommands: false } }));
    assert.deepEqual(replay(session), expected, 'saving alone keeps the active renderer snapshot');
    await close(session);
    // Saved history remains readable even when the next activation disables execution modules.
    writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ ui: { highlightBuiltinCommands: false },
      modules: { ask: false, goal: false, tasks: false, jobs: false, agents: false } }));
    for (const reason of ['resume', 'startup'] as const) {
      const restored = await open(SessionManager.open(sessionFile), { type: 'session_start', reason });
      checkEarly(restored); assert.deepEqual(replay(restored, false), expected); await bind(restored);
      checkEarly(restored); assert.deepEqual(replay(restored, false), expected); await close(restored);
    }
    assert.equal(faux.state.callCount, 5, 'history rendering never executes tools or requests a model');
    assert.deepEqual(errors, []);
  } finally { if (current) await close(current); rmSync(root, { recursive: true, force: true }); }
});
