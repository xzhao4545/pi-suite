import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { ToolExecutionComponent, initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, KeybindingsManager, TUI_KEYBINDINGS, Text, visibleWidth } from '@earendil-works/pi-tui';
import { BrowserView, browseState } from '../../src/ui/browser.ts';
import { DetailsView } from '../../src/ui/details.ts';
import { detailsContent } from '../../src/ui/structured-details.ts';
import { jobDetail, jobDetailView } from '../../src/jobs/query.ts';
import type { JobSummary } from '../../src/jobs/types.ts';
import { readingRows } from '../../src/ui/reading.ts';
import { DoubleLeft, ViewerNavigation } from '../../src/ui/viewer/navigation.ts';
import { agentInformation } from '../../src/ui/viewer/agent-information.ts';
import type { AgentRecord } from '../../src/agents/types.ts';
import { terminal } from '../support/terminal.ts';
import { readerTerminal } from '../support/reader.ts';

function activeTheme(): Theme {
  let result!: Theme;
  new ToolExecutionComponent('theme', 'theme', {}, {}, {renderCall: (_args, theme) => {
    result = theme; return new Text('', 0, 0);
  }}, terminal(), process.cwd());
  return result;
}
const plain = (lines: string[]) => stripVTControlCharacters(lines.join('\n'));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('structured job details retain plain text after stripping theme colors', () => {
  const job: JobSummary = {schemaVersion: 1, id: 'job_00000001', workspace: {root: '/work', key: '/work', hash: 'work'},
    ownerRuntimeId: 'runtime', ownerSessionId: 'session', anchorEntryId: null, name: `${'a'.repeat(80)} ${'b'.repeat(80)}`, cwd: '/work',
    mode: 'pipe', state: 'failed', command: 'echo "**literal**"\n  echo next', createdAt: '2025-01-01T00:00:00.000Z',
    elapsedMs: 2500, exitCode: 1, cleanup: {state: 'not_required', scope: [], rootExited: true},
    error: 'first line\nsecond line', taskId: '1.2', taskGeneration: 'generation'};
  const legacy = [`name: ${job.name}`, 'cwd: /work', 'mode: pipe', 'state: failed', 'runtime: 2.5s', `command: ${job.command}`,
    `created ${job.createdAt}`, 'exit: 1', 'cleanup: not_required', `error: ${job.error}`, 'task: 1.2 · source generation: generation'];
  assert.deepEqual(jobDetail(job, true), legacy);
  const grouped = [...legacy.slice(0, 5), '', legacy[5], '', ...legacy.slice(6, 9), '', legacy[9], '', legacy[10]].join('\n');
  const view = detailsContent(jobDetailView(job, true), activeTheme());
  const plainView = new Text(grouped, 0, 0);
  for (const width of [18, 40, 120]) {
    const lines = view.render(width);
    assert.notEqual(lines.join('\n'), plain(lines));
    assert.equal(plain(lines), plainView.render(width).join('\n'));
  }
});

test('double Left is an explicit chain result, excludes repeat/release/modifiers and resets across other keys or timeout', () => {
  let now = 0;
  const left = new DoubleLeft(() => now);
  assert.equal(left.handle('\x1b[D'), false);
  assert.equal(left.handle('\x1b[57350;1:2u'), false);
  assert.equal(left.handle('\x1b[57350;1:3u'), false);
  now = 300; assert.equal(left.handle('\x1b[D'), true);
  assert.equal(left.handle('\x1b[D'), false);
  now += 301; assert.equal(left.handle('\x1b[D'), false);
  left.handle('x'); assert.equal(left.handle('\x1b[D'), false);
  left.handle('\x1b[1;2D'); assert.equal(left.handle('\x1b[D'), false);
  left.reset(); assert.equal(left.handle('\x1b[D'), false);

  const navigation = new ViewerNavigation();
  let exits = 0;
  const browser = new BrowserView(terminal(), {title: 'Jobs', state: browseState(), navigation,
    items: () => [{value: 'stable-id', label: 'human name', details: () => 'body'}]}, () => exits++);
  browser.render(40); browser.handleInput('/'); browser.handleInput('human');
  browser.handleInput('\x1b[D'); browser.handleInput('\x1b[D'); assert.equal(exits, 0);
  browser.handleInput('\x1b'); browser.handleInput('\x1b[D'); browser.handleInput('\x1b[D');
  assert.equal(navigation.result, 'close'); assert.equal(exits, 1); browser.dispose();
  const reopened = new DoubleLeft(() => now);
  assert.equal(reopened.handle('\x1b[D'), false, 'a parent/child/next view never inherits a pending Left');
});

test('shared native Editor budgets Chinese multiline drafts, uses injected keys, blocks shortcuts and preserves failed drafts without duplicate submissions', async () => {
  const tui = terminal(), theme = activeTheme(), navigation = new ViewerNavigation();
  const keys = new KeybindingsManager(TUI_KEYBINDINGS, {'tui.input.submit': ['ctrl+s'], 'tui.input.newLine': ['alt+enter']});
  const messages: string[] = [];
  let exits = 0;
  const browser = new BrowserView(tui, {title: 'Subagents', state: browseState(), navigation,
    items: () => [{value: 'run-old', label: 'selected run', details: () => 'body\n'.repeat(60)}],
    actions: () => [{key: 'm', label: 'Message', input: () => ({multiline: true, prompt: 'Message selected run:',
      submit: async value => {messages.push(value); if (messages.length === 1) throw new Error('retry this draft'); return 'Sent';}})}]}, () => exits++, theme, keys as never);
  browser.render(40); browser.handleInput('m');
  browser.handleInput('\x1b[200~  中文\n' + 'a long draft line\n'.repeat(30) + '\x1b[201~');
  browser.handleInput('\x1b\r'); browser.handleInput('mdo');
  browser.handleInput('\x1b[D'); browser.handleInput('\x1b[D');
  for (const rows of [18, 24, 40]) for (const width of [40, 120]) {
    Object.assign(tui.terminal, {rows, columns: width});
    const lines = browser.render(width);
    assert.ok(lines.length <= Math.floor(rows * 0.8));
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.equal(lines.join('').split(CURSOR_MARKER).length - 1, 1);
    assert.match(plain(lines), /▸ Input/);
    assert.match(plain(lines), /ctrl\+s send.*alt\+enter newline/);
  }
  browser.handleInput('\r'); assert.equal(messages.length, 0, 'Enter cannot bypass the injected submit binding');
  browser.handleInput('\x13'); browser.handleInput('\x13'); await tick();
  assert.equal(messages.length, 1); assert.ok(messages[0].startsWith('  中文\n'));
  assert.match(messages[0], /mdo/); assert.ok(messages[0].split('\n').length > 30);
  assert.match(plain(browser.render(120)), /retry this draft/);
  assert.equal(navigation.closed, false); assert.equal(exits, 0);
  browser.handleInput('\x13'); await tick();
  assert.equal(messages[1], messages[0], 'failure retries the same native draft, not a fresh/trimmed input');
  assert.match(plain(browser.render(120)), /Sent/);
  browser.handleInput('m'); browser.handleInput('cancel this'); browser.handleInput('\x1b');
  assert.equal(messages.length, 2); assert.equal(exits, 0);
  assert.equal(browser.getSelectedItem()?.value, 'run-old');
  browser.handleInput('\x1b'); assert.equal(exits, 1); assert.equal(navigation.result, 'back'); browser.dispose();
});

test('Subagent bottom metadata and native search/editor share a bounded keyboard frame without repeating a top title', () => {
  const record: AgentRecord = {version: 1, id: 'agent_deadbeef', runId: 'run_deadbeef', type: 'general-purpose', name: 'failed 中文名称',
    prompt: 'prompt', cwd: '.', ownerSessionId: 'owner', anchorEntryId: null, ancestors: [], background: true, state: 'running',
    createdAt: new Date().toISOString(), persisted: false, model: 'provider/model', modelSource: 'type', thinking: 'high', thinkingSource: 'type',
    elapsedMs: 1200, toolUses: 4, usage: {tokens: {input: 12000, output: 3000, cacheRead: 0, cacheWrite: 0, total: 15000}, cost: 0}};
  const tui = terminal(), navigation = new ViewerNavigation();
  let exits = 0;
  const theme = activeTheme();
  const view = new DetailsView(tui, () => 'MUST_NOT_BE_TOP', new Text('BODY\n'.repeat(80), 0, 0), () => exits++,
    [{key: 'm', label: 'Message', input: () => ({multiline: true, prompt: 'Message selected run:', submit: async () => 'Sent'})}], undefined, theme,
    {title: false, navigation, bottom: width => agentInformation(record, false, false, view.reader, width, theme)});
  for (const appearance of ['dark', 'light']) {
    initTheme(appearance);
    for (const rows of [18, 24, 40]) for (const width of [40, 120, 200]) {
      Object.assign(tui.terminal, {rows, columns: width});
      const lines = view.render(width), information = agentInformation(record, false, false, view.reader, width, theme);
      assert.match(stripVTControlCharacters(lines[1]), /BODY/);
      assert.doesNotMatch(plain(lines), /MUST_NOT_BE_TOP|agent_deadbeef|run_deadbeef/);
      assert.equal(lines.length, Math.floor(rows * 0.7)); assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(information.length <= 2);
      const start = lines.findIndex(line => stripVTControlCharacters(line) === stripVTControlCharacters(information[0]));
      assert.ok(start > 1);
      assert.equal(plain(lines.slice(start, start + information.length)), plain(information));
      assert.equal(stripVTControlCharacters(lines[start + information.length]), '─'.repeat(width), 'no blank metadata row precedes the footer separator');
      assert.equal(view.reader.viewportHeight, start - 2, 'the reclaimed information row belongs to the body');
      if (width === 200) assert.equal(information.length, 1);
    }
  }
  Object.assign(tui.terminal, {rows: 24, columns: 40}); view.render(40);
  const offset = view.reader.offset;
  const native = readerTerminal(24, 40);
  native.tui.showOverlay(view, {row: 0, col: 0, width: 40, maxHeight: 16}); native.tui.renderNow();
  native.send('\x1b[B'); assert.ok(view.reader.offset > offset);
  native.dispose();
  view.handleInput('/'); view.handleInput('BODY'); view.handleInput('\x1b[D'); view.handleInput('\x1b[D'); assert.equal(exits, 0);
  assert.equal(view.render(40).join('').split(CURSOR_MARKER).length - 1, 1);
  view.handleInput('\x1b'); view.handleInput('m'); view.handleInput('中文\n'.repeat(30));
  assert.ok(view.render(40).length <= Math.floor(24 * 0.7));
  view.handleInput('\x1b[D'); view.handleInput('\x1b[D'); assert.equal(exits, 0);
  view.handleInput('\x1b'); view.handleInput('\x1b[D'); view.handleInput('\x1b[D'); assert.equal(exits, 1);
  assert.equal(navigation.result, 'close'); view.dispose(); initTheme('dark');
});

test('Details metadata settles follow/clamp before slicing, measures its document once and leaves replacement reader callbacks intact', () => {
  const tui = terminal(24, 10);
  let measures = 0, document = Array.from({length: 100}, (_, i) => `BODY ${i}`);
  const content = {render: () => {measures++; return document;}, invalidate() {}};
  const view = new DetailsView(tui, () => '', content, () => {}, [], undefined, undefined, {title: false,
    bottom: width => {
      const information = `META ${view.reader.position}`;
      return information.length <= width ? [information] : ['META', view.reader.position];
    }});
  view.reader.follow();
  const render = (width: number) => {
    const before = measures, lines = view.render(width);
    assert.equal(measures - before, 1, 'metadata rebudgeting must not rerender the native document');
    assert.equal(lines.length, readingRows(tui));
    assert.match(plain(lines), new RegExp(view.reader.position));
    return lines;
  };
  const first = render(10);
  assert.equal(view.reader.following, true); assert.equal(view.reader.atBottom, true);
  assert.match(plain(first), /BODY 99/);
  const position = view.reader.offset; render(10); assert.equal(view.reader.offset, position);
  view.handleInput('\x1b[H'); render(10); assert.equal(view.reader.offset, 0); assert.equal(view.reader.following, false);
  view.reader.offset = 95; document = document.slice(0, 9); render(10); render(40);
  assert.equal(view.reader.atBottom, true); assert.equal(view.reader.following, false, 'layout clamp cannot resume a paused reader');
  document = Array.from({length: 100}, (_, i) => `BODY ${i}`); render(40);
  assert.equal(view.reader.following, false);
  view.handleInput('\x1b[F'); render(40); assert.equal(view.reader.following, true); assert.equal(view.reader.atBottom, true);
  const replacement = new DetailsView(tui, () => 'new owner', content, () => {}, [], view.reader);
  replacement.render(40);
  const callback = replacement.reader.onScroll;
  view.dispose();
  assert.equal(replacement.reader.onScroll, callback);
  assert.ok(callback);
  replacement.handleInput('\x1b[H'); assert.equal(replacement.reader.offset, 0);
  replacement.dispose(); assert.equal(replacement.reader.onScroll, undefined);
});
