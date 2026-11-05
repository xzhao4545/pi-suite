import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { CombinedAutocompleteProvider, visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentTypes, resolveType } from '../../src/agents/catalog.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { mentionRoster } from '../../src/agents/mentions/provider.ts';
import { handleBase } from '../../src/agents/mentions/grammar.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { writeAgentType, writeAgentTypeEnabled } from '../../src/runtime/config-edit.ts';

function definition(root: string, name: string, enabled: boolean) {
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', `${name}.md`), `---\nname: ${name}\ndescription: SWITCHABLE_DESCRIPTION\nenabled: ${enabled}\nallowed_subagents: true\nextensions: false\nskills: false\n---\nTYPE_CHILD`);
}

/** Select native rows by their full identity while checking both phone and desktop widths. */
function picker(ctx: ExtensionContext, choices: (string | undefined)[]): ExtensionContext {
  const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
    Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, resolve)).then(view => {
      for (const width of [40, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
      const choice = choices.shift();
      if (choice === undefined) { view.handleInput?.('\x1b'); return; }
      for (let i = 0; i < 200; i++) {
        if (view.render(120).some(line => stripVTControlCharacters(line).trim() === `→ ${choice}`)) {
          view.handleInput?.('\r'); return;
        }
        view.handleInput?.('\x1b[B');
      }
      throw new Error(`Missing choice ${choice}`);
    }).catch(reject);
  });
  return { ...ctx, ui: { ...ctx.ui, custom } };
}

test('type enabled writes preserve model fields, edit the active source and restore exact definition identities', () => {
  const root = agentDir(), user = join(root, 'pi-suite.json'), project = join(root, '.pi', 'pi-suite.json');
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    definition(root, 'dormant', false);
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(user, JSON.stringify({ ask: { timeout: 25 }, agents: { types: {
      Explore: { enabled: false, model: 'user/model', thinking: 'low' }, dormant: { enabled: true }, explore: { enabled: false },
    } } }));
    writeFileSync(project, JSON.stringify({ tasks: { reminders: false }, agents: { types: { Explore: { enabled: true, thinking: 'high' } } } }));
    const options = () => ({ typeSettings: loadConfig(root, root).agents.types });
    const snapshot = agentTypes(root, root, options()).find(type => type.name === 'Explore')!;
    assert.equal(snapshot.enabled, true);
    assert.equal(resolveType(root, 'dormant', options()).enabled, true);
    writeAgentTypeEnabled(root, 'Explore', false, root);
    assert.deepEqual(loadConfig(root, root).agents.types.Explore, { enabled: false, model: 'user/model', thinking: 'high' });
    assert.equal(snapshot.enabled, true, 'changing config cannot rewrite an admitted type snapshot');
    assert.equal(JSON.parse(readFileSync(project, 'utf8')).agents.types.Explore.enabled, false);
    assert.throws(() => resolveType(root, 'Explore', options()), /disabled/);
    writeAgentType(root, 'Explore', {}, root);
    assert.deepEqual(loadConfig(root, root).agents.types.Explore, { enabled: false, thinking: 'low' });
    writeAgentTypeEnabled(root, 'Explore', undefined, root);
    assert.deepEqual(loadConfig(root, root).agents.types.Explore, { thinking: 'low' });
    assert.notEqual(resolveType(root, 'Explore', options()).enabled, false, 'lowercase config keys do not pin another type');
    writeAgentTypeEnabled(root, 'dormant', undefined, root);
    assert.throws(() => resolveType(root, 'dormant', options()), /disabled/);
    assert.equal(JSON.parse(readFileSync(user, 'utf8')).ask.timeout, 25);
    assert.equal(JSON.parse(readFileSync(project, 'utf8')).tasks.reminders, false);
    writeFileSync(project, '{"agents":{"types":{"Explore":{"enabled":"no"}}}}');
    const before = readFileSync(user, 'utf8');
    assert.throws(() => writeAgentTypeEnabled(root, 'Explore', true, root), /Invalid/);
    assert.equal(readFileSync(user, 'utf8'), before);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabled types reject ordinary, nested, workflow and restored launches while active runs and fixed workflow continuation survive', { timeout: 15000 }, async () => {
  const root = agentDir(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  definition(root, 'switchable', true);
  let ctx!: ExtensionContext;
  const h = await host({ root, persisted: true, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  const manager = agentRuntime(), scope = { ctx }, config = loadConfig(root, root);
  try {
    h.faux.setResponses([async () => {
      entered.resolve(); await release.promise;
      return fauxAssistantMessage(fauxToolCall('agent_start', { type: 'switchable', prompt: 'nested after disable', background: false }));
    }, context => {
      assert.match(JSON.stringify(context.messages), /disabled agent type: switchable/);
      return fauxAssistantMessage('finished');
    }]);
    const run = await manager.start({ type: 'switchable', prompt: 'first', background: false }, scope, config);
    await entered.promise;
    writeAgentTypeEnabled(root, 'switchable', false, root);
    const disabled = loadConfig(root, root), request = { type: 'switchable', prompt: 'new task' };
    await assert.rejects(manager.start(request, scope, disabled), /disabled/);
    await assert.rejects(manager.start(request, { ctx, run }, disabled), /disabled/);
    await assert.rejects(manager.start(request, scope, disabled, undefined, { workflowId: 'wf_123456789abc' }), /disabled/);
    assert.equal((await manager.send(run.record.id, 'steer after disable', scope, disabled)).action, 'steered');
    release.resolve(); assert.equal((await run.done.promise).state, 'completed');
    assert.equal(manager.runs.size, 1, 'actual nested SDK launch must not admit a disabled type');
    assert.equal(h.faux.state.callCount, 2, 'rejected nested launch makes no additional model request');
    await assert.rejects(manager.send(run.record.id, 'resume disabled', scope, disabled), /disabled/);
    const restored = new AgentManager(async () => {}, async () => []);
    restored.restore([run.record]);
    await assert.rejects(restored.send(run.record.id, 'resume restored', scope, disabled), /disabled/);
    assert.ok(mentionRoster(manager, scope, agentTypes(root, root, { typeSettings: disabled.agents.types })).some(target => target.kind === 'record' && target.record.id === run.record.id));
    const continuation = await restored.start(request, scope, disabled, run.record, { workflowId: 'wf_123456789abc' }, run);
    assert.equal(continuation.type.enabled, true);
    assert.equal((await continuation.done.promise).state, 'completed');
  } finally { release.resolve(); await h.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('/agents types manages disabled types with native selection and immediately refreshes completion and workflow description', { timeout: 15000 }, async () => {
  const root = agentDir(), name = 'switchable-with-a-long-resource-identity-for-native-phone-selection';
  const other = fauxProvider({ provider: 'suite-type-menu', models: [{ id: 'plain', reasoning: false }] });
  const chosen = 'suite-type-menu/plain';
  definition(root, name, false);
  let ctx!: ExtensionContext, pi!: ExtensionAPI;
  const h = await host({ root, tools: ['agent_start', 'agent_workflow'], extend: extension => {
    pi = extension;
    pi.registerProvider({ ...other.provider, auth: { apiKey: { name: 'Offline auth', resolve: async () => ({ auth: {} }) } } });
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  await h.session.modelRuntime.refresh({ allowNetwork: false });
  try {
    const provider = h.autocomplete[0](new CombinedAutocompleteProvider([], root));
    const complete = async () => (await provider.getSuggestions(['@switchable'], 0, 11, { signal: new AbortController().signal }))?.items ?? [];
    const description = () => pi.getAllTools().find(tool => tool.name === 'agent_workflow')!.description;
    const active = pi.getActiveTools();
    const menu = async (...choices: (string | undefined)[]) => {
      await h.session.extensionRunner.getCommand('agents')!.handler('types', picker(ctx, choices) as ExtensionCommandContext);
      assert.deepEqual(pi.getActiveTools(), active, 'description refresh preserves user tool choices');
    };
    assert.deepEqual(await complete(), []); assert.doesNotMatch(description(), /SWITCHABLE_DESCRIPTION/);
    await menu(`${name} · disabled`, 'Model / thinking', chosen, 'off');
    assert.deepEqual(loadConfig(root, root).agents.types[name], { model: chosen, thinking: 'off' });
    const before = readFileSync(join(root, 'pi-suite.json'), 'utf8');
    await menu(`${name} · disabled`, undefined);
    assert.equal(readFileSync(join(root, 'pi-suite.json'), 'utf8'), before);
    await menu(`${name} · disabled`, 'Enable');
    assert.ok((await complete()).some(item => item.value === `@${handleBase(name)}`)); assert.match(description(), /SWITCHABLE_DESCRIPTION/);
    await menu(`${name} · enabled`, 'Disable');
    assert.deepEqual(await complete(), []); assert.doesNotMatch(description(), /SWITCHABLE_DESCRIPTION/);
    assert.equal(loadConfig(root, root).agents.types[name].model, chosen);
    await menu(`${name} · disabled`, 'Use definition');
    assert.equal(loadConfig(root, root).agents.types[name].enabled, undefined);
    assert.deepEqual(await complete(), []);
    await menu(`${name} · disabled`, 'Enable');
    other.setResponses([fauxAssistantMessage('enabled result')]);
    const run = await agentRuntime().start({ type: name, prompt: 'enabled', background: false }, { ctx }, loadConfig(root, root));
    assert.equal((await run.done.promise).state, 'completed');
    await menu(`${name} · enabled`, 'Disable');
    assert.ok((await complete()).some(item => item.value === `@${run.record.handle}`), 'historical handles remain available after a type toggle');
    assert.deepEqual(await h.session.extensionRunner.emitInput(`@${run.record.handle} resume`, undefined, 'interactive'), { action: 'handled' });
    assert.ok(h.notices.some(notice => notice.type === 'error' && /disabled/.test(notice.text)));
  } finally { await h.dispose(); rmSync(root, { recursive: true, force: true }); }
});
