import { toolRenderers, type ToolLine } from '../ui/tool-render.ts';
import { taskRow, taskIcon, taskTone, taskHeading, receiptAction, receiptDisplay, derivedDisplay } from './presentation.ts';
import type { EditResult, TaskView } from './types.ts';

function line(task: Pick<TaskView, 'id' | 'title' | 'parentId' | 'status'>): ToolLine {
  return { icon: taskIcon(task.status), title: taskHeading(task),
    tone: taskTone(task.status),
    strike: task.status === 'done', indent: task.parentId ? 2 : 0 };
}
export const listRenderers = toolRenderers<{ state?: string; groupId?: string }, { tasks: TaskView[]; nextCursor?: string }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Tasks' }),
  collapsed({ tasks, nextCursor }, args) {
    return { icon: '', title: 'Tasks', summary: `${args.state ?? 'unfinished'}${args.groupId ? ` group ${args.groupId}` : ''} · ` +
      `${tasks.filter(task => !task.parentId).length} groups ${tasks.filter(task => task.parentId).length} items · ` +
      `running ${tasks.filter(task => task.status === 'doing').length} · blocked ${tasks.filter(task => task.status === 'blocked').length} · completed ${tasks.filter(task => task.status === 'done').length}`,
      meta: nextCursor ? ['next page available'] : [] };
  },
  expanded: ({ tasks, nextCursor }, _args, _text, theme) => [
    ...tasks.map(task => taskRow(task, theme) + (task.progress ? ` ${task.progress.done}/${task.progress.total}` : '')),
    ...nextCursor ? ['More tasks · next page available'] : [], ...tasks.length ? [] : ['No tasks'],
  ],
});
export const getRenderers = toolRenderers<{ id: string }, { task: TaskView }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Task' }),
  collapsed: ({ task }) => ({ ...line(task), meta: task.progress ? [`${task.progress.done}/${task.progress.total}`] : [] }),
});
export const editRenderers = toolRenderers<unknown, EditResult>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Updating tasks…' }),
  collapsed(data) {
    const single = data.changes.length === 1 ? data.changes[0] : undefined;
    const counts = new Map<string, { groups: number; children: number }>();
    for (const change of data.changes) {
      const action = receiptAction(change), count = counts.get(action) ?? { groups: 0, children: 0 };
      if (change.parentId) count.children++; else count.groups++;
      counts.set(action, count);
    }
    const heading = single ? line({ ...single, status: single.after ?? single.before ?? 'todo' }) : { icon: '', title: 'Tasks' };
    if (single) heading.title += ` · ${receiptAction(single)}${single.fields?.blockedReason ? `: ${single.fields.blockedReason}` : ''}`;
    return { ...heading,
      summary: single ? undefined : [...counts].map(([action, count]) => `${action}${count.groups ? ` ${count.groups} groups` : ''}${count.children ? ` ${count.children} items` : ''}`).join(' · '),
      meta: [...data.derived.length ? [`dependency changes ${data.derived.length}`] : [],
        ...data.warnings.length ? [{ text: `⚠ ${data.warnings.length}`, tone: 'warning' as const }] : []] };
  },
  expanded: (data, _args, _text, theme) => [
    ...data.changes.map(change => {
      const task = { ...change, status: change.after ?? change.before ?? 'todo' };
      return taskRow(task, theme) + receiptDisplay(change).slice(receiptDisplay(change).indexOf(' · '));
    }),
    ...data.derived.map(derivedDisplay),
    ...data.changes.filter(change => change.fields).map(change => `${change.id} ${JSON.stringify(change.fields)}`),
    ...data.progress.map(group => `${group.id} ${group.done}/${group.total} ${group.status}`),
    ...data.warnings.map(warning => theme.fg('warning', `⚠ ${warning}`)),
  ],
});
