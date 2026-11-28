import { toolRenderers, type ToolExpandedRow, type ToolLine } from '../ui/tool-render.ts';
import type { StructuredDetails } from '../ui/structured-details.ts';
import { taskIcon, taskTone, taskHeading, receiptAction, receiptDisplay } from './presentation.ts';
import type { EditResult, TaskView } from './types.ts';

function line(task: Pick<TaskView, 'id' | 'title' | 'parentId' | 'status'>): ToolLine {
  return { icon: taskIcon(task.status), title: taskHeading(task),
    tone: taskTone(task.status), titleTone: taskTone(task.status),
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
  expanded: ({ tasks, nextCursor }) => [
    ...tasks.map(task => ({ ...line(task), meta: task.progress ? [`${task.progress.done}/${task.progress.total}`] : [] })),
    ...nextCursor ? [{ label: 'more', value: 'next page available', tone: 'warning' as const }] : [], ...tasks.length ? [] : ['No tasks'],
  ],
});
export const getRenderers = toolRenderers<{ id: string }, { task: TaskView; generation: string; view?: StructuredDetails }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Task' }),
  collapsed: ({ task }) => ({ ...line(task), meta: task.progress ? [`${task.progress.done}/${task.progress.total}`] : [] }),
  // Saved tool results without detail rows still have the original receipt text.
  expanded: ({ generation, view }, _args, text) => view ? [{ label: 'generation', value: generation },
    ...view.rows.flatMap<ToolExpandedRow>(row => {
      if (typeof row === 'string') return [row];
      if (!row || !('length' in row)) return [];
      const [head, ...rest] = row;
      return head?.role === 'label'
        ? [{ label: head.text.trimEnd().replace(/:$/, ''), value: rest.map(part => part.text).join('') }]
        : [row.map(part => part.text).join('')];
    })] : [text],
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
  expanded: data => [
    ...data.changes.map(change => ({ ...line({ ...change, status: change.after ?? change.before ?? 'todo' }),
      summary: receiptDisplay(change).slice(receiptDisplay(change).indexOf(' · ') + 3) })),
    ...data.derived.map(change => ({ ...line(change), summary: change.status === 'blocked' ? 'blocked' : 'dependencies cleared' })),
    ...data.changes.flatMap(change => Object.entries(change.fields ?? {}).map(([key, value]) => ({ label: `fields ${change.id} ${key}`, value: String(value) }))),
    ...data.progress.map(group => ({ label: `group ${group.id}`, value: `${group.done}/${group.total} ${group.status}`, tone: taskTone(group.status) })),
    ...data.warnings.map(warning => ({ label: 'warning', value: warning, tone: 'warning' as const })),
  ],
});
