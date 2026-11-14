import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, type TUI } from '@earendil-works/pi-tui';
import { BrowserView, browseState } from '../ui/browser.ts';
import type { Dock } from '../ui/dock.ts';
import type { SessionBinding } from '../runtime/binding.ts';
import { parseTaskReference, taskReferenceKey, type TasksModule } from './index.ts';
import { checkGeneration } from './types.ts';
import { queryTasks, taskDetails, taskTitle, type TaskFilter } from './query.ts';
import { taskViews } from './model.ts';
import { taskRow } from './presentation.ts';
import type { TaskData, TaskView } from './types.ts';

/** Selection keys include the source generation; numeric IDs are reusable. */
export class TaskBrowserView extends BrowserView {
  constructor(tui: TUI, data: () => TaskData, done: (value?: string) => void, groupId?: string, state: TaskFilter = 'all',
    subscribe?: (refresh: () => void) => () => void, theme?: Theme) {
    let generation = data().generation;
    const current = () => { const value = data(); if (value.generation !== generation) { generation = value.generation; groupId = undefined; } return value; };
    const groups = () => taskViews(current()).filter(task => !task.parentId);
    let views = new Map<string, TaskView>();
    super(tui, { title: 'Tasks', state: browseState(), subscribe,
      total: () => queryTasks(current(), {parentId: groupId, state: 'all'}).length,
      selection: item => ({name: views.get(item.value)!.title, id: views.get(item.value)!.id}),
      layout: { truncatePrimary: ({text, maxWidth}) => truncateToWidth(text, maxWidth, '') },
      controls: [
        { key: 'g', label: 'Group', selected: () => groupId ?? 'all', items: () => [{ value: 'all', label: 'All' },
          ...groups().map(group => ({ value: group.id, label: `${group.id}` }))], select: value => { groupId = value === 'all' ? undefined : value; } },
        { key: 's', label: 'State', selected: () => state, items: () => [
          { value: 'unfinished', label: 'Unfinished' }, { value: 'doing', label: 'Running' }, { value: 'blocked', label: 'Blocked' },
          { value: 'done', label: 'Completed' }, { value: 'all', label: 'All' }], select: value => { state = value as TaskFilter; } },
      ], items: () => {
        if (groupId && !groups().some(group => group.id === groupId)) groupId = undefined;
        const snapshot = current(); views = new Map(taskViews(snapshot).map(task => [taskReferenceKey(snapshot.generation, task.id), task]));
        const byId = new Map([...views.values()].map(task => [task.id, task]));
        return queryTasks(snapshot, { parentId: groupId, state }).map(task => ({ value: taskReferenceKey(snapshot.generation, task.id), status: task.status,
          label: taskRow(task),
          description: task.progress ? `${task.progress.done}/${task.progress.total}` : '',
          search: `${task.id} ${task.title} ${task.description ?? ''} ${task.blockedReason ?? ''} ${task.status}`,
          details: () => taskDetails(task, byId).join('\n') }));
      } }, done, theme);
  }
}

/** Dock opens a read-only task receipt; selection never edits or changes task status. */
export async function showTask(ctx: ExtensionContext, tasks: TasksModule, dock: Dock, reference: string, binding: SessionBinding): Promise<void> {
  const current = binding.current;
  if (!current) return;
  const { id, generation } = parseTaskReference(reference);
  const {task, views} = await tasks.get(ctx, id, generation);
  if (!binding.isCurrent(current) || ctx.signal?.aborted) return;
  const { showDetails } = await import('../ui/details.ts');
  if (!binding.isCurrent(current) || ctx.signal?.aborted) return;
  await showDetails(ctx, dock, `Tasks ▸ ${taskTitle(task)}`, taskDetails(task, views).join('\n'), 'text');
}

export async function showTasks(ctx: ExtensionContext, tasks: TasksModule, groupId: string | undefined, state: TaskFilter,
  binding: SessionBinding): Promise<void> {
  const current = binding.current;
  if (!current) return;
  const selected = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) =>
    new TaskBrowserView(tui, () => tasks.current(ctx), done, groupId, state, refresh => tasks.subscribe(ctx, refresh), theme));
  if (!binding.isCurrent(current) || ctx.signal?.aborted) return;
  if (selected) {
    const { id, generation } = parseTaskReference(selected), data = tasks.current(ctx);
    checkGeneration(data, generation);
    const task = taskViews(data).find(task => task.id === id); tasks.selectGroup(task?.parentId ?? task?.id);
  }
}
