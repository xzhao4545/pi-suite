import { toolRenderers, type ToolLine } from '../ui/tool-render.ts';
import { taskTitle } from './query.ts';
import { taskRow, taskIcon, receiptAction, receiptDisplay, derivedDisplay } from './presentation.ts';
import type { EditResult, TaskView } from './types.ts';

function line(task: Pick<TaskView, 'id' | 'title' | 'parentId' | 'status'>): ToolLine {
  return { icon: taskIcon(task.status), title: `${task.id} ${taskTitle(task)}`,
    tone: task.status === 'doing' ? 'accent' : task.status === 'blocked' ? 'warning' : task.status === 'done' ? 'dim' : undefined,
    strike: task.status === 'done', indent: task.parentId ? 2 : 0 };
}
export const listRenderers = toolRenderers<{ state?: string; groupId?: string }, { tasks: TaskView[]; nextCursor?: string }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Tasks' }),
  collapsed({ tasks, nextCursor }, args) {
    return { icon: '', title: '任务', summary: `${args.state ?? 'unfinished'}${args.groupId ? ` group ${args.groupId}` : ''} · ` +
      `${tasks.filter(task => !task.parentId).length} 组 ${tasks.filter(task => task.parentId).length} 项 · ` +
      `进行中 ${tasks.filter(task => task.status === 'doing').length} · 阻塞 ${tasks.filter(task => task.status === 'blocked').length} · 完成 ${tasks.filter(task => task.status === 'done').length}`,
      meta: nextCursor ? ['有下一页'] : [] };
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
  call: () => ({ icon: '⟳', tone: 'accent', title: '正在更新任务…' }),
  collapsed(data) {
    const single = data.changes.length === 1 ? data.changes[0] : undefined;
    const counts = new Map<string, { groups: number; children: number }>();
    for (const change of data.changes) {
      const action = receiptAction(change), count = counts.get(action) ?? { groups: 0, children: 0 };
      if (change.parentId) count.children++; else count.groups++;
      counts.set(action, count);
    }
    const heading = single ? line({ ...single, status: single.after ?? single.before ?? 'todo' }) : { icon: '', title: '任务' };
    if (single) heading.title += ` · ${receiptAction(single)}${single.fields?.blockedReason ? `：${single.fields.blockedReason}` : ''}`;
    return { ...heading,
      summary: single ? undefined : [...counts].map(([action, count]) => `${action}${count.groups ? ` ${count.groups} 组` : ''}${count.children ? ` ${count.children} 项` : ''}`).join(' · '),
      meta: [...data.derived.length ? [`依赖变化 ${data.derived.length}`] : [],
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
