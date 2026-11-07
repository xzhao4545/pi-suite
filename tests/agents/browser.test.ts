import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { BrowserView } from '../../src/ui/browser.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { chooseBrowserAction } from '../support/browser.ts';

test('subagents navigates pages and empty filters without menu rows or model work, and cancels only the selected queued run', {timeout: 15000}, async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({agents: {maxConcurrent: 1}}));
  let ctx!: ExtensionContext;
  const h = await host({root, extend: pi => pi.on('session_start', (_event, context) => {ctx = context;})});
  try {
    const manager = agentRuntime(), config = loadConfig(root);
    h.faux.setResponses([async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage('running finished'); }]);
    const running = await manager.start({prompt: 'long running prompt\n'.repeat(50), name: 'probe long running name '.repeat(4).slice(0, 80)}, {ctx}, config); await entered.promise;
    const queued = await manager.start({prompt: 'queued prompt', name: 'probe queued'}, {ctx}, config);
    assert.equal(queued.record.state, 'queued');
    let phase = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      let disposed: (() => void) | undefined;
      const done = (value: unknown) => { disposed?.(); resolve(value as never); };
      Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, done)).then(view => {
        assert.ok(view instanceof BrowserView); disposed = view.dispose.bind(view);
        for (const width of [40, 60, 120]) {
          const lines = view.render(width); assert.ok(lines.every(line => visibleWidth(line) <= width)); assert.ok(lines.length <= 19);
        }
        const text = () => view.render(600).map(line => stripVTControlCharacters(line).replace(/\x1b_pi:[^\x07]*\x07/g, '')).join('\n');
        assert.doesNotMatch(text(), /Show queued|Show active|Show whole workspace/);
        switch (phase++) {
          case 0:
            assert.match(text(), /\[Active 1\].*Queued 1/); assert.equal(view.getSelectedItem()?.value, running.record.runId);
            assert.ok(view.render(120).some(line => / · running · [\d.]+s/.test(line.split('│')[0])), 'long names retain state and runtime');
            view.handleInput('/'); view.handleInput('probe'); view.handleInput('\r'); view.handleInput('s'); break;
          case 1:
            assert.equal(view.getSelectedItem()?.value, queued.record.runId); assert.match(text(), /Filter: probe/);
            assert.match(text(), /Cancel queued/); assert.doesNotMatch(text(), /Message|Background/);
            view.handleInput('2'); break;
          case 2:
            assert.match(text(), /Subagents ▸ Types.*\[2 Types\]/); assert.match(text(), /Model settings:/);
            assert.ok(view.render(120).some(line => { const left = line.split('│')[0]; return left.includes('not configured · not configured'); }), 'inherited type fields are not configuration pins');
            assert.match(text(), /Model: not configured \(inherited\)/); assert.match(text(), /Thinking: not configured \(inherited\)/);
            assert.doesNotMatch(text().split('Model settings:')[0], /offline/);
            view.handleInput('['); break;
          case 3:
            assert.equal(view.getSelectedItem()?.value, queued.record.runId); assert.match(text(), /Filter: probe/);
            chooseBrowserAction(view, 'Cancel queued'); assert.match(text(), /Press x again to cancel queued/);
            assert.equal(queued.controller.signal.aborted, false); view.handleInput('x'); break;
          case 4:
            assert.match(text(), /\[Queued 0\]/); assert.match(text(), /No matching records/);
            assert.match(view.render(120).at(-2)!, /\/ filter.*Esc clear filter/, 'empty lists retain list commands');
            view.handleInput('s'); break;
          case 5:
            assert.match(text(), /\[Finished 1\]/); assert.equal(view.getSelectedItem()?.value, queued.record.runId);
            assert.doesNotMatch(text(), /Cancel queued|Stop subtree/);
            view.handleInput('w'); break;
          case 6:
            assert.match(text(), /\[Workspace\]/); assert.match(text(), /\[Finished 1\]/); assert.match(text(), /Filter: probe/);
            assert.equal(view.getSelectedItem()?.value, queued.record.runId);
            view.handleInput('w'); break;
          case 7:
            assert.match(text(), /\[This session\]/); assert.equal(view.getSelectedItem()?.value, queued.record.runId);
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
