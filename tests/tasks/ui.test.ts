import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { Dock } from '../../src/ui/dock.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { TasksModule } from '../../src/tasks/index.ts';
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
