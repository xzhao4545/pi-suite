import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { SessionManager, type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentTypeLocations, writeAgentType } from '../../src/runtime/config-edit.ts';
import { chooseModelSettings, editTypeModel, updateAgentModel } from '../../src/agents/model-editor.ts';
import { recordsIn } from '../../src/agents/records.ts';
import { DetailsView } from '../../src/ui/details.ts';

async function setup() {
  const root = agentDir(), other = fauxProvider({ provider: 'suite-model-test', models: [{ id: 'reasoning', reasoning: true }, { id: 'plain', reasoning: false }] });
  let ctx!: ExtensionContext, authenticated = true;
  const h = await host({ root, persisted: true, tools: ['agent_start'], extend: pi => {
    pi.registerProvider({ ...other.provider, auth: { apiKey: { name: 'Offline auth', resolve: async () => authenticated ? { auth: {} } : undefined } } });
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  await h.session.modelRuntime.refresh({ allowNetwork: false });
  return { ...h, root, other, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    async loseAuth() { authenticated = false; await h.session.modelRuntime.refresh({ allowNetwork: false }); },
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

/** Exercise the same native component used by the UI, keeping the complete value behind its row. */
function picker(ctx: ExtensionContext, choices: (string | undefined)[], seen: string[] = []): ExtensionContext {
  const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
    Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, resolve)).then(view => {
      for (const width of [40, 120]) {
        const lines = view.render(width);
        assert.ok(lines.every(line => visibleWidth(line) <= width)); assert.ok(lines.length <= 24);
      }
      seen.push(view.render(120).map(stripVTControlCharacters).join('\n'));
      const choice = choices.shift();
      if (choice === undefined) { view.handleInput?.('\x1b'); return; }
      let found = false;
      for (let i = 0; i < 200; i++) {
        if (view.render(120).some(line => stripVTControlCharacters(line).trim() === `→ ${choice}`)) { found = true; break; }
        view.handleInput?.('\x1b[B');
      }
      assert.ok(found, `Missing choice ${choice}`); view.handleInput?.('\r');
    }).catch(reject);
  });
  return { ...ctx, ui: { ...ctx.ui, custom } };
}

test('type writes edit each field at its source, retain unrelated latest settings and refuse invalid files', () => {
  const root = agentDir(), project = join(root, '.pi', 'pi-suite.json'), user = join(root, 'pi-suite.json');
  try {
    writeAgentType(root, 'Explore', {}, root); assert.equal(existsSync(user), false);
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(user, JSON.stringify({ ask: { timeout: 25 }, agents: { types: { Plan: { thinking: 'low' }, Explore: { model: 'user/model', thinking: 'low' } } } }));
    writeFileSync(project, JSON.stringify({ tasks: { reminders: false }, agents: { types: { Explore: { thinking: 'high' } } } }));
    assert.deepEqual(agentTypeLocations(root, 'Explore', root), { model: user, thinking: project });
    writeAgentType(root, 'Explore', { model: 'chosen/model', thinking: 'medium' }, root);
    assert.equal(loadConfig(root, root).agents.types.Explore.model, 'chosen/model');
    assert.equal(loadConfig(root, root).agents.types.Explore.thinking, 'medium');
    const data = JSON.parse(readFileSync(user, 'utf8')); assert.equal(data.ask.timeout, 25); assert.equal(data.agents.types.Plan.thinking, 'low');
    assert.equal(JSON.parse(readFileSync(project, 'utf8')).tasks.reminders, false);
    writeAgentType(root, 'Explore', {}, root);
    assert.deepEqual(loadConfig(root, root).agents.types.Explore, { thinking: 'low' }, 'deleting a project field exposes its user-level value');
    writeAgentType(root, 'Explore', {}, root);
    assert.equal(loadConfig(root, root).agents.types.Explore, undefined);
    for (const invalid of ['{broken', '{"unknown":true}', '{"jobs":{"launchPolicy":[]}}']) {
      writeFileSync(project, invalid); const before = readFileSync(user, 'utf8');
      assert.throws(() => writeAgentType(root, 'Explore', { model: 'chosen/model' }, root));
      assert.equal(readFileSync(project, 'utf8'), invalid); assert.equal(readFileSync(user, 'utf8'), before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native model picker uses all authenticated models, clamps thinking choices and cancels the whole edit', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    const seen: string[] = [], chosen = 'suite-model-test/reasoning';
    const ctx = { ...h.ctx, scopedModels: [{ model: h.ctx.model! }] };
    const changes = await chooseModelSettings(picker(ctx, [chosen, 'high'], seen), 'Models', {}, () => h.ctx.model);
    assert.deepEqual(changes, { model: chosen, thinking: 'high' });
    assert.ok(seen[0].includes(chosen));
    const plain = await chooseModelSettings(picker(ctx, ['suite-model-test/plain', 'off'], seen), 'Models', {}, () => h.ctx.model);
    assert.deepEqual(plain, { model: 'suite-model-test/plain', thinking: 'off' });
    assert.ok(!seen.at(-1)!.includes('high'));
    assert.equal(await chooseModelSettings(picker(ctx, [chosen, undefined]), 'Models', {}, () => h.ctx.model), undefined);
    const user = join(h.root, 'pi-suite.json'), project = join(h.root, '.pi', 'pi-suite.json');
    mkdirSync(join(h.root, '.pi'), { recursive: true });
    writeFileSync(user, JSON.stringify({ agents: { types: { Explore: { model: 'suite-model-test/plain' } } } }));
    writeFileSync(project, JSON.stringify({ agents: { types: { Explore: { model: chosen } } } }));
    const clearSeen: string[] = [], clear = picker(h.ctx, ['No override', 'off'], clearSeen);
    clear.ui.select = async () => 'Explore';
    await editTypeModel(clear, loadConfig(h.root, h.root), () => {});
    assert.equal(loadConfig(h.root, h.root).agents.types.Explore.model, 'suite-model-test/plain');
    assert.ok(!clearSeen.at(-1)!.includes('high'), 'clearing a project model previews the user model capabilities');
    const before = readFileSync(user, 'utf8'), cancel = picker(h.ctx, [chosen, undefined]);
    cancel.ui.select = async () => 'Explore';
    await editTypeModel(cancel, loadConfig(h.root, h.root), () => assert.fail('cancel must not reload or write'));
    assert.equal(readFileSync(user, 'utf8'), before);
    await h.loseAuth();
    const noAuth: string[] = [];
    await chooseModelSettings(picker(ctx, [undefined], noAuth), 'Models', {}, () => h.ctx.model);
    assert.ok(!noAuth[0].includes('suite-model-test/'));
  } finally { await h.cleanup(); }
});

test('/agents type edit applies to new tool launches without reload and leaves existing runs and explicit parameters intact', { timeout: 15000 }, async () => {
  const h = await setup(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([async (_context, options, _state, model) => {
      assert.equal(model.id, 'offline'); entered.resolve(); await gate.promise;
      assert.equal(options?.signal?.aborted, false); return fauxAssistantMessage('original result');
    }]);
    const original = await h.manager.start({ type: 'Explore', prompt: 'old task', background: false }, { ctx: h.ctx }, h.config);
    await entered.promise;
    const ctx = picker(h.ctx, ['Explore · enabled', 'Model / thinking', 'suite-model-test/reasoning', 'high']);
    ctx.ui.select = async (_title, values) => values.find(value => value === 'Explore');
    await h.session.extensionRunner.getCommand('agents')!.handler('types', ctx as ExtensionCommandContext);
    assert.equal(original.session?.model?.id, 'offline'); assert.equal(original.record.modelSource, 'inherited');
    h.other.setResponses([fauxAssistantMessage('new model result')]);
    h.faux.appendResponses([fauxAssistantMessage(fauxToolCall('agent_start', { type: 'Explore', prompt: 'new task', background: false })), fauxAssistantMessage('parent finished')]);
    await h.session.prompt('start the configured child');
    const updated = [...h.manager.runs.values()].find(run => run !== original && run.record.type === 'Explore')!;
    assert.equal(updated.record.state, 'completed', updated.record.error);
    assert.equal(updated.record.model, 'suite-model-test/reasoning'); assert.equal(updated.record.thinking, 'high');
    assert.equal(updated.record.modelSource, 'type');
    await updateAgentModel(h.manager, h.ctx, original.record.id, { model: 'suite-model-test/reasoning', thinking: 'high' });
    await updateAgentModel(h.manager, h.ctx, original.record.id, {});
    assert.equal(original.record.model, `${h.ctx.model!.provider}/offline`, 'clearing a live edit retains the type settings from its launch');
    const config = loadConfig(h.root, h.root);
    h.faux.appendResponses([fauxAssistantMessage('explicit result')]);
    const explicit = await h.manager.start({ type: 'Explore', prompt: 'override', background: false, model: `${h.ctx.model!.provider}/offline`, thinking: 'off' }, { ctx: h.ctx }, config);
    assert.equal((await explicit.done.promise).modelSource, 'parameter'); assert.equal(explicit.record.thinkingSource, 'parameter');
    await h.loseAuth();
    await assert.rejects(h.manager.start({ type: 'Explore', prompt: 'unavailable' }, { ctx: h.ctx }, config), /agents.types.Explore.model.*unavailable/);
    gate.resolve(); assert.equal((await original.done.promise).state, 'completed');
  } finally { gate.resolve(); await h.cleanup(); }
});

test('individual model switches start at the next SDK request, restore launch choices and survive persisted resume', { timeout: 15000 }, async () => {
  const h = await setup(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([async (_context, options, _state, model) => {
      assert.equal(model.id, 'offline'); entered.resolve(); await gate.promise;
      assert.equal(options?.signal?.aborted, false); return fauxAssistantMessage(fauxToolCall('read', { path: 'input.txt' }));
    }]);
    writeFileSync(join(h.root, 'input.txt'), 'tool result');
    const run = await h.manager.start({ prompt: 'switch after tool', background: false }, { ctx: h.ctx }, h.config);
    await entered.promise;
    await updateAgentModel(h.manager, h.ctx, run.record.id, { model: 'suite-model-test/reasoning', thinking: 'high' });
    assert.equal(run.controller.signal.aborted, false); assert.equal(run.session?.isStreaming, true);
    await updateAgentModel(h.manager, h.ctx, run.record.id, {});
    assert.equal(run.record.modelSource, 'inherited'); assert.equal(run.record.model, `${h.ctx.model!.provider}/offline`);
    await updateAgentModel(h.manager, h.ctx, run.record.id, { model: 'suite-model-test/reasoning', thinking: 'high' });
    const nextRequest: FauxResponseFactory = (_context, options, _state, model) => {
      assert.equal(model.id, 'reasoning'); assert.equal(options?.reasoning, 'high'); return fauxAssistantMessage('next request result');
    };
    h.other.setResponses([nextRequest, nextRequest]); gate.resolve();
    const done = await run.done.promise;
    assert.equal(done.state, 'completed', done.error); assert.equal(done.modelSource, 'individual');
    const saved = recordsIn(SessionManager.open(done.sessionFile!).getEntries()).find(record => record.runId === done.runId)!;
    assert.deepEqual(saved.individual, { model: 'suite-model-test/reasoning', thinking: 'high' });
    const restored = new AgentManager(async () => {}, async () => []);
    restored.restore([saved]);
    await updateAgentModel(restored, h.ctx, done.id, { model: 'suite-model-test/plain', thinking: 'off' });
    assert.equal(restored.get(done.id).record.model, done.model, 'editing a settled record does not rewrite its actual historical model');
    const resumed = await h.manager.send(done.id, 'resume', { ctx: h.ctx }, h.config);
    assert.equal((await resumed.run.done.promise).state, 'completed'); assert.equal(resumed.run.record.modelSource, 'individual');
    assert.equal(h.session.model?.id, 'offline'); assert.equal(h.services.settingsManager.getDefaultModel(), undefined);
  } finally { gate.resolve(); await h.cleanup(); }
});

test('transcript model editing closes its UI first and preserves the native reader when selection is cancelled', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    h.faux.setResponses([fauxAssistantMessage('reader content\n'.repeat(60))]);
    const run = await h.manager.start({ prompt: 'long result', background: false }, { ctx: h.ctx }, h.config);
    assert.equal((await run.done.promise).state, 'completed');
    let phase = 0, opened = false, reader: DetailsView['reader'] | undefined, offset = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      assert.equal(opened, false, 'selectors must not nest inside transcript custom UI'); opened = true;
      let dispose: (() => void) | undefined;
      const done = (value: unknown) => { opened = false; dispose?.(); resolve(value as never); };
      Promise.resolve(factory(terminal(), h.ctx.ui.theme, {} as never, done)).then(view => {
        dispose = (view as { dispose?: () => void }).dispose;
        for (const width of [40, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
        if (phase++ === 0) {
          assert.ok(view instanceof DetailsView); reader = view.reader;
          reader.scroll(5); reader.query = 'reader'; offset = reader.offset;
          view.actions.find(action => action.label === 'Model / thinking')!.run();
        } else if (phase === 2) view.handleInput?.('\x1b');
        else {
          assert.ok(view instanceof DetailsView); assert.equal(view.reader, reader);
          assert.equal(view.reader.offset, offset); assert.equal(view.reader.query, 'reader');
          view.actions.at(-1)!.run();
        }
      }).catch(reject);
    });
    const ctx = { ...h.ctx, ui: { ...h.ctx.ui, custom, select: async (title: string, values: string[]) => title === 'Select agent run' ? values[0] : 'Transcript' } };
    await h.session.extensionRunner.getCommand('agents')!.handler('finished', ctx as ExtensionCommandContext);
    assert.equal(phase, 3); assert.equal(run.record.individual, undefined);
  } finally { await h.cleanup(); }
});
