import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { stripVTControlCharacters } from 'node:util';
import { CURSOR_MARKER, visibleWidth } from '@earendil-works/pi-tui';
import { readingRows } from '../../src/ui/reading.ts';
import { TerminalView, type TerminalExit } from '../../src/ui/terminal.ts';
import { TerminalScreen } from '../../src/jobs/terminal/screen.ts';
import { ViewerNavigation } from '../../src/ui/viewer/navigation.ts';
import { JobStore } from '../../src/jobs/store.ts';
import { agentDir, manager, owner, testShell } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';

const theme = {fg: (_color: string, text: string) => text, bold: (text: string) => text} as unknown as Theme;
const keys = {detachKey: 'ctrl+j', returnKey: 'ctrl+k', transferKey: 'ctrl+l'} as const;
async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < end, 'expected PTY output'); await sleep(20); }
}

test('PTY browse has no input side effects; configured input/return/transfer/detach keys preserve manager ownership', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-term-'));
  try {
    const {id} = await jobs.start({command: 'while read line; do echo "got:$line"; done', mode: 'pty', cwd, ...owner}, testShell());
    const source = jobs.terminal(id)!, exits: TerminalExit[] = [], navigation = new ViewerNavigation(), tui = terminal(24, 60);
    let failWrite = false;
    const open = (readonly = false) => new TerminalView(tui, theme, source, keys, {
      title: () => 'Console', readonly, navigation,
      takeControl: () => jobs.takeControl(id),
      write: data => { if (failWrite) throw new Error('PTY input failed'); jobs.write(id, data, {source: 'user', kind: 'keys', sensitive: true}); },
      returnControl: () => jobs.returnControl(id), userControl: () => jobs.userControlled(id),
    }, exit => exits.push(exit));
    const view = open(); view.render(60);
    const checkFooter = (input: boolean) => {
      for (const width of [40, 80, 120]) {
        const rendered = view.render(width), text = stripVTControlCharacters(rendered.join('\n'));
        assert.equal(rendered.length, readingRows(tui)); assert.ok(rendered.every(line => visibleWidth(line) <= width));
        const hints = rendered.slice(-3, -1).map(stripVTControlCharacters).join('\n');
        assert.match(hints, /ctrl\+j leave/);
        if (input) { assert.match(hints, /ctrl\+k return input/); assert.match(hints, /ctrl\+l send screen/); }
        else { assert.match(hints, /Esc back/); assert.match(text, /i input/); assert.doesNotMatch(text, /return input|send screen/); }
        assert.ok(source.rows < readingRows(tui), 'footer rows are not process rows');
      }
    };
    checkFooter(false);
    assert.equal(jobs.userControlled(id), false);
    for (const data of ['\x1b[A', '\x1b[B', 'abc', '\x14']) view.handleInput(data);
    assert.equal(jobs.userControlled(id), false);
    assert.equal(readFileSync(jobs.logPath(jobs.peek(id), 'input'), 'utf8'), '');
    view.handleInput('i'); assert.equal(jobs.userControlled(id), true); checkFooter(true);
    failWrite = true; view.handleInput('unwritten');
    const failed = stripVTControlCharacters(view.render(40).join('\n'));
    assert.match(failed, /PTY input failed/); assert.match(failed, /ctrl\+j leave/);
    failWrite = false;
    for (const key of 'secret\r') view.handleInput(key);
    assert.throws(() => jobs.write(id, 'x\r', {source: 'model', kind: 'text'}), /USER_CONTROL/);
    await until(() => source.getViewportLines().join('\n').includes('got:secret'));
    assert.ok(view.render(60).some(line => line.includes(CURSOR_MARKER)));
    // Left/Esc in input mode are program keys, never browsing-chain close gestures.
    view.handleInput('\x1b[D'); view.handleInput('\x1b[D'); assert.equal(navigation.closed, false);
    view.handleInput('\x0b'); assert.equal(jobs.userControlled(id), false); assert.equal(view.inputMode, false); checkFooter(false);
    jobs.write(id, '\x15model\r', {source: 'model', kind: 'text', text: 'model'});
    await until(() => source.getViewportLines().join('\n').includes('got:model'));
    view.handleInput('i'); view.handleInput('\x0c');
    assert.equal(exits[0].action, 'transfer'); assert.ok(exits[0].screen.some(line => line.includes('got:model')));
    assert.equal(jobs.userControlled(id), false);
    const next = open(); next.handleInput('i'); next.handleInput('\n');
    assert.equal(exits[1].action, 'detach'); assert.equal(jobs.peek(id).state, 'running');
    await until(() => readFileSync(jobs.logPath(jobs.peek(id), 'input'), 'utf8').includes('sensitive'));
    assert.ok(!readFileSync(jobs.logPath(jobs.peek(id), 'input'), 'utf8').includes('secret'));
    const readonly = open(true);
    assert.ok(!readonly.render(60).join('\n').includes('i input'));
    readonly.handleInput('i'); assert.equal(jobs.userControlled(id), false); readonly.dispose();
    const close = open(); close.handleInput('\x1b[D'); close.handleInput('\x1b[D');
    assert.equal(navigation.closed, true); assert.equal(jobs.peek(id).state, 'running');
    await jobs.stop(id);
    assert.ok(!open().render(60).join('\n').includes('i input'));
  } finally { await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); rmSync(cwd, {recursive: true, force: true}); }
});

test('settlement saves bounded xterm normal history, colors/CR/cursor/wide cells; another owner restores without log replay', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), other = manager(root), store = new JobStore(root);
  let restored: TerminalScreen | undefined;
  try {
    const job = await jobs.start({...owner, cwd: root, mode: 'pty', cols: 40, rows: 10,
      command: "for i in {1..1250}; do printf 'line-%s\\n' \"$i\"; done; printf '\\033[31;1m中文\\033[0m\\r终态\\033[3;4Hcursor'; read line"}, testShell());
    const screen = jobs.terminal(job.id)!;
    await until(() => screen.getViewportLines().join('\n').includes('cursor'));
    assert.equal((await store.load(job.workspace, job.id)).terminalSnapshot, undefined, 'no per-frame snapshot writes');
    screen.scroll(8); const paused = screen.getViewportLines().join('\n');
    jobs.write(job.id, 'done\r', {source: 'model', kind: 'text'});
    const settled = await jobs.wait(job.id);
    assert.ok(settled.terminalSnapshot); assert.equal(settled.error, undefined);
    const foreign = await other.get(job.id, job.workspace); assert.equal(foreign.live, false);
    const snapshot = await other.readTerminalSnapshot(foreign.job); assert.ok(snapshot);
    assert.equal(snapshot.cols, 40); assert.equal(snapshot.rows, 10); assert.ok(snapshot.scrollback <= 1000);
    assert.ok(snapshot.data.length < 4 * 1024 * 1024);
    restored = await TerminalScreen.restore(snapshot);
    screen.follow(); assert.deepEqual(restored.getViewportLines(), screen.getViewportLines());
    assert.equal(restored.viewport.cursor.x, snapshot.cursor.x); assert.equal(restored.viewport.cursor.y, snapshot.cursor.y);
    assert.match(restored.getViewportLines({ansi: true}).join('\n'), /\x1b\[/);
    restored.scroll(10); assert.notEqual(restored.getViewportLines().join('\n'), screen.getViewportLines().join('\n'));
    assert.ok(paused.includes('line-'), 'owner still has bounded history after disposal');
    restored.scroll(Number.MAX_SAFE_INTEGER);
    assert.ok(!restored.getViewportLines().some(line => line.includes('line-1 ')), 'snapshot is a bounded suffix, not all history');
    const view = new TerminalView(terminal(24, 60), theme, restored, keys, {
      title: () => 'Saved terminal', readonly: true, write: () => assert.fail('historical input'),
      returnControl: () => {}, userControl: () => false,
    }, () => {});
    for (const width of [40, 60, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
    view.handleInput('f'); assert.equal(restored.following, true); view.dispose();
    await jobs.clear(job.id, job.workspace); await assert.rejects(other.get(job.id, job.workspace), /NOT_FOUND/);
  } finally { restored?.dispose(); await jobs.shutdown(Date.now() + 5000); await other.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});

test('alternate-screen settlement preserves only the true final screen and cursor visibility', {timeout: 10000}, async () => {
  const root = agentDir(), jobs = manager(root);
  let restored: TerminalScreen | undefined;
  try {
    const job = await jobs.start({...owner, cwd: root, mode: 'pty', cols: 30, rows: 8,
      command: "printf 'normal-buffer\\n\\033[?1049h\\033[2J\\033[H\\033[32m中文\\033[0m\\033[3;5Hcursor\\033[?25l'; read line"}, testShell());
    const screen = jobs.terminal(job.id)!;
    await until(() => screen.getViewportLines().join('\n').includes('cursor'));
    jobs.write(job.id, 'end\r', {source: 'model', kind: 'text'});
    const ended = await jobs.wait(job.id), snapshot = await jobs.readTerminalSnapshot(ended); assert.ok(snapshot);
    restored = await TerminalScreen.restore(snapshot);
    assert.equal(snapshot.alternate, true); assert.equal(restored.viewport.alternate, true);
    assert.equal(restored.viewport.cursor.visible, false);
    assert.deepEqual(restored.getViewportLines(), screen.getViewportLines());
    assert.ok(!restored.getViewportLines().join('\n').includes('normal-buffer'));
    assert.ok(!restored.getViewportLines().join('\n').includes('Process exited'), 'viewer status must not corrupt the app screen');
  } finally { restored?.dispose(); await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});
