import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initTheme, highlightCode, createBashToolDefinition, ToolExecutionComponent, type ExtensionAPI, type Theme, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Text, visibleWidth } from '@earendil-works/pi-tui';
import { stripVTControlCharacters } from 'node:util';
import { toolRenderers, stateLine } from '../../src/ui/tool-render.ts';
import { commandComponent } from '../../src/ui/rendering/command.ts';
import { builtinCommandRenderers } from '../../src/ui/rendering/builtin-command.ts';
import { registerToolRenderers, toolRenderer } from '../../src/runtime/tools.ts';
import { stateTone } from '../../src/ui/browser-chrome.ts';
import { writeRenderers } from '../../src/jobs/render.ts';
import { terminal } from '../support/terminal.ts';
import * as agents from '../../src/agents/render.ts';
import { agentDisplayName, agentRuntime } from '../../src/agents/runtime.ts';
import { agentSummary, summaryLine } from '../../src/agents/index.ts';
import type { AgentRecord } from '../../src/agents/types.ts';
import { waitRenderers } from '../../src/runtime/wait-render.ts';
import { agentDir } from '../support/jobs.ts';

function activeTheme(): Theme {
  let selected!: Theme;
  new ToolExecutionComponent('theme-test', 'theme-test', {}, {}, {
    renderCall: (_args, theme) => { selected = theme; return new Text('', 0, 0); },
  }, terminal(), process.cwd());
  return selected;
}

test('shared tool shell merges progress/results, pads one-line summaries and retains full expanded/error output', () => {
  const theme = { fg: (_tone: string, text: string) => `\x1b[31m${text}\x1b[39m` } as Theme;
  const renderer = toolRenderers<unknown, { summary: string }>({
    call: () => ({ icon: '⟳', tone: 'accent', title: 'Call' }),
    collapsed: data => ({ icon: '✔', tone: 'success', title: 'Result\nheading', summary: data.summary, meta: ['meta\nline'] }),
  });
  const ctx = { state: {}, args: {}, isError: false, outputPad: 2 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
  const call = renderer.renderCall!({}, theme, ctx);
  assert.equal(call.render(40).length, 3);
  const body = Array.from({length: 20}, (_, i) => `body ${i}`).join('\n');
  const result = { content: [{type: 'text' as const, text: body}], details: { summary: 'a\nb'.repeat(100) } };
  for (const isPartial of [true, false]) {
    const component = renderer.renderResult!(result, { expanded: false, isPartial }, theme, ctx);
    assert.deepEqual(call.render(40), []);
    for (const width of [40, 60, 120]) {
      const lines = component.render(width);
      assert.equal(lines.length, 3); assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(lines[1].startsWith('  '));
      assert.match(stripVTControlCharacters(lines[0]), /^─+$/);
      assert.equal(lines.at(-1), lines[0]);
    }
  }
  assert.match(renderer.renderResult!(result, {expanded: true, isPartial: false}, theme, ctx).render(40).join('\n'), /body 19/);
  ctx.isError = true;
  const error = renderer.renderResult!(result, {expanded: false, isPartial: false}, theme, ctx).render(40).join('\n');
  assert.match(error, /✘/); assert.match(error, /body 19/);
  assert.ok(error.split('\n').filter(line => stripVTControlCharacters(line).includes('body')).every(line => line.includes('\x1b[31m')));
  const pending = renderer.renderCall!({}, theme, { ...ctx, state: {} });
  for (const width of [1, 3, 7]) assert.ok(pending.render(width).every(line => visibleWidth(line) <= width));
  initTheme('dark');
  const host = new ToolExecutionComponent('suite-test', 'suite-test', {}, { outputPad: 2 }, renderer, terminal(), process.cwd());
  const frames = () => host.render(40).map(stripVTControlCharacters).filter(line => /^─+$/.test(line.trim()));
  assert.equal(frames().length, 2);
  for (const partial of [true, false]) {
    host.updateResult({ ...result, isError: false }, partial); assert.equal(frames().length, 2);
  }
  const before = host.render(40).length;
  assert.equal(host.handleMouse({ type: 'click', button: 'left', x: 3, y: 2, screenX: 3, screenY: 2,
    width: 40, height: before, shift: false, alt: false, ctrl: false })?.handled, true);
  assert.ok(host.render(40).length > before); assert.equal(frames().length, 2);
});

test('structured expansions sanitize before styling, keep literal logs, syntax/layout caches and sensitive error redaction', () => {
  initTheme('dark');
  const theme = activeTheme();
  const command = 'echo "$HOME" --flag | grep value > result\n# comment\necho 中文😀';
  for (const shell of ['bash', 'powershell'] as const) {
    const source = shell === 'bash' ? command : '$name = "world"\nWrite-Host $name # comment';
    const component = commandComponent(source, shell, theme);
    assert.equal(component.render(120).map(line => line.trimEnd()).join('\n'), highlightCode(source, shell).join('\n'));
    const first = component.render(120); assert.equal(component.render(120), first, 'unchanged layout is reused');
    assert.ok(component.render(9).every(line => visibleWidth(line) <= 9));
    component.invalidate(); assert.notEqual(component.render(120), first);
  }
  const themed = commandComponent(command, 'bash', theme), dark = themed.render(120);
  initTheme('light'); assert.notDeepEqual(themed.render(120), dark, 'live theme proxy invalidates syntax ANSI'); initTheme('dark');
  const log = '# literal **not markdown**\nconst secret = 1;\x1b[2J\x1b]52;c;bad\x07';
  const renderer = toolRenderers<unknown, unknown>({ call: () => ({ icon: '', title: 'Object' }),
    collapsed: () => ({ ...stateLine('running'), title: 'Object', meta: [{ text: 'running', tone: 'success' }] }),
    expanded: () => [log, { label: 'source', value: '中文\x1b[2Jsource' },
      { code: '{"value": 1}', language: 'json', label: 'data' },
      { code: 'const x = 1;', path: '/real/file.ts' }, { command, shell: 'bash', label: 'command' },
      { icon: '☑', title: 'Done task', tone: 'dim', strike: true },
      { invalidate() {}, render: () => [theme.fg('accent', 'native component')] }],
  });
  const ctx = { state: {}, args: {}, isError: false, outputPad: 2 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
  const result = { content: [{ type: 'text' as const, text: '' }], details: {} };
  const component = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx);
  const shown = component.render(120).join('\n'), plain = stripVTControlCharacters(shown);
  assert.match(plain, /Object.*running/); assert.match(plain, /# literal \*\*not markdown\*\*/);
  assert.match(shown, new RegExp(theme.fg('toolOutput', '# literal **not markdown**').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plain, /source: 中文source/); assert.match(plain, /native component/); assert.ok(shown.includes('\x1b[9m'));
  assert.doesNotMatch(shown, /\x1b\[2J|\x1b\]52/);
  const old = component.render(120); component.invalidate(); assert.deepEqual(component.render(120), old);
  for (const state of ['starting', 'running', 'queued', 'waiting', 'waiting(parent)', 'stopping', 'failed', 'limited', 'timed_out', 'completed', 'stopped', 'cleanup pending', 'cleanup unconfirmed'])
    assert.equal(stateLine(state).tone, stateTone(state), state);
  const args = { id: 'job_00000001', sensitive: true, keys: ['private-key'] };
  const sensitiveCtx = { state: {}, args, isError: false, outputPad: 0 } as typeof ctx;
  const sensitive = { content: [{ type: 'text' as const, text: 'sent 1 bytes' }], details: { job: { id: args.id } } };
  assert.doesNotMatch(writeRenderers.renderResult!(sensitive, { expanded: true, isPartial: false }, theme, sensitiveCtx).render(120).join('\n'), /private-key/);
  assert.match(writeRenderers.renderResult!(sensitive, { expanded: false, isPartial: false }, theme,
    { ...sensitiveCtx, args: { id: args.id, sensitive: true, input: 'sent' } }).render(120).join('\n'), /sent 1 B/);
  sensitiveCtx.isError = true;
  sensitive.content[0].text = 'Unknown key private-key\nrepair the key name';
  const error = writeRenderers.renderResult!(sensitive, { expanded: false, isPartial: false }, theme, sensitiveCtx).render(120).join('\n');
  assert.doesNotMatch(error, /private-key/); assert.match(stripVTControlCharacters(error), /Unknown key \[sensitive\].*\nrepair the key name/);
  assert.equal(sensitive.content[0].text, 'Unknown key private-key\nrepair the key name', 'display never changes model content');
});

test('builtin command composition invokes native call lifecycle and preserves result slot, shell, timeout and host expansion', () => {
  initTheme('dark'); const theme = activeTheme();
  const base = createBashToolDefinition(process.cwd()) as unknown as ToolRenderers;
  let calls = 0;
  const native = { ...base, renderCall: (...args: Parameters<NonNullable<ToolRenderers['renderCall']>>) => { calls++; return base.renderCall!(...args); } };
  const enhanced = builtinCommandRenderers(native, 'bash', () => true);
  assert.equal(enhanced.renderResult, base.renderResult); assert.equal(enhanced.renderShell, base.renderShell);
  const args = { command: 'echo "$HOME"\necho done # comment', timeout: 2 };
  const ctx = { state: {}, args, cwd: process.cwd(), executionStarted: false, argsComplete: false, isPartial: true, expanded: false,
    isError: false, outputPad: 0, keyHint: () => '', keyText: () => '' } as unknown as Parameters<NonNullable<ToolRenderers['renderCall']>>[2];
  const call = enhanced.renderCall!(args, theme, ctx), shown = call.render(120).join('\n');
  assert.equal(calls, 1); assert.match(stripVTControlCharacters(shown), /timeout 2s/); assert.ok(shown.includes(highlightCode(args.command, 'bash')[0]));
  const disabled = builtinCommandRenderers(base, 'bash', () => false);
  assert.deepEqual(disabled.renderCall!(args, theme, ctx).render(120), base.renderCall!(args, theme, ctx).render(120));
  const self = { ...base, renderShell: 'self' as const }; assert.equal(builtinCommandRenderers(self, 'bash', () => true), self);
  assert.deepEqual(enhanced.renderCall!({}, theme, ctx).render(120), base.renderCall!({}, theme, ctx).render(120), 'streamed/missing args retain native diagnostics');
  let resolve!: Parameters<ExtensionAPI['registerToolRenderer']>[0];
  const pi = { registerToolRenderer: (resolver: typeof resolve) => { resolve = resolver; } } as ExtensionAPI;
  registerToolRenderers(pi, { bash: base }, { bash: next => builtinCommandRenderers(next, 'bash', () => true) });
  assert.equal(resolve('bash', () => native)?.renderResult, native.renderResult);
  assert.equal(toolRenderer(pi, 'bash')?.renderResult, base.renderResult);
  assert.equal(resolve('bash', () => self), self); assert.equal(resolve('unrelated', () => undefined), undefined);
  const tui = terminal(30, 120), host = new ToolExecutionComponent('bash', 'builtin-test', args, {}, enhanced, tui, process.cwd());
  host.setArgsComplete(); host.updateResult({ isError: false,
    content: [{ type: 'text', text: Array.from({ length: 20 }, (_, i) => `output ${i}`).join('\n') }], details: {} });
  const collapsed = host.render(120).map(stripVTControlCharacters).join('\n');
  assert.match(collapsed, /output 19/); assert.doesNotMatch(collapsed, /output 0\s*\n/);
  host.setExpanded(true); assert.match(host.render(120).map(stripVTControlCharacters).join('\n'), /output 0\s*\n/);
});

test('named agent tools and wait render names without changing model IDs or initializing a runtime for missing history', async () => {
  const root = agentDir(), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'absent');
  const id = 'agent_00000001';
  assert.equal(agentDisplayName(id), id);
  assert.equal(existsSync(process.env.PI_CODING_AGENT_DIR), false, 'display lookup does not acquire a disk-backed owner');
  process.env.PI_CODING_AGENT_DIR = root;
  const manager = agentRuntime();
  const record: AgentRecord = { version: 1, id, runId: 'run_00000001', name: 'Review', type: 'general-purpose', prompt: 'Inspect code',
    state: 'completed', elapsedMs: 1200, background: false, persisted: false, cwd: root, ownerSessionId: 'owner', anchorEntryId: null,
    ancestors: [], createdAt: new Date().toISOString(), model: 'offline/model', modelSource: 'inherited', thinking: 'off', thinkingSource: 'inherited' };
  manager.restore([record, { ...record, id: 'agent_00000002', runId: 'run_00000002', name: 'Other' }]);
  const theme = { fg: (_tone: string, text: string) => text } as Theme, agent = agentSummary(record);
  const body = summaryLine(record), content = [{ type: 'text' as const, text: body }];
  const rows: [ToolRenderers, object, object, RegExp][] = [
    [agents.startRenderers, { name: record.name, prompt: record.prompt, background: false }, { agent }, /✔ Review · 1\.2s/],
    [agents.listRenderers, { agentId: id, state: 'all' }, { agents: [agent] }, /Agents · 1 all \(session\)/],
    [agents.getRenderers, { id }, { agent }, /✔ Review · completed/],
    [agents.readRenderers, { id }, { agent, stream: 'result', offset: 0, nextOffset: 100, totalBytes: 100 }, /Review · read · result 0–100 \/ 100 B/],
    [agents.sendRenderers, { id, message: 'Continue' }, { agent, action: 'steered' }, /Review · steered/],
    [agents.stopRenderers, { id }, { name: record.name, state: 'stopped', cleanup: 'confirmed', affected: [{ id }] }, /⊘ Review · stopped · cleanup confirmed/],
  ];
  try {
    for (const [renderer, args, details, expected] of rows) {
      const ctx = { state: {}, args, isError: false, outputPad: 0 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
      assert.match(renderer.renderCall!(args, theme, ctx).render(120).join('\n'), /Review/);
      const result = { content, details }, before = JSON.stringify(result);
      const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx).render(120).join('\n');
      assert.match(collapsed, expected); assert.doesNotMatch(collapsed, /agent_|run_/);
      const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx).render(120).join('\n');
      if (renderer !== agents.listRenderers) assert.match(expanded.split('\n')[1], /Review/);
      assert.match(expanded, /Review/); assert.match(expanded, /agent_00000001/);
      assert.equal(JSON.stringify(result), before); assert.ok(result.content[0].text.startsWith(id));
    }
    const args = { ids: [id] }, summary = `${id} running · Review · ${record.runId}\nread: agent_read({"id":"${id}"})`;
    const result = { content: [{ type: 'text' as const, text: `wait 0/1 settled\n${summary}\nalso:\nAgent result: agent_00000002 completed\njob_00000002 completed\nwf_000000000003 completed\npending: ${id}` }],
      details: { results: [{ id, runId: record.runId, state: 'running', settled: false, summary }],
        others: [{ id: 'agent_00000002', runId: 'run_00000002', state: 'completed', settled: true, summary: 'Agent result: agent_00000002 completed' },
          { id: 'job_00000002', state: 'completed', settled: true, summary: 'job_00000002 completed' },
          { id: 'wf_000000000003', state: 'completed', settled: true, summary: 'wf_000000000003 completed' }],
        pending: [id], timedOut: true, reason: 'timeout' as const } };
    const ctx = { state: {}, args, isError: false, outputPad: 0 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
    const before = JSON.stringify(result);
    assert.match(waitRenderers.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx).render(120).join('\n'), /Wait · 0\/1 settled · returned early: timeout/);
    const expanded = waitRenderers.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx).render(120).join('\n');
    assert.match(expanded, /\nReview running/); assert.match(expanded, /pending: Review/);
    assert.match(expanded, /Agent result: Other completed/);
    assert.match(expanded, /read: agent_read\({"id":"agent_00000001"}\)/);
    assert.match(expanded, /job_00000002 completed\s+wf_000000000003 completed/);
    assert.equal(JSON.stringify(result), before);
  } finally {
    await manager.shutdown(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
