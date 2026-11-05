import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, getCurrentSystemPrompt, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentTypes } from '../../src/agents/catalog.ts';
import { recordsIn } from '../../src/agents/records.ts';
import { mentionRoster, resolveMentionTarget } from '../../src/agents/mentions/provider.ts';

async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext;
  const h = await host({ root, tools: ['agent_start'], extend: pi => {
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  return { ...h, root, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition not reached');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function customType(root: string, name: string, fields = '') {
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', `${name}.md`), `---\nname: ${name}\nextensions: false\nskills: false\n${fields}---\nMENTION_CHILD`);
}

test('handle identities persist across resume/restore; additive native completion agrees with scoped dispatch', { timeout: 15000 }, async () => {
  const h = await setup(), gates: PromiseWithResolvers<void>[] = [];
  const manager = new AgentManager(async () => { const gate = Promise.withResolvers<void>(); gates.push(gate); await gate.promise; }, async () => []);
  try {
    const scope = { ctx: h.ctx }, config = { ...h.config, agents: { ...h.config.agents, maxConcurrentForeground: 1 } };
    const first = await manager.start({ prompt: 'first', type: 'Explore', name: 'audit', background: false }, scope, config);
    const second = await manager.start({ prompt: 'second', type: 'Explore', name: 'audit', background: false }, scope, config);
    assert.equal(first.record.handle, 'explore'); assert.equal(first.record.alias, 'audit');
    assert.equal(second.record.handle, 'explore-2'); assert.equal(second.record.alias, 'audit-2');
    assert.equal((await manager.send(second.record.id, 'queued steer', scope, config)).action, 'queued');
    assert.deepEqual(second.pendingMessages, ['queued steer']);
    const list = () => mentionRoster(manager, scope, agentTypes(h.root, h.root, { trusted: true }));
    assert.equal(list().filter(target => target.kind === 'record').length, 2);
    assert.equal(resolveMentionTarget(list(), 'EXPLORE')?.kind, 'record');
    assert.equal(resolveMentionTarget(list(), 'audit-2')?.kind, 'record');
    assert.deepEqual(mentionRoster(manager, { ctx: { ...h.ctx, sessionManager: SessionManager.inMemory(h.root) } }, []).map(target => target.handle), []);
    const native = new CombinedAutocompleteProvider([{ name: 'suite', description: 'Settings' }], h.root);
    const original = native.getSuggestions.bind(native);
    native.getSuggestions = async (lines, line, col, options) => lines[line]?.slice(0, col) === '@au'
      ? { items: [{ value: '@audit.ts', label: '@audit.ts' }], prefix: '@au' } : original(lines, line, col, options);
    // Use the actual session-installed wrapper and native completion application.
    const runtimeFirst = await h.manager.start({ prompt: 'runtime', type: 'Explore', name: 'audit', background: false }, scope, h.config);
    await runtimeFirst.done.promise;
    const provider = h.autocomplete[0](native), options = { signal: new AbortController().signal };
    const suggestions = await provider.getSuggestions(['@au'], 0, 3, options);
    assert.deepEqual(suggestions?.items.map(item => item.value), ['@audit', '@audit.ts']);
    assert.deepEqual(provider.applyCompletion(['@au'], 0, 3, suggestions!.items[0], suggestions!.prefix), { lines: ['@audit '], cursorLine: 0, cursorCol: 7 });
    const cjk = await provider.getSuggestions(['你好。@pl'], 0, 6, options);
    assert.ok(cjk?.items.some(item => item.value === '@plan'));
    assert.equal(provider.applyCompletion(['你好。@pl'], 0, 6, cjk!.items[0], cjk!.prefix).lines[0], '你好。@plan ');
    assert.deepEqual(await provider.getSuggestions(['/su'], 0, 3, options), await native.getSuggestions(['/su'], 0, 3, options));
    await h.session.extensionRunner.emit({ type: 'session_start', reason: 'new' });
    assert.equal(h.autocomplete.length, 1, 'session binds do not stack duplicate wrappers');
    gates.shift()!.resolve(); await first.done.promise; gates.shift()!.resolve(); await second.done.promise;
    const restored = new AgentManager(async () => {}, async () => []); restored.restore(h.manager.records());
    const resumed = await restored.send(runtimeFirst.record.id, 'again', scope, config);
    await resumed.run.done.promise;
    assert.equal(resumed.run.record.handle, 'explore'); assert.equal(resumed.run.record.alias, 'audit');
    assert.equal(mentionRoster(restored, scope, []).filter(target => target.kind === 'record' && target.record.id === runtimeFirst.record.id).length, 1);
  } finally { for (const gate of gates) gate.resolve(); await h.cleanup(); }
});

test('interactive type mentions clone the selected parent conversation and reuse one ordinary launch and result notification', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    customType(h.root, 'review', 'run_in_background: false\n');
    h.faux.setResponses([fauxAssistantMessage('PARENT_DECISION')]); await h.session.prompt('PARENT_CONTEXT');
    const parentMessages = h.session.sessionManager.getBranch().filter(entry => entry.type === 'message').length;
    let cloneCalled = false, cloneFinished = false;
    const respond: FauxResponseFactory = context => {
      const text = JSON.stringify(context.messages);
      if (getCurrentSystemPrompt(context.messages).includes('MENTION_CHILD')) return fauxAssistantMessage('review result');
      if (text.includes('The user has expressed a desire')) {
        assert.match(text, /PARENT_CONTEXT/); assert.match(text, /PARENT_DECISION/);
        assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ['agent_start']);
        if (!cloneCalled) { cloneCalled = true; return fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'CONTEXTUAL_REVIEW from PARENT_DECISION' })); }
        // A second attempted call must not create another agent.
        if (!text.includes('Already attempted')) return fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'duplicate' }));
        cloneFinished = true; return fauxAssistantMessage('launched');
      }
      return fauxAssistantMessage('main received result');
    };
    h.faux.setResponses(Array(8).fill(respond));
    assert.deepEqual(await h.session.extensionRunner.emitInput('@agent-review inspect this', undefined, 'interactive'), { action: 'handled' });
    await until(() => h.manager.runs.size === 1 && Boolean([...h.manager.runs.values()][0].settled));
    await until(() => cloneFinished);
    await h.idle();
    const run = [...h.manager.runs.values()][0];
    assert.equal(run.record.type, 'review'); assert.equal(run.record.prompt, 'CONTEXTUAL_REVIEW from PARENT_DECISION');
    assert.equal(run.record.ownerSessionId, h.ctx.sessionManager.getSessionId()); assert.equal(run.record.handle, 'review');
    assert.equal(run.record.state, 'completed', run.record.error); assert.equal(run.record.background, false);
    const entries = h.session.sessionManager.getBranch();
    assert.ok(entries.filter(entry => entry.type === 'message').length <= parentMessages + 1, 'clone reasoning and tool calls stay off the parent transcript');
    assert.equal(entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').length, 0);
    assert.equal(entries.filter(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification').length, 1);
    assert.ok(recordsIn(entries).some(record => record.runId === run.record.runId));
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let childRequests = 0;
    const resumedResponse: FauxResponseFactory = async context => {
      if (!getCurrentSystemPrompt(context.messages).includes('MENTION_CHILD')) return fauxAssistantMessage('received resumed');
      if (!childRequests++) { entered.resolve(); await release.promise; return fauxAssistantMessage('intermediate'); }
      assert.match(JSON.stringify(context.messages), /steer-target/); return fauxAssistantMessage('resumed result');
    };
    h.faux.setResponses(Array(4).fill(resumedResponse));
    assert.deepEqual(await h.session.extensionRunner.emitInput('@review continue review', undefined, 'interactive'), { action: 'handled' });
    await entered.promise;
    assert.deepEqual(await h.session.extensionRunner.emitInput('@review steer-target', undefined, 'interactive'), { action: 'handled' });
    assert.ok(h.notices.some(notice => notice.text === 'steered: @review')); release.resolve();
    await until(() => h.manager.runs.size === 2 && [...h.manager.runs.values()].every(item => item.settled)); await h.idle();
    assert.equal(h.manager.get(run.record.id).record.handle, 'review');
    assert.ok(h.notices.some(notice => notice.text === 'resumed: @review'));
  } finally { await h.cleanup(); }
});

test('non-user and headless inputs pass through; clone cancellation and failures cannot silently launch after a session switch', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    customType(h.root, 'review');
    for (const input of ['@review', '@src/file.ts explain', 'text @review explain', '@unknown explain']) {
      assert.deepEqual(await h.session.extensionRunner.emitInput(input, undefined, 'interactive'), { action: 'continue' });
    }
    for (const source of ['rpc', 'extension'] as const) assert.deepEqual(await h.session.extensionRunner.emitInput('@review explain', undefined, source), { action: 'continue' });
    const images = [{ type: 'image' as const, data: 'x', mimeType: 'image/png' }];
    assert.deepEqual(await h.session.extensionRunner.emitInput('@main explain', images, 'interactive'), { action: 'transform', text: 'explain', images });
    assert.deepEqual(await h.session.extensionRunner.emitInput('@review explain', images, 'interactive'), { action: 'continue' });
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), cancelled = Promise.withResolvers<void>();
    h.faux.setResponses([async (_context, options) => {
      options!.signal!.addEventListener('abort', () => cancelled.resolve(), { once: true });
      entered.resolve(); await release.promise; return fauxAssistantMessage(fauxToolCall('agent_start', { prompt: 'stale launch' }));
    }]);
    await h.session.extensionRunner.emitInput('@review explain', undefined, 'interactive'); await entered.promise;
    await h.session.extensionRunner.emit({ type: 'session_before_switch', reason: 'new' }); release.resolve();
    await cancelled.promise;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(h.manager.runs.size, 0);
    h.faux.setResponses([fauxAssistantMessage('no launch')]);
    await h.session.extensionRunner.emitInput('@review explain', undefined, 'interactive');
    await until(() => h.notices.some(notice => notice.type === 'error' && notice.text.includes('did not start')));
    assert.equal(h.manager.runs.size, 0);
    writeFileSync(join(h.root, 'pi-suite.json'), JSON.stringify({ agents: { mentions: false } }));
    await h.session.reload();
    assert.deepEqual(await h.session.extensionRunner.emitInput('@review explain', undefined, 'interactive'), { action: 'continue' });
    await h.session.bindExtensions({ mode: 'print' });
    assert.deepEqual(await h.session.extensionRunner.emitInput('@review explain', undefined, 'interactive'), { action: 'continue' });
  } finally { await h.cleanup(); }
});
