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
import { TaskBrowserView } from '../../src/tasks/viewer.ts';
import { terminal } from '../support/terminal.ts';

test('task dock and live browser share committed status; important children keep parents within phone budget', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-ui-')), tui = terminal(), dock = new Dock(), binding = new SessionBinding();
  const ctx = { cwd: root, mode: 'tui', sessionManager: SessionManager.inMemory(root),
    ui: { notify() {}, setWidget(_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) { factory?.(tui); } },
  } as unknown as ExtensionContext;
  const tasks = new TasksModule(binding, dock); binding.bind(ctx); dock.bind(ctx, 6); await tasks.bind(ctx, { reason: 'startup' });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const view = new TaskBrowserView(tui, () => tasks.current(ctx), () => {}, undefined, 'all', refresh => tasks.subscribe(ctx, refresh));
  try {
    await tasks.edit(ctx, [{ op: 'add', title: '中文长标题'.repeat(30), children: ['执行'.repeat(40), '验收'] },
      {op: 'add', title: 'Blocked group', children: ['blocked execution']}, {op: 'add', title: 'Future group', children: ['future execution']}]);
    await tasks.edit(ctx, [{ op: 'start', id: '2' }, {op: 'block', id: '5', reason: 'waiting for server'}]);
    tasks.selectGroup('4');
    for (const width of [40, 60, 120]) {
      const rows = dock.render(width);
      assert.ok(rows.every(row => visibleWidth(row) <= width)); assert.ok(rows.length <= 3);
      const child = rows.findIndex(line => /#5 /.test(line));
      assert.ok(child > 0 && /#4 /.test(rows[child-1]), 'changed child remains visible beside its parent');
      const lines = view.render(width);
      assert.ok(lines.length <= Math.floor(24 * 0.8)); assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    view.handleInput('#2'); view.render(120);
    assert.equal(view.getSelectedItem()?.value, '2');
    view.handleInput('\t'); view.handleInput('\t'); // details focus
    const selected = view.getSelectedItem()?.value;
    await tasks.edit(ctx, [{ op: 'done', id: '2' }, {op: 'done', id: '3'}]);
    assert.equal(view.getSelectedItem()?.value, selected);
    assert.match(view.render(120).join('\n'), /done/);
    t.mock.timers.tick(5001);
    assert.equal(tasks.rows().some(row => row.id === 'task:1'), false);
    assert.ok(tasks.rows().some(row => row.id === 'tasks:finished'));
    await tasks.edit(ctx, [{op: 'unblock', id: '5'}]);
    assert.match(tasks.rows(true)[0].suffix!, /2\/4 · ⟳ 0 · ⚠ 0/);
    dock.setAsk(true); assert.equal(dock.render(40).length, 1);
  } finally { view.dispose(); tasks.detach(); binding.revoke(); t.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});
