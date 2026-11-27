import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { Dock } from '../../src/ui/dock.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { TasksModule, taskPath } from '../../src/tasks/index.ts';
import { TaskStore } from '../../src/tasks/store.ts';
import { TaskBrowserView, showTask, showTasks } from '../../src/tasks/viewer.ts';
import { registerTasksCommand } from '../../src/tasks/commands.ts';
import type { Notifications } from '../../src/runtime/notifications.ts';
import { terminal } from '../support/terminal.ts';
import { displayText } from '../../src/ui/browser-chrome.ts';

test('task dock and live browser share committed status; important children keep parents within phone budget', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-ui-')), tui = terminal(), dock = new Dock(), binding = new SessionBinding();
  const ctx = { cwd: root, mode: 'tui', sessionManager: SessionManager.inMemory(root),
    ui: { onTerminalInput() { return () => {}; }, getEditorText: () => '', theme: {fg: (_tone: string, text: string) => text}, notify() {}, setWidget(_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) { factory?.(tui); } },
  } as unknown as ExtensionContext;
  const tasks = new TasksModule(binding, dock); binding.bind(ctx); dock.bind(ctx, 6); await tasks.bind(ctx, { reason: 'startup' });
  // Dock row keys carry the source generation; compare logical IDs.
  const rows = () => tasks.rows().map(row => ({...row, id: row.id.replace(/^task:[^:]+:/, 'task:'),
    ...row.parentId ? {parentId: row.parentId.replace(/^task:[^:]+:/, 'task:')} : {}}));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const view = new TaskBrowserView(tui, () => tasks.current(ctx), () => {}, undefined, 'all', refresh => tasks.subscribe(ctx, refresh));
  try {
    const empty = view.render(120).map(stripVTControlCharacters);
    for (const hint of ['g group', 's state', '/ filter', 'Tab details', 'Esc close']) assert.ok(empty.at(-3)!.includes(hint));
    assert.match(empty.at(-2)!, /No tasks · press s for Unfinished/);
    await tasks.edit(ctx, [{ op: 'add', title: '中文长标题'.repeat(30), children: ['执行'.repeat(40), '验收'] },
      {op: 'add', title: 'Blocked group', children: ['blocked execution']}, {op: 'add', title: 'Future group', children: ['future execution']}], tasks.current(ctx).generation);
    await tasks.edit(ctx, [{ op: 'start', id: '1.1' }, {op: 'block', id: '2.1', reason: 'waiting for server'}], tasks.current(ctx).generation);
    t.mock.timers.tick(1);
    await tasks.edit(ctx, [{op: 'start', id: '1.2'}], tasks.current(ctx).generation);
    tasks.selectGroup('2');
    assert.deepEqual(rows().map(row => row.id), ['task:1', 'task:2', 'task:2.1', 'task:3'],
      'the selected blocked group keeps its place in ID order');
    for (const width of [40, 60, 120]) {
      const rows = dock.render(width);
      assert.ok(rows.every(row => visibleWidth(row) <= width)); assert.ok(rows.length <= dock.budget());
      const child = rows.findIndex(line => /2\.1 /.test(line));
      assert.ok(child > 0 && /2 /.test(rows[child-1]), 'changed child remains visible beside its parent');
      const lines = view.render(width);
      assert.ok(lines.length <= Math.floor(24 * 0.8)); assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    view.handleInput('/'); view.handleInput('1.1'); view.handleInput('\r'); view.render(120);
    assert.match(view.getSelectedItem()!.value, /:1\.1$/);
    view.handleInput('\t'); // details focus
    const selected = view.getSelectedItem()?.value;
    await tasks.edit(ctx, [{ op: 'done', id: '1.1' }, {op: 'done', id: '1.2'}], tasks.current(ctx).generation);
    assert.equal(view.getSelectedItem()?.value, selected);
    assert.match(view.render(120).join('\n'), /done/);
    t.mock.timers.tick(5001);
    assert.equal(rows().some(row => row.id === 'task:1'), false);
    assert.ok(dock.render(80).some(row => row.includes('1 completed groups')));
    await tasks.edit(ctx, [{op: 'unblock', id: '2.1'}], tasks.current(ctx).generation);
    assert.deepEqual(rows().map(row => row.id), ['task:2', 'task:2.1', 'task:3'], 'only the selected group stays expanded');
    assert.match(displayText(tasks.rows()[0].suffix!), /0\/1/);
    dock.setAsk(true); assert.equal(dock.render(40).length, 0); dock.setAsk(false);
    await tasks.edit(ctx, [{op: 'done', id: '2.1'}, {op: 'done', id: '3.1'}], tasks.current(ctx).generation);
    t.mock.timers.tick(5001);
    assert.deepEqual(dock.render(80), [], 'all-complete feedback expires');
    assert.deepEqual(tasks.current(ctx).tasks, [], 'all-complete lists are cleared instead of retaining finished work');
  } finally { view.dispose(); tasks.detach(); binding.revoke(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});

test('persisted fork reads the actual source header without repair; source errors never seed empty success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-source-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), sourceCwd = join(root, 'source\u2028workspace\u2029directory');
  const sourcePath = taskPath(sourceCwd, 'source'), writer = new TaskStore(sourcePath);
  const sourceFile = join(root, 'source.jsonl'), notices: string[] = [];
  try {
    await writer.edit([{ op: 'add', title: 'source', children: ['child'] }], writer.current.generation);
    const header = JSON.stringify({ type: 'session', id: 'source', cwd: sourceCwd });
    writeFileSync(sourceFile, header); // No trailing newline: read-only lookup must not repair it.
    const target = taskContext(root, 'target', text => notices.push(text));
    binding.bind(target); await tasks.bind(target, { reason: 'fork', previousSessionFile: sourceFile });
    const strip = ({generation: _generation, ...data}: {generation?: string}) => data;
    assert.deepEqual(strip(tasks.current(target)), strip(await writer.snapshot()), 'use header cwd/ID, not the target workspace');
    assert.notEqual(tasks.current(target).generation, (await writer.snapshot()).generation, 'the fork list has its own generation');
    assert.equal(readFileSync(sourceFile, 'utf8'), header);
    await tasks.edit(target, [{ op: 'add', title: 'target only' }], tasks.current(target).generation);
    const edited = await tasks.scope(target).snapshot();
    await writer.edit([{ op: 'add', title: 'late source edit' }], writer.current.generation);
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

test('task readers revoke pending imports, snapshot reads and returned selection with their binding', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-reader-')), binding = new SessionBinding(), dock = new Dock();
  const notices: string[] = [], tasks = new TasksModule(binding, dock);
  const a = taskContext(root, 'a', text => notices.push(text)), b = taskContext(root, 'b');
  let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>, opened = 0, released = 0;
  Object.assign(a.ui, {custom: async () => { opened++; return undefined; }});
  const pi = { registerCommand: (_name: string, options: {handler: typeof handler}) => { handler = options.handler; } } as unknown as ExtensionAPI;
  const notifications = { hold: () => {
    // A session replacement queued while import() yields must not open the old UI.
    queueMicrotask(() => binding.bind(b));
    return () => { released++; };
  } } as unknown as Notifications;
  try {
    binding.bind(a); await tasks.bind(a, {reason: 'startup'});
    registerTasksCommand(pi, tasks, dock, notifications, binding);
    await assert.rejects(handler('1 2', a as ExtensionCommandContext), /Use \/tasks/);
    a.mode = 'rpc'; await handler('', a as ExtensionCommandContext);
    assert.deepEqual(notices, ['No tasks']); assert.equal(opened, 0);
    a.mode = 'tui'; await handler('', a as ExtensionCommandContext);
    assert.equal(opened, 0, 'replacement during import cannot mount the old browser');
    assert.equal(released, 1, 'a revoked import still releases notification ownership');

    binding.bind(a); await tasks.bind(a, {reason: 'reload'});
    const generation = tasks.current(a).generation;
    await tasks.edit(a, [{op: 'add', title: 'group', children: ['child']}], generation);
    const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), get = tasks.get.bind(tasks);
    t.mock.method(tasks, 'get', async (...args: Parameters<typeof get>) => {
      const result = await get(...args); entered.resolve(); await gate.promise; return result;
    });
    const pending = showTask(a, tasks, dock, `${generation}:1.1`, binding);
    await entered.promise; binding.bind(b); gate.resolve(); await pending;
    assert.equal(opened, 0, 'a loaded detail cannot mount after its task read loses ownership');

    binding.bind(a); await tasks.bind(a, {reason: 'reload'});
    let selections = 0;
    t.mock.method(tasks, 'selectGroup', () => { selections++; });
    Object.assign(a.ui, {custom: async () => { binding.bind(b); return `${generation}:1.1`; }});
    await showTasks(a, tasks, undefined, 'all', binding);
    assert.equal(selections, 0, 'a closed old reader cannot redirect the replacement Dock selection');
  } finally { tasks.detach(); binding.revoke(); rmSync(root, {recursive: true, force: true}); }
});

const taskContext = (cwd: string, id: string, notify: (message: string, type?: string) => void = () => {}) => ({
  cwd, mode: 'tui', sessionManager: { getSessionId: () => id, getSessionFile: () => 'persisted' },
  ui: { theme: { fg: (_tone: string, text: string) => text }, notify },
}) as unknown as ExtensionContext;

const persistedTasks = (path: string, generation: string, nextId: number, tasks: Record<string, unknown>[]) => {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, JSON.stringify({version: 4, generation, nextId, tasks}));
};
const savedTask = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({id, title, blockedBy: [], jobIds: [], createdAt: 1, updatedAt: 1, ...extra});
const logicalIds = (rows: {id: string}[]) => rows.map(row => row.id.replace(/^task:[^:]+:/, 'task:'));

test('task dock retains the focused group and current child when the height budget shrinks', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-retention-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), ctx = taskContext(root, 'retention');
  const budget = t.mock.method(dock, 'budget', () => 12);
  try {
    persistedTasks(taskPath(root, 'retention'), 'retention-generation', 3, [
      savedTask('1', 'focus group', {nextChild: 7}),
      savedTask('1.1', 'todo before current', {parentId: '1', status: 'todo'}),
      savedTask('1.2', 'older done', {parentId: '1', status: 'done'}),
      savedTask('1.3', 'recent done', {parentId: '1', status: 'done', updatedAt: 2}),
      savedTask('1.4', 'earlier active child', {parentId: '1', status: 'doing'}),
      savedTask('1.5', 'current focus child', {parentId: '1', status: 'doing', updatedAt: 3}),
      savedTask('1.6', 'todo after current', {parentId: '1', status: 'todo'}),
      savedTask('2', 'other group', {nextChild: 8}),
      ...Array.from({length: 6}, (_, index) => savedTask(`2.${index + 1}`, 'done child', {parentId: '2', status: 'done'})),
      savedTask('2.7', 'trailing todo', {parentId: '2', status: 'todo'}),
    ]);
    binding.bind(ctx); await tasks.bind(ctx, {reason: 'startup'});

    assert.deepEqual(logicalIds(tasks.rows()), ['task:1', 'task:1.1', 'task:1.3', 'task:1.4', 'task:1.5', 'task:1.6', 'task:2']);
    budget.mock.mockImplementation(() => 4);
    assert.match(dock.render(80).join('\n'), /├─ .*1 focus group[^\n]*\n│    .*1\.5 current focus child/);
    budget.mock.mockImplementation(() => 3);
    assert.match(dock.render(80)[0], /1\.5 current focus child/);
  } finally { tasks.detach(); binding.revoke(); rmSync(root, {recursive: true, force: true}); }
});

test('task dock caps the expanded group, summarizes overflow, and expands the selected title', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-window-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), ctx = taskContext(root, 'window'), tui = terminal(40, 80);
  let input!: (key: string) => unknown, opened: string | undefined;
  Object.assign(ctx.ui, { getEditorText: () => '', onTerminalInput: (handler: typeof input) => {input = handler; return () => {};},
    setWidget: (_key: string, factory?: (screen: typeof tui) => unknown) => factory?.(tui) });
  dock.setOpen('tasks', id => {opened = id;});
  try {
    persistedTasks(taskPath(root, 'window'), 'window-generation', 8, [
      ...Array.from({length: 7}, (_, index) => savedTask(String(index + 1), `Group ${index + 1}`,
        {nextChild: index === 0 ? 7 : index === 1 ? 10 : 2})),
      ...Array.from({length: 6}, (_, index) => savedTask(`1.${index + 1}`, 'pending work', {parentId: '1', status: 'todo'})),
      ...['todo', 'done', 'todo', 'todo', 'done', 'blocked', 'todo', 'doing', 'todo'].map((status, index) =>
        savedTask(`2.${index + 1}`, 'focused work', {parentId: '2', status, updatedAt: index === 1 ? 2 : 1})),
      ...Array.from({length: 5}, (_, index) => savedTask(`${index + 3}.1`, 'collapsed work', {parentId: String(index + 3), status: 'todo'})),
    ]);
    binding.bind(ctx); dock.bind(ctx, 12); await tasks.bind(ctx, { reason: 'startup' });
    const rows = tasks.rows();
    const screen = () => dock.render(80).map(stripVTControlCharacters).join('\n');
    assert.deepEqual(logicalIds(rows.filter(row => row.selectable !== false)),
      ['task:1', 'task:2', 'task:2.1', 'task:2.2', 'task:2.3', 'task:2.6', 'task:2.8', 'task:2.9', 'task:3', 'task:4', 'task:5']);
    assert.deepEqual(rows.filter(row => row.selectable === false).map(row => [row.parentId !== undefined, row.text]),
      [[true, '… 2 more items'], [false, '… 2 more groups']]);
    assert.equal(rows.at(-1)?.text, '… 2 more groups');
    assert.match(screen(), /2\.9 focused work\n│    … 2 more items/);
    assert.doesNotMatch(screen(), /[↑↕] …/);

    input('\x1b[D'); // The first selectable title is Group 1, not the default focus.
    assert.match(screen(), /│    ☐ 1\.6 pending work/, 'a single otherwise omitted child replaces its hint');
    assert.doesNotMatch(screen(), /2\.\d|more items/);
    input('\x1b[B'); input('\r'); await Promise.resolve();
    assert.equal(opened, 'task:window-generation:1.1', 'down moves from the selected title into its newly visible children');
    assert.match(screen(), /2\.8 focused work/, 'exiting selection restores the default focus');
  } finally { dock.detach(); tasks.detach(); binding.revoke(); rmSync(root, {recursive: true, force: true}); }
});

test('task recovery clears finished lists silently and keeps exactly five seconds of live completion feedback', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-restore-')), binding = new SessionBinding(), dock = new Dock();
  const tasks = new TasksModule(binding, dock), frames: string[][] = [];
  dock.invalidate = () => { frames.push(tasks.rows().map(row => row.text)); };
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  try {
    // A finished list can only reach the file from an older build: live edits clear it in
    // the same commit, so recovery is the only path that still has to clean it up.
    const donePath = taskPath(root, 'saved'), ctx = taskContext(root, 'saved');
    persistedTasks(donePath, 'saved-generation', 2, [savedTask('1', 'saved done', {nextChild: 2}),
      savedTask('1.1', 'done child', {parentId: '1', status: 'done'})]);
    binding.bind(ctx); await tasks.bind(ctx, { reason: 'startup' });
    assert.ok(frames.every(frame => frame.every(text => !text.includes('☑'))), 'cold all-done data never publishes completion feedback');
    assert.deepEqual(tasks.current(ctx).tasks, [], 'cold all-done data is cleaned instead of retained');
    assert.equal(JSON.parse(readFileSync(donePath, 'utf8')).resetReason, 'completed');
    assert.equal((await tasks.list(ctx, {state: 'all'})).rows.length, 0);

    const mixed = taskContext(root, 'mixed'), mixedPath = taskPath(root, 'mixed');
    persistedTasks(mixedPath, 'mixed-generation', 3, [savedTask('1', 'saved done', {nextChild: 2}),
      savedTask('1.1', 'done child', {parentId: '1', status: 'done'}),
      savedTask('2', 'pending group', {nextChild: 2}), savedTask('2.1', 'pending child', {parentId: '2', status: 'todo'})]);
    frames.length = 0; binding.bind(mixed); await tasks.bind(mixed, { reason: 'startup' });
    assert.deepEqual(logicalIds(tasks.rows()), ['task:2', 'task:2.1'], 'cold mixed data never shows the historical done group');
    assert.ok(frames.every(frame => frame.every(text => !text.includes('☑'))), 'cold recovery never replays historical completion');

    const store = tasks.scope(mixed), snapshot = store.snapshot.bind(store);
    let loaded = false;
    const loading = t.mock.method(store, 'snapshot', async () => {
      await snapshot();
      if (loaded) return store.current;
      loaded = true;
      // Real commits during snapshot loading publish more than one update; none of them is live work.
      await store.edit([{op: 'add', title: 'later group', children: ['later child']}], store.current.generation);
      await store.edit([{op: 'done', id: '2.1'}], store.current.generation);
      return store.current;
    });
    frames.length = 0; binding.bind(mixed); await tasks.bind(mixed, { reason: 'reload' }); loading.mock.restore();
    assert.ok(frames.every(frame => frame.every(text => !text.includes('☑'))), 'recovery publications never become live feedback');
    assert.deepEqual(logicalIds(tasks.rows()), ['task:3', 'task:3.1']);

    const external = new TaskStore(mixedPath);
    await external.snapshot();
    await external.edit([{op: 'done', id: '3.1'}], external.current.generation); await store.snapshot();
    assert.ok(tasks.rows().some(row => row.text.includes('☑')), 'live completion shows its just-finished list');
    t.mock.timers.tick(4999); assert.ok(tasks.rows().length > 0);
    t.mock.timers.tick(1); assert.deepEqual(tasks.rows(), []);
    assert.deepEqual(tasks.current(mixed).tasks, [], 'the cleared list is gone, not merely hidden');
    const sourceFile = join(root, 'mixed.jsonl');
    writeFileSync(sourceFile, `${JSON.stringify({type: 'session', id: 'mixed', cwd: root})}\n`);
    for (const reason of ['reload', 'resume', 'fork'] as const) {
      const restored = reason === 'fork' ? taskContext(root, 'fork') : mixed;
      if (reason === 'fork') tasks.detach();
      frames.length = 0; binding.bind(restored); await tasks.bind(restored, { reason, previousSessionFile: reason === 'fork' ? sourceFile : undefined });
      assert.ok(frames.every(frame => frame.every(text => !text.includes('☑'))), `${reason} cannot replay completion feedback`);
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
    // A pending sibling keeps the list alive: an all-done list is cleared by the same commit.
    await tasks.edit(a, [{ op: 'add', title: 'old', children: ['old child', 'old pending'] }, { op: 'done', id: '1.1' }], tasks.current(a).generation);
    binding.bind(b); await tasks.bind(b, { reason: 'resume' });
    await tasks.edit(b, [{ op: 'add', title: 'new', children: ['new child', 'new pending'] }, { op: 'done', id: '1.1' }], tasks.current(b).generation);
    const previousTimer = oldTimer, obsoleteRefresh = oldRefresh, before = renders;
    obsoleteRefresh(); oldError(new Error('obsolete watcher')); gate.resolve(); await pending; delayed.mock.restore();
    assert.equal(renders, before); assert.equal(notices.length, 0);
    assert.match(tasks.rows()[0].text, /new/);

    binding.bind(a); await tasks.bind(a, { reason: 'reload' });
    assert.deepEqual(logicalIds(tasks.rows()), ['task:1', 'task:1.1', 'task:1.2']);
    const currentRenders = renders; previousTimer(); obsoleteRefresh();
    assert.equal(renders, currentRenders, 'obsolete callbacks cannot touch a replacement, even when returning to the same store');
    tasks.detach();
    const detachedRenders = renders; oldRefresh(); oldTimer();
    assert.equal(renders, detachedRenders, 'detach releases UI ownership without changing captured stores');

    const broken = taskContext(root, 'broken', text => notices.push(text));
    writeFileSync(taskPath(root, 'broken'), '{invalid');
    binding.bind(broken); await tasks.bind(broken, { reason: 'resume' });
    assert.equal(notices.length, 1); assert.match(notices[0], /TASK_STORE_INVALID|current state is retained/);
    assert.equal(tasks.current(broken).tasks.length, 0);
    // Repairing storage does not retroactively turn failed initialization into a live baseline.
    persistedTasks(taskPath(root, 'broken'), 'repaired', 2, [savedTask('1', 'repaired', {nextChild: 2}),
      savedTask('1.1', 'repaired child', {parentId: '1', status: 'todo'})]);
    await tasks.scope(broken).snapshot();
    assert.deepEqual(logicalIds(tasks.rows()), ['task:1', 'task:1.1']);
    assert.ok(tasks.rows().every(row => !row.text.includes('☑')), 'recovered data never fabricates completion');
  } finally { gate.resolve(); tasks.detach(); binding.revoke(); timeouts.mock.restore(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});
