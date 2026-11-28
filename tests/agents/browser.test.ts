import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { getKeybindings, visibleWidth } from '@earendil-works/pi-tui';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { BrowserView, compareActivity } from '../../src/ui/browser.ts';
import { DetailsView } from '../../src/ui/details.ts';
import type { Dock } from '../../src/ui/dock.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { host } from '../support/host.ts';
import { agentDir, testShell } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { chooseBrowserAction } from '../support/browser.ts';

test('subagents navigates pages and empty filters without menu rows or model work, and cancels only the selected queued run', {timeout: 15000}, async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({agents: {maxConcurrent: 1}}));
  let ctx!: ExtensionContext;
  const h = await host({root, extend: pi => pi.on('session_start', (_event, context) => {ctx = context;})});
  try {
    const manager = agentRuntime().owner, config = loadConfig(root);
    h.faux.setResponses([async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage('running finished'); }]);
    const running = await manager.start({prompt: 'long running prompt\n'.repeat(50), name: 'probe long running name '.repeat(4).slice(0, 80)}, {ctx}, config); await entered.promise;
    const queued = await manager.start({prompt: 'queued prompt', name: 'probe queued'}, {ctx}, config);
    assert.equal(queued.record.state, 'queued');
    let phase = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      let disposed: (() => void) | undefined;
      const done = (value: unknown) => { disposed?.(); resolve(value as never); };
      Promise.resolve(factory(terminal(), ctx.ui.theme, getKeybindings() as never, done)).then(view => {
        assert.ok(view instanceof BrowserView); disposed = view.dispose.bind(view);
        for (const width of [40, 60, 120]) {
          const lines = view.render(width); assert.ok(lines.every(line => visibleWidth(line) <= width)); assert.ok(lines.length <= 19);
        }
        const text = () => view.render(600).map(line => stripVTControlCharacters(line).replace(/\x1b_pi:[^\x07]*\x07/g, '')).join('\n');
        assert.doesNotMatch(text(), /Show queued|Show active|Show whole workspace/);
        switch (phase++) {
          case 0:
            assert.match(text(), /All 2.*Queued 1.*Finished 0/); assert.equal(view.getSelectedItem()?.value, queued.record.id);
            assert.ok(view.render(120).some(line => /running · [\d.]+s/.test(stripVTControlCharacters(line.split('│')[0]))), 'long names retain state and runtime');
            view.handleInput('/'); view.handleInput('prbe'); view.handleInput('\x1b[D');
            view.handleInput('\x1b[D'); view.handleInput('o'); view.handleInput('\r'); view.handleInput('s'); break;
          case 1:
            assert.equal(view.getSelectedItem()?.value, queued.record.id); assert.match(text(), /Filter: probe/);
            assert.match(text(), /cancel queued/); assert.doesNotMatch(text(), /m message|b background/);
            view.handleInput('2'); break;
          case 2:
            assert.match(text(), /Subagents ▸ Types.*2 Types/);
            assert.doesNotMatch(text(), /offline/);
            // Native viewport bounds are independent of terminal width; End then Up should move
            // the visible window by position, proving the pane scrolls instead of leaking
            // content beyond the allocated area (position deltas, not label text).
            view.handleInput('\t');
            const beforeEnd = /Details · (\d+)\/(\d+)/.exec(text());
            view.handleInput('\x1b[F');
            const afterEnd = /Details · (\d+)\/(\d+)/.exec(text());
            assert.ok(beforeEnd && afterEnd && Number(afterEnd[1]) > Number(beforeEnd[1]), 'End scrolls the details window forward');
            view.handleInput('\x1b[A');
            const afterUp = /Details · (\d+)\/(\d+)/.exec(text());
            assert.ok(afterUp && afterEnd && Number(afterUp[1]) === Number(afterEnd[1]) - 1, 'Up moves the window back by one line');
            view.handleInput('\x1b'); view.handleInput('\x1b[D'); break;
          case 3:
            assert.equal(view.getSelectedItem()?.value, queued.record.id); assert.match(text(), /Filter: probe/);
            view.handleInput('\x1b[D'); // The Left that switched from Types must not arm Runs' exit.
            chooseBrowserAction(view, 'Cancel queued'); assert.match(text(), /Press x again to cancel queued/);
            assert.equal(queued.controller.signal.aborted, false); view.handleInput('x'); break;
          case 4:
            assert.match(text(), /Queued 0/); assert.match(text(), /No matches · press Esc to clear filter/);
            const navigation = stripVTControlCharacters(view.render(600).at(-3)!);
            for (const hint of ['←← close', 'Esc clear filter', '1-4', 'w scope', 's state', '/ filter', 'Tab details']) assert.ok(navigation.includes(hint), `empty lists retain ${hint}`);
            view.handleInput('s'); break;
          case 5:
            assert.match(text(), /Finished 1/); assert.equal(view.getSelectedItem()?.value, queued.record.id);
            assert.doesNotMatch(text(), /cancel queued|stop subtree/);
            view.handleInput('w'); break;
          case 6:
            assert.match(text(), /Scope \(w\): This session · Workspace/); assert.match(text(), /Runs · Workspace · Finished/); assert.match(text(), /Filter: probe/);
            assert.equal(view.getSelectedItem()?.value, queued.record.id);
            view.handleInput('w'); break;
          case 7:
            assert.match(text(), /Runs · This session · Finished/); assert.equal(view.getSelectedItem()?.value, queued.record.id);
            view.handleInput('\x1b'); view.handleInput('\x1b'); break;
          default: assert.fail('Unexpected browser reopen');
        }
      }).catch(reject);
    });
    await h.session.extensionRunner.getCommand('subagents')!.handler('', {...ctx, ui: {...ctx.ui, custom}} as ExtensionCommandContext);
    assert.equal(phase, 8); assert.equal((await queued.done.promise).state, 'stopped'); assert.equal(running.controller.signal.aborted, false);
    assert.equal(h.faux.state.callCount, 1, 'navigation and filtering never request a model response');
  } finally { gate.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('Runs and Jobs reopen in All and keep activity ahead of newer completed records', {timeout: 15000}, async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  let ctx!: ExtensionContext;
  const h = await host({root, extend: pi => pi.on('session_start', (_event, context) => {ctx = context;})});
  try {
    const agents = agentRuntime().owner, config = loadConfig(root);
    h.faux.setResponses([async () => {entered.resolve(); await gate.promise; return fauxAssistantMessage('finished');}, fauxAssistantMessage('new completion')]);
    const running = await agents.start({prompt: 'keep running', name: 'active run'}, {ctx}, config); await entered.promise;
    const finished = await agents.start({prompt: 'finish now', name: 'new finished run'}, {ctx}, config); await finished.done.promise;
    const runtime = acquireRuntime(root); if (runtime.mode !== 'active') assert.fail('Jobs unavailable');
    const jobs = runtime.manager, owner = {cwd: root, ownerSessionId: ctx.sessionManager.getSessionId(), anchorEntryId: null};
    const activeJob = await jobs.start({...owner, command: 'read line'}, testShell());
    const endedJob = await jobs.start({...owner, command: 'echo done', closeInput: true}, testShell()); await jobs.wait(endedJob.id);
    let frames = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      Promise.resolve(factory(terminal(), ctx.ui.theme, getKeybindings() as never, value => {dispose?.(); resolve(value);})).then(async view => {
        assert.ok(view instanceof BrowserView); dispose = view.dispose.bind(view);
        const text = () => stripVTControlCharacters(view.render(120).join('\n'));
        const isJobs = text().includes('Jobs ▸ List');
        if (frames++ === 1) { assert.match(text(), /Runs · This session · Queued/); view.handleInput('\x1b'); return; }
        assert.match(text(), /(?:Runs|List) · This session · All · 2\/2/);
        assert.equal(view.getSelectedItem()?.value, isJobs ? activeJob.id : running.record.id);
        if (frames === 1) {
          view.handleInput('m'); assert.match(text(), /Message active run:/);
          view.handleInput('inline steer'); view.handleInput('\r'); await new Promise(resolve => setImmediate(resolve));
          assert.match(text(), /active run: (steered|queued)/); assert.equal(view.getSelectedItem()?.value, running.record.id);
        }
        view.handleInput('\x1b[B'); assert.equal(view.getSelectedItem()?.value, isJobs ? endedJob.id : finished.record.id);
        if (frames === 1) view.handleInput('s');
        else { if (isJobs) { view.handleInput('s'); assert.match(text(), /List · This session · Finished/); } view.handleInput('\x1b'); }
      }).catch(reject);
    });
    const ui = {...ctx, ui: {...ctx.ui, custom}} as ExtensionCommandContext;
    for (const command of ['subagents', 'subagents', 'jobs', 'jobs']) await h.session.extensionRunner.getCommand(command)!.handler('', ui);
    assert.equal(frames, 5);
    for (const command of ['subagents', 'jobs']) await assert.rejects(h.session.extensionRunner.getCommand(command)!.handler('active', ui), /Use \/subagents|Unknown \/jobs argument/);
    const records = [{state: 'running', createdAt: '1', lastUpdateAt: '4'}, {state: 'queued', createdAt: '2'},
      {state: 'completed', createdAt: '5', endedAt: '6'}, {state: 'completed', createdAt: '0', endedAt: '7'}];
    assert.deepEqual(records.sort((a, b) => compareActivity(a, b, record => record.state !== 'completed')).map(record => record.createdAt), ['1', '2', '0', '5']);
  } finally {gate.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true});}
});

test('Runs and Dock represent the latest run, and Message resumes the same agent', {timeout: 15000}, async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const tui = terminal(40, 120);
  let ctx!: ExtensionContext, dock!: Dock;
  const h = await host({root, extend: pi => pi.on('session_start', (_event, context) => {ctx = context;}),
    ui: ui => ({...ui, setWidget: (_key, factory) => { if (typeof factory === 'function') dock = factory(tui, ui.theme) as Dock; }})});
  try {
    const manager = agentRuntime().owner;
    h.faux.setResponses([fauxAssistantMessage('first result', {stopReason: 'error', errorMessage: 'PROVIDER_REFUSED'}),
      async () => {entered.resolve(); await gate.promise; return fauxAssistantMessage('second result');}]);
    const first = await manager.start({prompt: 'first prompt', name: 'resume probe', background: false}, {ctx}, loadConfig(root));
    const {id, runId} = await first.done.promise;
    assert.equal(first.record.state, 'failed');
    let phase = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      let dispose: (() => void) | undefined;
      Promise.resolve(factory(tui, ctx.ui.theme, getKeybindings() as never, value => {dispose?.(); resolve(value);})).then(async view => {
        assert.ok(view instanceof BrowserView || view instanceof DetailsView);
        dispose = view.dispose.bind(view);
        const text = () => stripVTControlCharacters(view.render(400).join('\n'));
        const latest = () => manager.get(id).record.runId;
        switch (phase++) {
          case 0:
            assert.ok(view instanceof BrowserView); assert.equal(view.getSelectedItem()?.value, id);
            assert.doesNotMatch(text(), /r runs/);
            view.handleInput('m'); assert.match(text(), /Resume resume probe: /);
            view.handleInput('second prompt'); view.handleInput('\r'); await entered.promise;
            assert.notEqual(latest(), runId); assert.equal(manager.get(id).record.id, id);
            assert.match(text(), /resume probe: resumed/); assert.match(text(), /All 1.*Queued 0.*Finished 0/);
            assert.equal(view.getSelectedItem()?.value, id); view.handleInput('\x1b'); break;
          case 1:
            assert.ok(view instanceof BrowserView);
            view.handleInput('/'); view.handleInput(runId); view.handleInput('\r');
            assert.match(text(), /All · .*1\/1/);
            assert.equal(view.getSelectedItem()?.value, id);
            chooseBrowserAction(view, 'Runs'); break;
          case 2:
            assert.ok(view instanceof BrowserView); assert.equal(view.getSelectedItem()?.value, latest());
            assert.match(text(), /m message/); view.handleInput('\x1b[B');
            assert.equal(view.getSelectedItem()?.value, runId); assert.doesNotMatch(text(), /m message|r runs/);
            view.handleInput('\x1b'); break;
          case 3:
            assert.ok(view instanceof BrowserView); assert.equal(view.getSelectedItem()?.value, id);
            view.handleInput('\r'); break;
          case 4:
            assert.ok(view instanceof DetailsView);
            assert.match(stripVTControlCharacters(view.reader.render(120).join('\n')), /first prompt[\s\S]*second result/);
            view.handleInput('m'); assert.match(text(), /Resume resume probe: /);
            view.handleInput('\x1b'); view.handleInput('\x1b'); break;
          case 5:
            view.handleInput('\x1b'); view.handleInput('\x1b'); break;
          default: assert.fail('Unexpected viewer reopen');
        }
      }).catch(reject);
    });
    const open = () => h.session.extensionRunner.getCommand('subagents')!.handler('', {...ctx, ui: {...ctx.ui, custom}} as ExtensionCommandContext);
    await open();
    const panel = stripVTControlCharacters(dock.render(120).join('\n'));
    assert.equal(panel.match(/resume probe/g)?.length, 1); assert.match(panel, /1 running/); assert.doesNotMatch(panel, /failed/);
    gate.resolve(); await manager.get(id).run!.done.promise;
    await open(); assert.equal(phase, 6);
  } finally { gate.resolve(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});
