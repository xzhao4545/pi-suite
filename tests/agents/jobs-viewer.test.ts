import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { AgentSessionRuntime, type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxThinking, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import type { Component } from '@earendil-works/pi-tui';
import { visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir, testShell } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { DetailsView } from '../../src/ui/details.ts';
import { JobLogView } from '../../src/jobs/log-viewer.ts';

type View = Component & {handleInput?: (data: string) => void; dispose?: () => void};
function choose(view: View, value: string) {
  for (let index = 0; index < 15; index++) {
    if (view.render(120).some(line => stripVTControlCharacters(line).trim().startsWith(`→ ${value}`))) { view.handleInput?.('\r'); return; }
    view.handleInput?.('\x1b[B');
  }
  assert.fail(`No selected row for ${value}: ${view.render(120).map(stripVTControlCharacters).join('\n')}`);
}
function scriptUI(ctx: ExtensionContext, steps: ((view: View) => void | Promise<void>)[], select: (title: string, choices: string[]) => string | undefined): ExtensionCommandContext {
  let open = false;
  const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
    assert.equal(open, false, 'agent and job frames must not nest'); open = true;
    let dispose: (() => void) | undefined;
    const done = (result: unknown) => { open = false; dispose?.(); resolve(result as never); };
    Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, done)).then(async view => {
      dispose = () => view.dispose?.();
      for (const width of [40, 60, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
      const step = steps.shift(); assert.ok(step, 'Unexpected custom UI'); await step(view);
    }).catch(reject);
  });
  return {...ctx, ui: {...ctx.ui, custom, select: async (title: string, choices: string[]) => { assert.equal(open, false); return select(title, choices); }}} as ExtensionCommandContext;
}
async function outputReady(path: string, marker: string) {
  const deadline = Date.now() + 5000;
  while (!readFileSync(path, 'utf8').includes(marker)) {
    assert.ok(Date.now() < deadline, 'Job did not produce its expected output');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('agent Transcript reuses owned job UI across child cwd and collected runs, preserving its reader and stopping only the selected job', {timeout: 15000}, async () => {
  const root = agentDir(), parentGate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({modules: {jobs: false}}));
  mkdirSync(join(root, 'agents')); writeFileSync(join(root, 'agents', 'delegator.md'), '---\nname: delegator\nallowed_subagents: all\n---\nDelegate.');
  writeFileSync(join(root, 'input.txt'), 'TOOL_FOLD_CONTENT\n'.repeat(35));
  let ctx!: ExtensionContext;
  const h = await host({root, persisted: true, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const agents = agentRuntime(), runtime = acquireRuntime(root); assert.equal(runtime.mode, 'active'); if (runtime.mode !== 'active') assert.fail('Jobs unavailable');
  const jobs = runtime.manager, config = loadConfig(root, root);
  let disposed = false;
  try {
    h.faux.setResponses(Array(10).fill(async (context: {messages: {role: string}[]}) => {
      const prompt = JSON.stringify(context.messages.find(message => message.role === 'user'));
      if (prompt.includes('PARENT_RUN') && !context.messages.some(message => message.role === 'toolResult')) {
        entered.resolve(); await parentGate.promise; return fauxAssistantMessage(fauxToolCall('read', {path: 'input.txt'}));
      }
      return fauxAssistantMessage([fauxThinking('private thinking'), fauxText('READER_MARKER\n'.repeat(60))]);
    }));
    const parent = await agents.start({prompt: 'PARENT_RUN', type: 'delegator', background: false}, {ctx}, config); await entered.promise;
    const child = await agents.start({prompt: 'CHILD_RUN', background: false}, {ctx, run: parent}, config); await child.done.promise;
    const target = join(root, 'child-target'); mkdirSync(target);
    const owned = (run: typeof parent, cwd: string, marker: string) => jobs.start({cwd, command: `echo ${marker}; read line`,
      ownerSessionId: ctx.sessionManager.getSessionId(), anchorEntryId: null, name: marker.repeat(15).slice(0, 80),
      creator: {agentId: run.record.id, runId: run.record.runId, ancestors: run.record.ancestors}}, testShell());
    const ownJob = await owned(parent, root, 'PARENT_JOB'), childJob = await owned(child, target, 'CHILD_JOB');
    await outputReady(jobs.logPath(ownJob, 'stdout'), 'PARENT_JOB');
    await outputReady(jobs.logPath(childJob, 'stdout'), 'CHILD_JOB');
    parentGate.resolve(); await parent.done.promise;
    const next = (await agents.send(parent.record.id, 'NEXT_RUN', {ctx}, config)).run; await next.done.promise;
    const nextJob = await owned(next, root, 'NEXT_JOB');
    const unrelated = await agents.start({prompt: 'UNRELATED_RUN', background: false}, {ctx}, config); await unrelated.done.promise;
    const unrelatedJob = await owned(unrelated, root, 'OTHER_JOB');
    agents.sweep(Date.now() + 10 * 60_000 + 1); assert.equal(agents.get(parent.record.id, parent.record.runId).run, undefined);
    let reader!: DetailsView['reader'], offset = 0, expanded = '';
    const steps = [(view: View) => {
      assert.ok(view instanceof DetailsView); view.actions.find(action => action.label === 'Tools')!.run();
      reader = view.reader; expanded = reader.render(120).join('\n'); assert.match(expanded, /TOOL_FOLD_CONTENT/);
      reader.scroll(5); reader.query = 'READER_MARKER'; offset = reader.offset; view.actions.find(action => action.label === 'Jobs')!.run();
    }, (view: View) => {
      const list = view.render(120).join('\n'); assert.ok(list.includes(ownJob.id) && list.includes(childJob.id));
      assert.ok(!list.includes(nextJob.id) && !list.includes(unrelatedJob.id)); choose(view, ownJob.id);
    }, (view: View) => {
      assert.ok(view instanceof JobLogView); assert.match(view.reader.render(120).join('\n'), /PARENT_JOB/); view.handleInput('\x1b');
    }, (view: View) => { assert.ok(!view.render(120).join('\n').includes(ownJob.id)); choose(view, childJob.id); },
    (view: View) => { assert.ok(view instanceof JobLogView); assert.match(view.reader.render(120).join('\n'), /CHILD_JOB/); view.handleInput('\x1b'); },
    (view: View) => view.handleInput?.('\x1b'), (view: View) => {
      assert.ok(view instanceof DetailsView); assert.strictEqual(view.reader, reader); assert.equal(reader.offset, offset); assert.equal(reader.query, 'READER_MARKER');
      assert.equal(reader.render(120).join('\n'), expanded); view.handleInput('\x1b');
    }];
    let parentActions = 0, childActions = 0;
    const ui = scriptUI(ctx, steps, (title, choices) => {
      if (title === 'Select agent run') return choices.find(choice => choice.includes(parent.record.runId));
      if (title.startsWith(parent.record.id)) { assert.ok(choices.includes('Jobs')); return 'Transcript'; }
      if (title.startsWith(ownJob.id)) return ['Read stdout', 'Stop job', 'Back'][parentActions++];
      if (title.startsWith(childJob.id)) return ['Read stdout', 'Back'][childActions++];
      assert.fail(`Unexpected selection: ${title}`);
    });
    const before = h.faux.state.callCount;
    await h.session.extensionRunner.getCommand('agents')!.handler('finished', ui);
    assert.equal(steps.length, 0); assert.equal(h.faux.state.callCount, before, 'browsing does not invoke a model');
    assert.equal(jobs.peek(ownJob.id).state, 'stopped');
    for (const job of [childJob, nextJob, unrelatedJob]) assert.equal(jobs.peek(job.id).state, 'running');
    await h.dispose(); disposed = true;
    assert.equal(jobs.closed, true, 'quit closes the existing owner even when the jobs module is disabled');
    for (const job of [childJob, nextJob, unrelatedJob]) assert.equal(jobs.peek(job.id).state, 'stopped');
  } finally {
    parentGate.resolve();
    if (!disposed) { await jobs.shutdown(Date.now() + 5000); await h.dispose(); }
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-session workspace history exposes owned PTY logs through the same menu while withholding attach and stop', {timeout: 15000}, async () => {
  const root = agentDir(); let ctx!: ExtensionContext;
  let current = await host({root, persisted: true, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const agents = agentRuntime(), owner = ctx.sessionManager.getSessionId();
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({root, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent,
      extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
    return {...current, diagnostics: []};
  });
  try {
    current.faux.setResponses([fauxAssistantMessage('owner ready'), fauxAssistantMessage('historical result')]);
    await current.session.prompt('Persist owner session');
    const run = await agents.start({prompt: 'HISTORICAL_RUN', background: false}, {ctx}, loadConfig(root, root)); await run.done.promise;
    const handle = acquireRuntime(root); if (handle.mode !== 'active') assert.fail('Jobs unavailable');
    const jobs = handle.manager, target = join(root, 'foreign-target'); mkdirSync(target);
    const job = await jobs.start({cwd: target, mode: 'pty', command: 'echo FOREIGN_JOB; read line', ownerSessionId: owner, anchorEntryId: null,
      creator: {agentId: run.record.id, runId: run.record.runId, ancestors: []}}, testShell());
    await outputReady(jobs.logPath(job, 'output'), 'FOREIGN_JOB');
    await runtime.newSession(); assert.notEqual(ctx.sessionManager.getSessionId(), owner);
    assert.equal(agents.get(run.record.id).record.ownerSessionId, owner);
    current.faux.setResponses([fauxAssistantMessage('notification received after the reader closes')]);
    let actions = 0;
    const steps = [(view: View) => choose(view, run.record.id), (view: View) => {
      const menu = view.render(120).join('\n'); assert.ok(!menu.includes('Stop child') && !menu.includes('Model / thinking')); choose(view, 'Jobs');
    }, (view: View) => choose(view, job.id), async (view: View) => {
      assert.ok(view instanceof JobLogView); assert.match(view.reader.render(120).join('\n'), /FOREIGN_JOB/);
      const notice = await jobs.start({cwd: root, command: 'echo queued_notice', ownerSessionId: ctx.sessionManager.getSessionId(), anchorEntryId: null}, testShell());
      await jobs.wait(notice.id); assert.equal(current.faux.state.callCount, 0, 'job results cannot wake the model inside an agent job reader');
      view.handleInput('\x1b');
    }, (view: View) => view.handleInput?.('\x1b')];
    const ui = scriptUI(ctx, steps, (_title, choices) => {
      assert.ok(!choices.includes('Stop job') && !choices.includes('Attach terminal'));
      return actions++ === 0 ? 'Read output' : 'Back';
    });
    await current.session.extensionRunner.getCommand('agents')!.handler('workspace', ui);
    assert.equal(steps.length, 0); assert.equal(jobs.peek(job.id).state, 'running');
    await current.idle(); assert.equal(current.faux.state.callCount, 1, 'closing all readers releases the pending result once');
  } finally { await runtime.dispose(); rmSync(root, {recursive: true, force: true}); }
});
