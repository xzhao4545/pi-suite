import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { agentSummary, summaryLine } from '../../src/agents/index.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { DetailsView } from '../../src/ui/details.ts';

type Summary = ReturnType<typeof agentSummary>;
async function setup() {
  const root = agentDir(), customDir = join(root, 'custom-saved'), target = join(root, 'target'), other = join(root, 'other-workspace');
  mkdirSync(join(root, 'agents')); mkdirSync(target); mkdirSync(other);
  writeFileSync(join(root, 'agents', 'archive.md'), `---\nname: archive\nsession_dir: ${customDir}\nextensions: false\nskills: false\n---\nARCHIVE_CHILD`);
  let ctx!: ExtensionContext;
  const source = await host({ root, persisted: true, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  const sourceManager = agentRuntime(), config = loadConfig(root, root);
  source.faux.setResponses([fauxAssistantMessage('parent seed')]); await source.session.prompt('seed durable parent');
  source.faux.setResponses(['first saved answer', 'second saved answer', 'ordinary saved answer', 'workflow saved answer', 'other workspace answer'].map(value => fauxAssistantMessage(value)));
  const first = await sourceManager.start({ type: 'archive', prompt: 'first saved prompt', background: false,
    name: 'a long archived agent name that remains selectable without shortening its run identity'.slice(0, 80) }, { ctx }, config, undefined, { cwd: target });
  const previous = await first.done.promise;
  const resumed = await sourceManager.send(previous.id, 'second saved prompt', { ctx }, config);
  const foreign = await resumed.run.done.promise;
  const ordinaryRun = await sourceManager.start({ prompt: 'ordinary saved prompt', background: false }, { ctx }, config);
  const ordinary = await ordinaryRun.done.promise;
  const workflowRun = await sourceManager.start({ prompt: 'workflow saved prompt', background: false }, { ctx }, config, undefined, { workflowId: 'wf_123456789abc' });
  const workflow = await workflowRun.done.promise;
  const outsideRun = await sourceManager.start({ prompt: 'other workspace prompt', background: false }, { ctx: { ...ctx, cwd: other } }, loadConfig(other, root));
  const outside = await outsideRun.done.promise;
  await source.dispose();
  const h = await host({ root, persisted: true, tools: ['agent_list', 'agent_read', 'agent_send', 'agent_stop'],
    extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  const manager = agentRuntime();
  const invoke = async (name: string, params: object) => h.session.getToolDefinition(name)!.execute('history-query', params, new AbortController().signal, undefined, ctx as never);
  return { ...h, root, customDir, target, ctx, manager, config, previous, foreign, ordinary, workflow, outside, invoke,
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

function nativePicker(ctx: ExtensionContext, choices: (string | undefined)[], inspect?: (view: { render(width: number): string[] }) => void): ExtensionContext {
  const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
    Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, resolve)).then(view => {
      for (const width of [40, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
      inspect?.(view);
      if (view instanceof DetailsView) { view.actions.at(-1)!.run(); return; }
      const choice = choices.shift();
      if (choice === undefined) { view.handleInput?.('\x1b'); return; }
      for (let i = 0; i < 200; i++) {
        if (view.render(400).some(line => stripVTControlCharacters(line).trim() === `→ ${choice}`)) {
          view.handleInput?.('\r'); return;
        }
        view.handleInput?.('\x1b[B');
      }
      throw new Error(`Missing choice ${choice}`);
    }).catch(reject);
  });
  return { ...ctx, ui: { ...ctx.ui, custom } };
}

test('workspace queries discover durable owners, custom-directory target runs and stable pages without changing session scope', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    assert.equal(h.manager.records().length, 0);
    assert.ok(h.foreign.sessionFile!.startsWith(h.customDir)); assert.equal(h.foreign.cwd, h.target);
    const old = await h.invoke('agent_read', { id: h.previous.id, runId: h.previous.runId, stream: 'transcript' });
    assert.match(JSON.stringify(old.content), /first saved answer/); assert.doesNotMatch(JSON.stringify(old.content), /second saved answer/);
    const progress = await h.invoke('agent_list', { id: h.foreign.id });
    const details = progress.details as { agent: Summary; runs: Summary[] };
    assert.equal(details.agent.runId, h.foreign.runId); assert.equal(details.runs.length, 2);
    assert.equal(details.agent.ownerSessionId, h.foreign.ownerSessionId);
    const found: Summary[] = []; let cursor: string | undefined;
    do {
      const result = await h.invoke('agent_list', { scope: 'workspace', state: 'all', limit: 1, ...cursor ? { cursor } : {} });
      const page = result.details as { agents: Summary[]; nextCursor?: string };
      found.push(...page.agents); cursor = page.nextCursor;
      if (cursor) assert.match(JSON.stringify(result.content), /\\"scope\\":\\"workspace\\"/);
    } while (cursor);
    assert.deepEqual(new Set(found.map(record => record.runId)), new Set([h.previous.runId, h.foreign.runId, h.ordinary.runId]));
    assert.equal(found.length, 3, 'pagination must not repeat runs of the same agent');
    const session = await h.invoke('agent_list', { state: 'all' });
    assert.deepEqual((session.details as { agents: Summary[] }).agents, []);
    for (const tool of ['agent_list', 'agent_read', 'agent_send', 'agent_stop']) {
      await assert.rejects(h.invoke(tool, { id: h.outside.id, ...tool === 'agent_send' ? { message: 'foreign workspace' } : {} }), { code: 'NOT_FOUND' });
    }
    assert.equal(h.faux.state.callCount, 0, 'history reads perform no model requests');
  } finally { await h.cleanup(); }
});

test('unknown saved IDs retain send ownership and workspace cleanup while foreign history UI offers only read actions', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    const stopped = await h.invoke('agent_stop', { id: h.ordinary.id, runId: h.ordinary.runId });
    assert.equal((stopped.details as { cleanup: string }).cleanup, 'confirmed');
    await assert.rejects(h.invoke('agent_send', { id: h.foreign.id, message: 'foreign resume' }), /not a direct child/);
    let frames = 0;
    const ctx = nativePicker(h.ctx, [summaryLine(h.previous), 'Transcript'], view => {
      frames++;
      if (frames === 2) {
        const rows = view.render(400).map(stripVTControlCharacters).slice(1).join('\n');
        assert.match(rows, /Transcript/); assert.doesNotMatch(rows, /Model \/ thinking|Stop child/);
      }
      if (view instanceof DetailsView) {
        assert.deepEqual(view.actions.filter(action => action.available?.() !== false).map(action => action.label), ['Tools', 'Thinking', 'Jobs', 'Back']);
        assert.match(view.render(400).map(stripVTControlCharacters).join('\n'), /first saved/);
      }
    });
    await h.session.extensionRunner.getCommand('agents')!.handler('workspace finished', ctx as ExtensionCommandContext);
    assert.equal(frames, 3);
    await h.session.extensionRunner.getCommand('agents')!.handler('all', h.ctx as ExtensionCommandContext);
    assert.ok(h.notices.some(notice => notice.text === 'No all agents'));
    await h.session.extensionRunner.getCommand('agents')!.handler('workspace', nativePicker(h.ctx, [undefined]) as ExtensionCommandContext);
    assert.equal(h.manager.get(h.foreign.id).record.ownerSessionId, h.foreign.ownerSessionId);
    assert.equal(h.faux.state.callCount, 0);
  } finally { await h.cleanup(); }
});

test('workspace branch history stays readonly while visible saved records retain model and cleanup controls', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    h.faux.setResponses([fauxAssistantMessage('reader seed')]); await h.session.prompt('seed current owner');
    const branchBase = h.ctx.sessionManager.getLeafId()!;
    h.session.sessionManager.appendCustomEntry('history-branch', { name: 'previous branch' });
    h.faux.setResponses([fauxAssistantMessage('hidden branch answer'), fauxAssistantMessage('visible branch answer')]);
    const hiddenRun = await h.manager.start({ prompt: 'hidden branch', background: false }, { ctx: h.ctx }, h.config);
    const hidden = await hiddenRun.done.promise;
    h.session.sessionManager.branch(branchBase); h.session.sessionManager.appendCustomEntry('history-branch', { name: 'current branch' });
    const visibleRun = await h.manager.start({ prompt: 'visible branch', background: false }, { ctx: h.ctx }, h.config);
    const visible = await visibleRun.done.promise;
    h.manager.sweep(Date.now() + 10 * 60_000 + 1);
    assert.equal(h.manager.get(hidden.id).run, undefined);
    assert.equal(h.manager.visible(hidden, { ctx: h.ctx }), false);
    const checkMenu = async (record: typeof hidden, editable: boolean) => {
      let frames = 0;
      const ctx = nativePicker(h.ctx, [summaryLine(record), undefined], view => {
        if (++frames !== 2) return;
        const rows = view.render(400).map(stripVTControlCharacters).slice(1).join('\n');
        assert.equal(rows.includes('Model / thinking'), editable); assert.equal(rows.includes('Stop child, nested agents and jobs'), editable);
      });
      await h.session.extensionRunner.getCommand('agents')!.handler('workspace finished', ctx as ExtensionCommandContext);
      assert.equal(frames, 2);
    };
    await checkMenu(hidden, false); await checkMenu(visible, true);
    const session = await h.invoke('agent_list', { state: 'all' });
    assert.deepEqual((session.details as { agents: Summary[] }).agents.map(record => record.id), [visible.id]);
    await assert.rejects(h.invoke('agent_send', { id: hidden.id, message: 'resume another branch' }), /not a direct child/);
    assert.equal(h.manager.get(hidden.id).record.ownerSessionId, h.ctx.sessionManager.getSessionId());
    assert.equal(h.faux.state.callCount, 3);
  } finally { await h.cleanup(); }
});
