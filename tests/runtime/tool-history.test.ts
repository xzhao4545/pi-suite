import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ToolExecutionComponent,
  type AgentSession, type ExtensionUIContext, type SessionStartEvent } from '@earendil-works/pi-coding-agent';
import { terminal } from '../support/terminal.ts';
import { agentDir } from '../support/jobs.ts';

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
  const replay = (session: AgentSession) => {
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
      const collapsed = agent.render(120).map(stripVTControlCharacters).filter(line => line.trim());
      assert.equal(collapsed.length, 1); assert.match(collapsed[0], /History reviewer/); assert.doesNotMatch(collapsed[0], /agent_/);
      agent.setExpanded(true);
      const expanded = agent.render(120).map(stripVTControlCharacters).filter(line => line.trim());
      assert.match(expanded[0], /History reviewer/); assert.match(expanded.join('\n'), /agent_00000001/);
    }
    const collapsed = list.render(120).map(stripVTControlCharacters).filter(line => line.trim());
    assert.equal(collapsed.length, 1); assert.match(collapsed[0], /Tasks.*1 groups 2 items/);
    list.setExpanded(true);
    assert.match(list.render(120).map(stripVTControlCharacters).join('\n'), /History child two/);
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
    const expected = replay(session), sessionFile = session.sessionFile!;
    let beforeStart = false;
    await session.reload({ beforeSessionStart: () => {
      beforeStart = true; checkEarly(session); assert.deepEqual(replay(session), expected);
    } });
    assert.equal(beforeStart, true); assert.deepEqual(replay(session), expected);
    await close(session);
    // Saved history remains readable even when the next activation disables execution modules.
    writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ modules: { ask: false, goal: false, tasks: false, jobs: false, agents: false } }));
    for (const reason of ['resume', 'startup'] as const) {
      const restored = await open(SessionManager.open(sessionFile), { type: 'session_start', reason });
      checkEarly(restored); assert.deepEqual(replay(restored), expected); await bind(restored);
      checkEarly(restored); assert.deepEqual(replay(restored), expected); await close(restored);
    }
    assert.equal(faux.state.callCount, 3, 'history rendering never executes tools or requests a model');
    assert.deepEqual(errors, []);
  } finally { if (current) await close(current); rmSync(root, { recursive: true, force: true }); }
});
