import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../runtime/binding.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { Dock } from '../ui/dock.ts';
import type { TasksModule } from './index.ts';
import { taskViews } from './model.ts';
import { taskDetails } from './query.ts';

/** Register immediately; only an interactive invocation needs the browser stack. */
export function registerTasksCommand(pi: ExtensionAPI, tasks: TasksModule, dock: Dock, notifications: Notifications,
  binding: SessionBinding): void {
  pi.registerCommand('tasks', {
    description: 'Browse tasks: [group ID]; filter group/state, search and read live details',
    handler: async (args, ctx) => {
      const current = binding.current;
      if (!current) return;
      const active = () => binding.isCurrent(current) && !ctx.signal?.aborted;
      const words = args.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1 || words.some(word => !/^[1-9][0-9]*$/.test(word))) throw new Error('Use /tasks [group ID]');
      const groupId = words[0], state = 'all';
      const generation = (await tasks.scope(ctx).snapshot()).generation;
      if (!active()) return;
      const { data, rows } = await tasks.list(ctx, { parentId: groupId, state }, generation);
      if (!active()) return;
      tasks.selectGroup(groupId);
      if (ctx.mode !== 'tui') {
        const views = new Map(taskViews(data).map(task => [task.id, task]));
        ctx.ui.notify(rows.map(task => taskDetails(task, views).join('\n')).join('\n\n') || 'No tasks'); return;
      }
      const release = notifications.hold();
      try {
        const { showTasks } = await import('./viewer.ts');
        // Imports can outlive reload/tree/new. Do not mount an old reader or
        // clear a replacement binding's Dock when this invocation unwinds.
        if (!active()) return;
        dock.setDetail(true);
        await showTasks(ctx, tasks, groupId, state, binding);
      } finally { if (binding.isCurrent(current)) dock.setDetail(false); release(); }
    },
  });
}
