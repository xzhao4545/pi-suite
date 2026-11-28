import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionContext, ExtensionUIContext, SessionEntry } from '@earendil-works/pi-coding-agent';
import { Text, getKeybindings, visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { executeAgent } from '../../src/agents/runner.ts';
import { childSuite } from '../../src/agents/child.ts';
import { showAgent } from '../../src/agents/viewer.ts';
import { agentDetails } from '../../src/agents/viewer-info.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { DetailsView, showDetails } from '../../src/ui/details.ts';
import { Dock } from '../../src/ui/dock.ts';

async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext;
  const h = await host({root, tools: ['agent_start'], extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  // Keep UI lifecycle tests independent of the parent's automatic notification wakeups;
  // the child still uses the real SDK, resource loader and suite tools.
  const manager = new AgentManager(run => executeAgent(run, pi => childSuite(pi, run, manager), manager.changed,
    (kind, details) => manager.event(kind, run, details)), async () => []);
  const config = loadConfig(root, root);
  return {...h, root, ctx, manager, config, async cleanup() { await manager.shutdown(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }};
}
function scripted(ctx: ExtensionContext, steps: ((view: DetailsView) => void | Promise<void>)[], input?: () => Promise<string | undefined>) {
  let opened = false;
  const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
    assert.equal(opened, false); opened = true;
    let dispose: (() => void) | undefined;
    const done = (value: unknown) => { opened = false; dispose?.(); resolve(value as never); };
    Promise.resolve(factory(terminal(), ctx.ui.theme, getKeybindings() as never, done)).then(async view => {
      assert.ok(view instanceof DetailsView); dispose = view.dispose.bind(view);
      for (const width of [40, 60, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
      const step = steps.shift(); assert.ok(step, 'Unexpected reader reopen'); await step(view);
    }).catch(reject);
  });
  return {...ctx, ui: {...ctx.ui, custom, input: async () => { assert.equal(opened, false, 'input must open after detail closes'); return input?.(); }}};
}
async function until(manager: AgentManager, ready: () => boolean) {
  if (ready()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Condition not reached')); }, 5000);
    const off = manager.subscribe(() => { if (ready()) { clearTimeout(timer); off(); resolve(); } });
  });
}
const text = (view: DetailsView) => view.reader.render(120).map(stripVTControlCharacters).join('\n');
const visibleActions = (view: DetailsView) => view.actions.filter(action => action.available?.() !== false).map(action => action.label);
const renderers = { renderer: () => undefined,
  customRendererLookup: () => ({ getMessageRenderer: () => undefined, getEntryRenderer: () => undefined }) };

test('agent details toggle Markdown output from the reader without shortening non-TUI notifications', {timeout: 15000}, async () => {
  const h = await setup(), dock = new Dock();
  try {
    const result = ['**Rendered result**', '', ...Array.from({length: 30}, (_, i) => `- Item ${i + 1}`)].join('\n');
    h.faux.setResponses([fauxAssistantMessage(result)]);
    const run = await h.manager.start({prompt: 'show Markdown output'}, {ctx: h.ctx}, h.config);
    assert.equal((await run.done.promise).state, 'completed');
    const steps = [(view: DetailsView) => view.handleInput('d'), (view: DetailsView) => {
      const screen = () => stripVTControlCharacters(view.render(120).join('\n'));
      view.handleInput('\x1b[F');
      assert.match(screen(), /Output: 32 lines · e expand/);
      assert.match(screen(), /e expand output/);
      assert.doesNotMatch(text(view), /Rendered result/);
      view.handleInput('e');
      assert.match(screen(), /Rendered result/);
      assert.match(screen(), /e collapse output/);
      assert.doesNotMatch(text(view), /\*\*Rendered result\*\*/);
      view.handleInput('e');
      assert.match(screen(), /Output: 32 lines · e expand/);
      assert.doesNotMatch(text(view), /Rendered result/);
      view.handleInput('\x1b');
    }, (view: DetailsView) => view.handleInput('\x1b')];
    await showAgent(scripted(h.ctx, steps), {manager: h.manager, admitSend: () => h.manager, ...renderers, scope: ctx => ({ctx})}, dock,
      run.record.id, run.record.runId, () => h.config);
    assert.equal(steps.length, 0);
    await showDetails({...h.ctx, mode: 'rpc'}, dock, 'Agent details', agentDetails(run.record));
    assert.ok(h.notices.at(-1)?.text.endsWith(`── Output ──\n${result}`));
  } finally { await h.cleanup(); }
});

test('viewer answers workflow questions, preserves search through input and requires two x presses to stop the selected live run', {timeout: 15000}, async () => {
  const h = await setup(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('ask_user', {question: 'What next?', timeoutMs: 0})),
      async (_context, options) => { entered.resolve(); options?.signal?.addEventListener('abort', () => gate.resolve(), {once: true}); await gate.promise; return fauxAssistantMessage('question answered'); }]);
    const run = await h.manager.start({prompt: 'workflow question'}, {ctx: h.ctx}, h.config, undefined, {workflowId: 'wf_viewer'});
    await until(h.manager, () => Boolean(run.question));
    let reader: DetailsView['reader'];
    const steps = [async (view: DetailsView) => {
      reader = view.reader; view.handleInput('x'); assert.ok(view.render(40).some(line => stripVTControlCharacters(line).includes('Press x again to stop')));
      view.handleInput('\x1b[A'); assert.ok(view.render(40).every(line => !stripVTControlCharacters(line).includes('Press x again to stop')));
      view.handleInput('x'); view.handleInput('/'); view.handleInput('x'); view.handleInput('b');
      assert.equal(run.controller.signal.aborted, false); view.handleInput('\r'); assert.equal(reader.query, 'xb');
      view.handleInput('m');
      assert.ok(view.render(120).some(line => line.includes('Answer parent question:')));
      view.handleInput('xb answer'); view.handleInput('\r');
      await entered.promise;
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(view.reader, reader); assert.equal(view.reader.query, 'xb');
      assert.match(view.render(120).map(stripVTControlCharacters).join('\n'), /: answered/);
      assert.ok(!visibleActions(view).includes('Message'), 'workflow steering belongs to its host after the question is answered');
      view.handleInput('x'); view.handleInput('x');
    }, (view: DetailsView) => {
      assert.ok(!visibleActions(view).includes('Stop subtree')); view.handleInput('x'); view.handleInput('x'); view.handleInput('\x1b');
    }];
    const ctx = scripted(h.ctx, steps);
    await showAgent(ctx, {manager: h.manager, admitSend: () => h.manager, ...renderers, scope: context => ({ctx: context})}, new Dock(), run.record.id, run.record.runId, () => h.config);
    assert.equal(steps.length, 0); assert.equal(run.record.state, 'stopped');
    assert.ok(h.notices.some(notice => /cleanup confirmed/.test(notice.text)));
  } finally { gate.resolve(); await h.cleanup(); }
});

test('viewer b hands off a real foreground caller and leaves the child running', {timeout: 15000}, async () => {
  const h = await setup(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const manager = agentRuntime().owner;
  try {
    h.faux.setResponses([async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage('background result'); }, fauxAssistantMessage('parent received')]);
    const pending = h.session.getToolDefinition('agent_start')!.execute('viewer-start', {prompt: 'foreground task', background: false}, new AbortController().signal, undefined, h.ctx as never);
    await entered.promise; const run = [...manager.runs.values()][0]; assert.ok(run);
    const steps = [(view: DetailsView) => {
      assert.ok(visibleActions(view).includes('Background')); view.handleInput('b');
      assert.equal(run.record.background, true); assert.equal(run.controller.signal.aborted, false);
      assert.ok(!visibleActions(view).includes('Background')); view.handleInput('\x1b');
    }];
    await showAgent(scripted(h.ctx, steps), {manager, admitSend: () => manager, ...renderers, scope: context => ({ctx: context})}, new Dock(), run.record.id, run.record.runId, () => h.config);
    assert.equal(((await pending).details as {backgrounded: boolean}).backgrounded, true); assert.equal(run.settled, undefined);
    gate.resolve(); assert.equal((await run.done.promise).state, 'completed');
  } finally { gate.resolve(); await h.cleanup(); }
});

test('viewer refreshes every streaming identity in child cwd and refuses late input after that run has resumed', {timeout: 15000}, async () => {
  const h = await setup(), gate = Promise.withResolvers<void>(), resumedGate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>(), resumedEntered = Promise.withResolvers<void>();
  try {
    const target = join(h.root, 'target'); mkdirSync(target);
    h.faux.setResponses([async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage('first result'); },
      async () => { resumedEntered.resolve(); await resumedGate.promise; return fauxAssistantMessage('second result'); }]);
    const run = await h.manager.start({prompt: 'streaming', background: false}, {ctx: h.ctx}, h.config, undefined, {cwd: target});
    await entered.promise;
    const assistant = (value: string): SessionEntry => ({type: 'message', id: 'stream:assistant', parentId: null, timestamp: new Date().toISOString(),
      message: fauxAssistantMessage([fauxText(value), fauxToolCall('read', {path: 'first'}, {id: 'call1'}), fauxToolCall('read', {path: 'second'}, {id: 'call2'})])});
    const result = (id: string, value: string): SessionEntry => ({type: 'message', id: `stream:${id}`, parentId: null, timestamp: new Date().toISOString(),
      message: {role: 'toolResult', toolCallId: id, toolName: 'read', content: [{type: 'text', text: value}], isError: false, timestamp: Date.now()}});
    run.streamingEntry = assistant('initial assistant'); run.liveResults!.set('call1', result('call1', 'initial middle')); run.liveResults!.set('call2', result('call2', 'unchanged last'));
    run.renderers!.set('read', {renderCall: (_args, _theme, context) => { assert.equal(context.cwd, target); return new Text('child tool', 0, 0); },
      renderResult: result => new Text(result.content.map(part => part.type === 'text' ? part.text : '').join('\n'), 0, 0)});
    let resumed: Awaited<ReturnType<AgentManager['send']>>;
    const steps = [async (view: DetailsView) => {
      view.handleInput('o');
      run.liveResults!.set('call1', result('call1', 'changed middle')); h.manager.changed(); assert.match(text(view), /changed middle/);
      run.streamingEntry = assistant('changed assistant'); h.manager.changed(); assert.match(text(view), /changed assistant/);
      assert.match(text(view), /unchanged last/); view.handleInput('m');
      gate.resolve(); await run.done.promise;
      resumed = await h.manager.send(run.record.id, 'separate resume', {ctx: h.ctx}, h.config); await resumedEntered.promise;
      view.handleInput('late viewer message'); view.handleInput('\r');
      await new Promise(resolve => setImmediate(resolve));
      assert.match(view.render(120).map(stripVTControlCharacters).join('\n'), /no longer accepts messages/);
      assert.ok(!visibleActions(view).includes('Message')); assert.ok(!visibleActions(view).includes('Stop subtree'));
      view.handleInput('x'); view.handleInput('x'); assert.equal(resumed.run.controller.signal.aborted, false);
      assert.match(view.render(120).map(stripVTControlCharacters).join('\n'), /late viewer message/);
      view.handleInput('\x1b'); view.handleInput('\x1b');
    }];
    const ctx = scripted(h.ctx, steps);
    await showAgent(ctx, {manager: h.manager, admitSend: () => h.manager, ...renderers, scope: context => ({ctx: context})}, new Dock(), run.record.id, run.record.runId, () => h.config);
    assert.equal(h.faux.state.callCount, 2); assert.ok(!h.notices.some(notice => /no longer accepts messages/.test(notice.text)));
    resumedGate.resolve(); await resumed!.run.done.promise;
  } finally { gate.resolve(); resumedGate.resolve(); await h.cleanup(); }
});
