import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, type TUI } from '@earendil-works/pi-tui';
import { BrowserView, browseState } from '../ui/browser.ts';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { TasksModule } from './index.ts';
import { queryTasks, taskDetails, type TaskFilter } from './query.ts';
import { taskViews } from './model.ts';
import { taskRow, taskStyle } from './presentation.ts';
import type { TaskData, TaskView } from './types.ts';

/** Selection and readers belong to stable task IDs; data stays in the shared store. */
export class TaskBrowserView extends BrowserView {
  constructor(tui: TUI, data: () => TaskData, done: (value?: string) => void, groupId?: string, state: TaskFilter = 'all',
    subscribe?: (refresh: () => void) => () => void, theme?: Theme) {
    const groups = () => taskViews(data()).filter(task => !task.parentId);
    let views = new Map<string, TaskView>();
    super(tui, { title: 'Tasks', state: browseState(), subscribe,
      layout: { truncatePrimary: ({item, text, maxWidth}) => taskStyle(views.get(item.value)!, truncateToWidth(text, maxWidth, ''), theme) },
      controls: [
        { label: 'Group', selected: () => groupId ?? 'all', items: () => [{ value: 'all', label: 'All' },
          ...groups().map(group => ({ value: group.id, label: `${group.id}` }))], select: value => { groupId = value === 'all' ? undefined : value; } },
        { label: 'State', selected: () => state, items: () => [
          { value: 'unfinished', label: 'Unfinished' }, { value: 'doing', label: 'Running' }, { value: 'blocked', label: 'Blocked' },
          { value: 'done', label: 'Completed' }, { value: 'all', label: 'All' }], select: value => { state = value as TaskFilter; } },
      ], items: () => {
        if (groupId && !groups().some(group => group.id === groupId)) groupId = undefined;
        const current = data(); views = new Map(taskViews(current).map(task => [task.id, task]));
        return queryTasks(current, { parentId: groupId, state }).map(task => ({ value: task.id,
          label: taskRow(task),
          description: task.progress ? `${task.progress.done}/${task.progress.total}` : '',
          search: `${task.id} ${task.title} ${task.description ?? ''} ${task.blockedReason ?? ''} ${task.status}`,
          details: () => taskDetails(task, views).join('\n') }));
      } }, done, theme);
  }
}

export function registerTasksCommand(pi: ExtensionAPI, tasks: TasksModule, dock: Dock, notifications: Notifications): void {
  pi.registerCommand('tasks', {
    description: 'Browse tasks: [group ID]; filter group/state, search and read live details',
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1 || words.some(word => !/^[1-9][0-9]*$/.test(word))) throw new Error('Use /tasks [group ID]');
      const groupId = words[0], state = 'all';
      const { data, rows } = await tasks.list(ctx, { parentId: groupId, state });
      tasks.selectGroup(groupId);
      if (ctx.mode !== 'tui') {
        const views = new Map(taskViews(data).map(task => [task.id, task]));
        ctx.ui.notify(rows.map(task => taskDetails(task, views).join('\n')).join('\n\n') || 'No tasks'); return;
      }
      const release = notifications.hold(); dock.setDetail(true);
      try { await showTasks(ctx, tasks, groupId, state); }
      finally { dock.setDetail(false); release(); }
    },
  });
}
async function showTasks(ctx: ExtensionContext, tasks: TasksModule, groupId: string | undefined, state: TaskFilter): Promise<void> {
  const selected = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) =>
    new TaskBrowserView(tui, () => tasks.current(ctx), done, groupId, state, refresh => tasks.subscribe(ctx, refresh), theme));
  if (selected) { const task = taskViews(tasks.current(ctx)).find(task => task.id === selected); tasks.selectGroup(task?.parentId ?? task?.id); }
}
