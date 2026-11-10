import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { Dock } from '../../src/ui/dock.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { TasksModule, taskPath } from '../../src/tasks/index.ts';
import { TaskStore } from '../../src/tasks/store.ts';
import { TaskBrowserView } from '../../src/tasks/viewer.ts';
import { terminal } from '../support/terminal.ts';
import { displayText } from '../../src/ui/browser-chrome.ts';

test('task dock and live browser share committed status; important children keep parents within phone budget', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-ui-')), tui = terminal(), dock = new Dock(), binding = new SessionBinding();
  const ctx = { cwd: root, mode: 'tui', sessionManager: SessionManager.inMemory(root),
    ui: { onTerminalInput() { return () => {}; }, getEditorText: () => '', theme: {fg: (_tone: string, text: string) => text}, notify() {}, setWidget(_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) { factory?.(tui); } },
  } as unknown as ExtensionContext;
  const tasks = new TasksModule(binding, dock); binding.bind(ctx); dock.bind(ctx, 6); await tasks.bind(ctx, { reason: 'startup' });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const view = new TaskBrowserView(tui, () => tasks.current(ctx), () => {}, undefined, 'all', refresh => tasks.subscribe(ctx, refresh));
  try {
    const empty = view.render(120).map(stripVTControlCharacters);
    for (const hint of ['g group', 's state', '/ filter', 'Tab details', 'Esc close']) assert.ok(empty.at(-3)!.includes(hint));
    assert.match(empty.at(-2)!, /No tasks · press s for Unfinished/);
    await tasks.edit(ctx, [{ op: 'add', title: '中文长标题'.repeat(30), children: ['执行'.repeat(40), '验收'] },
      {op: 'add', title: 'Blocked group', children: ['blocked execution']}, {op: 'add', title: 'Future group', children: ['future execution']}]);
    await tasks.edit(ctx, [{ op: 'start', id: '1.1' }, {op: 'block', id: '2.1', reason: 'waiting for server'}]);
    t.mock.timers.tick(1);
    await tasks.edit(ctx, [{op: 'start', id: '1.2'}]);
    assert.equal(tasks.rows().filter(row => row.parentId === 'task:1')[0].id, 'task:1.1', 'task ID determines reading order, priority determines retention');
    tasks.selectGroup('2');
    for (const width of [40, 60, 120]) {
      const rows = dock.render(width);
      assert.ok(rows.every(row => visibleWidth(row) <= width)); assert.ok(rows.length <= dock.budget());
      const child = rows.findIndex(line => /2\.1 /.test(line));
      assert.ok(child > 0 && /2 /.test(rows[child-1]), 'changed child remains visible beside its parent');
      const lines = view.render(width);
      assert.ok(lines.length <= Math.floor(24 * 0.8)); assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    view.handleInput('/'); view.handleInput('1.1'); view.handleInput('\r'); view.render(120);
    assert.equal(view.getSelectedItem()?.value, '1.1');
    view.handleInput('\t'); // details focus
    const selected = view.getSelectedItem()?.value;
    await tasks.edit(ctx, [{ op: 'done', id: '1.1' }, {op: 'done', id: '1.2'}]);
    assert.equal(view.getSelectedItem()?.value, selected);
    assert.match(view.render(120).join('\n'), /done/);
    t.mock.timers.tick(5001);
    assert.equal(tasks.rows().some(row => row.id === 'task:1'), false);
    assert.ok(dock.render(80).some(row => row.includes('1 completed groups')));
    await tasks.edit(ctx, [{op: 'unblock', id: '2.1'}]);
    assert.equal(tasks.rows().length, 4, 'all visible groups offer their children for read-only Dock navigation');
    assert.match(displayText(tasks.rows()[0].suffix!), /0\/1/);
    dock.setAsk(true); assert.equal(dock.render(40).length, 0); dock.setAsk(false);
    await tasks.edit(ctx, [{op: 'done', id: '2.1'}, {op: 'done', id: '3.1'}]);
    t.mock.timers.tick(5001);
    assert.deepEqual(dock.render(80), [], 'all-complete feedback expires without deleting task data');
    assert.ok(tasks.current(ctx).tasks.length > 0);
  } finally { view.dispose(); tasks.detach(); binding.revoke(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});

test('persisted fork reads the actual source header without repair; source errors never seed empty success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-source-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), sourceCwd = join(root, 'source\u2028workspace\u2029directory');
  const sourcePath = taskPath(sourceCwd, 'source'), writer = new TaskStore(sourcePath);
  const sourceFile = join(root, 'source.jsonl'), notices: string[] = [];
  try {
    await writer.edit([{ op: 'add', title: 'source', children: ['child'] }]);
    const header = JSON.stringify({ type: 'session', id: 'source', cwd: sourceCwd });
    writeFileSync(sourceFile, header); // No trailing newline: read-only lookup must not repair it.
    const target = taskContext(root, 'target', text => notices.push(text));
    binding.bind(target); await tasks.bind(target, { reason: 'fork', previousSessionFile: sourceFile });
    assert.deepEqual(tasks.current(target), await writer.snapshot(), 'use header cwd/ID, not the target workspace');
    assert.equal(readFileSync(sourceFile, 'utf8'), header);
    await tasks.edit(target, [{ op: 'add', title: 'target only' }]);
    const edited = await tasks.scope(target).snapshot();
    await writer.edit([{ op: 'add', title: 'late source edit' }]);
    const delimited = `\n${header}\n{not part of the header`;
    writeFileSync(sourceFile, delimited);
    binding.bind(target); await tasks.bind(target, { reason: 'fork', previousSessionFile: sourceFile });
    assert.equal(readFileSync(sourceFile, 'utf8'), delimited, 'LF lookup skips blank lines and leaves trailing history unread');
    assert.deepEqual(tasks.current(target), edited, 'binding a used target cannot overwrite its own edits');
    assert.equal(notices.length, 0);

    const invalidSources = [undefined, '', '{bad', JSON.stringify({ type: 'session', id: 'source' }), header];
    for (const [index, text] of invalidSources.entries()) {
      const file = join(root, `bad-${index}.jsonl`);
      if (text !== undefined) writeFileSync(file, text);
      if (text === header) writeFileSync(sourcePath, '{invalid tasks');
      const ctx = taskContext(root, `bad-${index}`, message => notices.push(message));
      binding.bind(ctx); await tasks.bind(ctx, { reason: 'fork', previousSessionFile: file });
      assert.equal(notices.length, index + 1, 'every source failure reports an explicit error');
      assert.equal(existsSync(taskPath(root, `bad-${index}`)), false, 'failure never commits an empty seed');
      if (text === undefined) assert.equal(existsSync(file), false, 'missing history is not created');
      else assert.equal(readFileSync(file, 'utf8'), text, 'invalid/empty source history is not repaired');
    }
    assert.match(notices.at(-1)!, /TASK_STORE_INVALID|current state is retained/);
    assert.equal(readFileSync(sourcePath, 'utf8'), '{invalid tasks');
  } finally { tasks.detach(); binding.revoke(); rmSync(root, { recursive: true, force: true }); }
});

const taskContext = (cwd: string, id: string, notify: (message: string, type?: string) => void = () => {}) => ({
  cwd, mode: 'tui', sessionManager: { getSessionId: () => id, getSessionFile: () => 'persisted' },
  ui: { theme: { fg: (_tone: string, text: string) => text }, notify },
}) as unknown as ExtensionContext;

test('task recovery suppresses every initial publication; external completion and reopening retain exactly five seconds', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-restore-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), ctx = taskContext(root, 'saved'), writer = new TaskStore(taskPath(root, 'saved'));
  const frames: string[][] = [];
  dock.invalidate = () => { frames.push(tasks.rows().map(row => row.id)); };
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  try {
    await writer.edit([{ op: 'add', title: 'saved done', children: ['done child'] }, { op: 'done', id: '1.1' }]);
    binding.bind(ctx); await tasks.bind(ctx, { reason: 'startup' });
    assert.ok(frames.every(frame => frame.length === 0), 'cold all-done data is hidden from its first published frame');
    assert.equal((await tasks.list(ctx, { state: 'all' })).rows.length, 2, 'All still reads retained done data');

    await writer.edit([{ op: 'add', title: 'saved pending', children: ['pending child'] }]);
    const mixed = taskContext(root, 'mixed'), mixedPath = taskPath(root, 'mixed');
    writeFileSync(mixedPath, JSON.stringify(writer.current));
    const external = new TaskStore(mixedPath);
    frames.length = 0; binding.bind(mixed); await tasks.bind(mixed, { reason: 'startup' });
    assert.ok(frames.every(frame => !frame.includes('task:1')), 'cold mixed data never shows the historical done group');
    assert.deepEqual(tasks.rows().map(row => row.id), ['task:2', 'task:2.1']);
    const store = tasks.scope(mixed), snapshot = store.snapshot.bind(store);
    const loading = t.mock.method(store, 'snapshot', async () => {
      await snapshot();
      // Real commits during snapshot loading publish more than one update. Skipping
      // only the first refresh would mistake the second group's done for live feedback.
      await store.edit([{ op: 'done', id: '2.1' }]);
      await store.edit([{ op: 'add', title: 'remaining pending', children: ['remaining child'] }]);
      return store.current;
    });
    frames.length = 0; binding.bind(mixed); await tasks.bind(mixed, { reason: 'reload' }); loading.mock.restore();
    assert.ok(frames.every(frame => !frame.includes('task:1') && !(frame.includes('task:2') && frame.includes('task:3'))));
    assert.deepEqual(tasks.rows().map(row => row.id), ['task:3', 'task:3.1']);

    await external.edit([{ op: 'done', id: '3.1' }]); await store.snapshot();
    assert.equal(tasks.rows()[0].id, 'task:3');
    t.mock.timers.tick(4000);
    await external.edit([{ op: 'start', id: '3.1' }]); await store.snapshot();
    await external.edit([{ op: 'done', id: '3.1' }]); await store.snapshot();
    t.mock.timers.tick(4999); assert.equal(tasks.rows()[0].id, 'task:3', 'recompletion receives a fresh five seconds');
    t.mock.timers.tick(1); assert.deepEqual(tasks.rows(), []);
    assert.equal(tasks.current(mixed).tasks.length, 6, 'expiry only changes Dock visibility');
    const sourceFile = join(root, 'mixed.jsonl');
    writeFileSync(sourceFile, `${JSON.stringify({ type: 'session', id: 'mixed', cwd: root })}\n`);
    for (const reason of ['reload', 'resume', 'fork'] as const) {
      const restored = reason === 'fork' ? taskContext(root, 'fork') : mixed;
      if (reason === 'fork') tasks.detach();
      frames.length = 0; binding.bind(restored); await tasks.bind(restored, { reason, previousSessionFile: reason === 'fork' ? sourceFile : undefined });
      assert.ok(frames.every(frame => !frame.length), `${reason} cannot replay completion feedback`);
      assert.equal(tasks.current(restored).tasks.length, 6);
    }
  } finally { tasks.detach(); binding.revoke(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});

test('obsolete task snapshots, subscriptions and timers cannot mutate a new binding; failed recovery reports its error', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-fence-')), binding = new SessionBinding(), dock = new Dock();
  const notices: string[] = [], tasks = new TasksModule(binding, dock), a = taskContext(root, 'a', text => notices.push(text)), b = taskContext(root, 'b', text => notices.push(text));
  const store = tasks.scope(a), snapshot = store.snapshot.bind(store), gate = Promise.withResolvers<void>();
  let oldRefresh!: () => void, oldError!: (error: unknown) => void, oldTimer!: () => void, renders = 0;
  dock.invalidate = () => { renders++; };
  const subscribe = store.subscribe.bind(store);
  t.mock.method(store, 'subscribe', (refresh: () => void, error?: (error: unknown) => void) => { oldRefresh = refresh; oldError = error!; return subscribe(refresh, error); });
  const delayed = t.mock.method(store, 'snapshot', async () => { const data = await snapshot(); await gate.promise; return data; });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const schedule = globalThis.setTimeout;
  const timeouts = t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 5000) oldTimer = callback as () => void;
    return schedule(callback, delay, ...args);
  });
  try {
    binding.bind(a); const pending = tasks.bind(a, { reason: 'startup' });
    await tasks.edit(a, [{ op: 'add', title: 'old', children: ['old child'] }, { op: 'done', id: '1.1' }]);
    binding.bind(b); await tasks.bind(b, { reason: 'resume' });
    await tasks.edit(b, [{ op: 'add', title: 'new', children: ['new child'] }, { op: 'done', id: '1.1' }]);
    const previousTimer = oldTimer, obsoleteRefresh = oldRefresh, before = renders;
    obsoleteRefresh(); oldError(new Error('obsolete watcher')); gate.resolve(); await pending; delayed.mock.restore();
    assert.equal(renders, before); assert.equal(notices.length, 0);
    assert.match(tasks.rows()[0].text, /new/);

    binding.bind(a); await tasks.bind(a, { reason: 'reload' });
    assert.deepEqual(tasks.rows(), []);
    await tasks.edit(a, [{ op: 'start', id: '1.1' }]);
    await tasks.edit(a, [{ op: 'done', id: '1.1' }]);
    const currentRenders = renders; previousTimer(); obsoleteRefresh();
    assert.equal(renders, currentRenders, 'obsolete callbacks cannot touch a replacement, even when returning to the same store');
    t.mock.timers.tick(4999); assert.equal(tasks.rows().length, 2);
    t.mock.timers.tick(1); assert.deepEqual(tasks.rows(), []);
    tasks.detach();
    const detachedRenders = renders; oldRefresh(); oldTimer();
    assert.equal(renders, detachedRenders, 'detach releases UI ownership without changing captured stores');

    const broken = taskContext(root, 'broken', text => notices.push(text));
    writeFileSync(taskPath(root, 'broken'), '{invalid');
    binding.bind(broken); await tasks.bind(broken, { reason: 'resume' });
    assert.equal(notices.length, 1); assert.match(notices[0], /TASK_STORE_INVALID|current state is retained/);
    assert.equal(tasks.current(broken).tasks.length, 0);
    // Repairing storage does not retroactively turn failed initialization into a live baseline.
    writeFileSync(taskPath(root, 'broken'), JSON.stringify(tasks.current(a)));
    await tasks.scope(broken).snapshot(); assert.deepEqual(tasks.rows(), []);
  } finally { gate.resolve(); tasks.detach(); binding.revoke(); timeouts.mock.restore(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});
