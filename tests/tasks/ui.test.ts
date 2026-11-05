import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { Dock } from '../../src/ui/dock.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { TasksModule } from '../../src/tasks/index.ts';
import { TaskDetailsView } from '../../src/tasks/viewer.ts';
import { terminal } from '../support/terminal.ts';

test('shared dock keeps group progress at phone widths; completion feedback and child edits never move an open reader', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-ui-')), tui = terminal(), dock = new Dock(), binding = new SessionBinding();
  const ctx = { cwd: root, mode: 'tui', sessionManager: SessionManager.inMemory(root),
    ui: { notify() {}, setWidget(_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) { factory?.(tui); } },
  } as unknown as ExtensionContext;
  const tasks = new TasksModule(binding, dock); binding.bind(ctx); dock.bind(ctx, 6); await tasks.bind(ctx, { reason: 'startup' });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  try {
    await tasks.edit(ctx, [{ op: 'add', title: '中文长标题'.repeat(30), children: ['执行'.repeat(40), '验收'] }]);
    await tasks.edit(ctx, [{ op: 'update', id: '2', status: 'doing' }]);
    for (const width of [40, 60, 120]) {
      const rows = dock.render(width);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      assert.ok(rows[0].includes('0/2 doing')); assert.ok(rows.length <= 3);
    }
    await tasks.edit(ctx, [{op: 'add', title: 'Blocked group', children: ['blocked execution']},
      {op: 'add', title: 'Future group', children: ['future execution']}]);
    await tasks.edit(ctx, [{op: 'update', id: '5', blockedBy: ['2']}]);
    assert.ok(tasks.rows().find(row => row.id === 'task:4')!.priority > tasks.rows().find(row => row.id === 'task:6')!.priority);
    tasks.selectGroup('4');
    await tasks.edit(ctx, [{op: 'update', id: '7', description: 'newest change does not move the selected group'}]);
    const compact = tasks.rows(true);
    assert.equal(compact.length, 1); assert.equal(compact[0].suffix, '0/4 · doing 1 · blocked 1');
    assert.equal(tasks.rows().find(row => row.id === 'task:5')!.parentId, 'task:4');
    assert.match(dock.render(40)[0], /^> #4/);
    assert.ok(dock.render(40).every(line => !/^  [▶!] #/.test(line)), 'all three roots fit before any child expands');
    Object.defineProperty(tui.terminal, 'rows', {value: 40, configurable: true});
    const expanded = dock.render(40), parentAt = expanded.findIndex(line => line.startsWith('> #4'));
    assert.ok(expanded[parentAt + 1].includes('! #5'), 'blocked child stays adjacent to its selected parent');
    Object.defineProperty(tui.terminal, 'rows', {value: 24, configurable: true});
    const { data } = await tasks.list(ctx, { includeDone: true });
    const view = new TaskDetailsView(tui, data, () => {}, undefined, true);
    for (const width of [40, 60, 120]) {
      const lines = view.render(width);
      assert.ok(lines.length <= Math.floor(24 * 0.8)); assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    view.handleInput('/'); view.handleInput('验收');
    await tasks.edit(ctx, [{ op: 'update', id: '2', status: 'done' }, { op: 'update', id: '3', status: 'done' }]);
    t.mock.timers.tick(5001);
    assert.equal(tasks.rows().some(row => row.id === 'task:1'), false);
    assert.ok(tasks.rows().some(row => row.id === 'tasks:finished'));
    assert.equal(view.reader.search.getValue(), '验收'); assert.equal(view.reader.searching, true);
    assert.ok(view.render(120).join('\n').includes('doing'), 'the open snapshot never changes due to completion feedback');
    view.handleInput('\x1b'); view.actions[0].run();
    assert.ok(!view.render(120).join('\n').includes('#2'));
    await tasks.edit(ctx, [{ op: 'update', id: '3', status: 'todo' }]);
    assert.ok(tasks.rows().find(row => row.id === 'task:1')?.suffix?.includes('1/2 todo'));
    dock.setAsk(true);
    assert.equal(dock.render(40).length, 1); assert.ok(dock.render(40)[0].includes('Tasks'));
    assert.ok(dock.render(40)[0].includes('1/4 · doing 0 · blocked 0'));
  } finally { tasks.detach(); binding.revoke(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});
