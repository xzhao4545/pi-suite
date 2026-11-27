import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { showAgent } from '../../src/agents/viewer.ts';
import { Dock } from '../../src/ui/dock.ts';
import { DetailsView } from '../../src/ui/details.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { executeAgent } from '../../src/agents/runner.ts';
import { childSuite } from '../../src/agents/child.ts';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { rmSync } from 'node:fs';
import { getKeybindings } from '@earendil-works/pi-tui';

const body = Array.from({length: 80}, (_, i) => `reading line ${i}`).join('\n') + '\nEND RUN';
test('every first run reader starts at the end; settlement and details round trips retain the paused search, including readonly terminal runs', {timeout: 15000}, async () => {
  const root = agentDir(); let context!: Parameters<typeof showAgent>[0];
  const h = await host({root, extend: pi => pi.on('session_start', (_event, ctx) => {context = ctx;})});
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const manager = new AgentManager(run => executeAgent(run, pi => childSuite(pi, run, manager), manager.changed,
    (kind, details) => manager.event(kind, run, details)), async () => []);
  try {
    h.faux.setResponses([async () => {entered.resolve(); await gate.promise; return fauxAssistantMessage(body);}]);
    const config = loadConfig(root, root), run = await manager.start({prompt: 'read'}, {ctx: context}, config);
    await entered.promise;
    run.streamingEntry = {type: 'message', id: 'stream:assistant', parentId: null, timestamp: new Date().toISOString(),
      message: fauxAssistantMessage(body)} satisfies SessionEntry;
    let retained!: DetailsView['reader'], position = 0, opens = 0;
    const steps = [
      (view: DetailsView) => {
        assert.equal(view.reader.atBottom, true); assert.equal(view.reader.following, true);
        assert.match(stripVTControlCharacters(view.render(120).join('\n')), /END RUN/);
        retained = view.reader;
        view.handleInput('\x1b[H'); view.handleInput('/'); view.handleInput('reading line 20'); view.handleInput('\r');
        view.render(120); position = retained.offset;
        assert.ok(position > 0); assert.equal(retained.following, false);
        view.handleInput('d');
      },
      async (view: DetailsView) => {gate.resolve(); await run.done.promise; view.handleInput('\x1b');},
      (view: DetailsView) => {
        assert.strictEqual(view.reader, retained); assert.equal(retained.offset, position);
        assert.equal(retained.query, 'reading line 20'); assert.equal(retained.following, false);
        view.handleInput('\x1b');
      },
      (view: DetailsView) => {
        assert.notStrictEqual(view.reader, retained); assert.equal(view.reader.atBottom, true);
        assert.match(stripVTControlCharacters(view.render(120).join('\n')), /END RUN/);
        view.handleInput('\x1b');
      },
      (view: DetailsView) => {
        assert.equal(view.reader.atBottom, true); assert.equal(view.reader.following, true);
        assert.ok(view.actions.every(action => action.label !== 'Stop subtree' || action.available?.() === false));
        view.handleInput('\x1b');
      },
    ];
    const ctx = {...context, ui: {...context.ui, custom: async (factory: Parameters<typeof context.ui.custom>[0]) => new Promise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      Promise.resolve(factory(terminal(24, 120), context.ui.theme, getKeybindings() as never,
        value => {dispose?.(); resolve(value as never);})).then(async component => {
        assert.ok(component instanceof DetailsView); dispose = component.dispose.bind(component); component.render(120);
        const step = steps[opens++]; assert.ok(step); await step(component);
      }).catch(reject);
    })}} as typeof context;
    const agents = {manager, admitSend: () => manager, renderer: () => undefined,
      customRendererLookup: () => ({getMessageRenderer: () => undefined, getEntryRenderer: () => undefined}),
      scope: (ctx: typeof context) => ({ctx})};
    await showAgent(ctx, agents, new Dock(), run.record.id, run.record.runId, () => config);
    await showAgent(ctx, agents, new Dock(), run.record.id, run.record.runId, () => config);
    await showAgent(ctx, agents, new Dock(), run.record.id, run.record.runId, () => config, true);
    assert.equal(opens, 5); assert.equal(run.record.state, 'completed');
    // Reader policy is state-independent; terminal-state fixtures reuse the same saved
    // transcript without making provider failures or stop execution part of this UI case.
    for (const state of ['failed', 'stopped'] as const) for (const readonly of [false, true]) {
      run.record.state = state;
      steps.push(view => {
        assert.equal(view.reader.atBottom, true); assert.equal(view.reader.following, true);
        assert.match(stripVTControlCharacters(view.render(120).join('\n')), /END RUN/);
        view.handleInput('\x1b');
      });
      await showAgent(ctx, agents, new Dock(), run.record.id, run.record.runId, () => config, readonly);
    }
    assert.equal(opens, 9);
  } finally {gate.resolve(); await manager.shutdown(); await h.dispose(); rmSync(root, {recursive: true, force: true});}
});
