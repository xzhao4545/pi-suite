import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { checkedArguments, LIST_LIMITS, paginate, textResult } from '../runtime/tools.ts';
import { boundedText } from '../runtime/read.ts';
import type { TasksModule } from './index.ts';
import { taskId, type EditResult, type TaskView } from './types.ts';
import { taskDetails, taskLabel, type TaskFilter } from './query.ts';
import { taskViews } from './model.ts';
import { editSchema, editArguments, editChanges } from './schema.ts';
import { derivedDisplay, editLines, receiptDisplay, taskDisplay, taskIcon } from './presentation.ts';

const listSchema = Type.Object({ groupId: Type.Optional(taskId),
  state: Type.Optional(Type.Union([Type.Literal('unfinished'), Type.Literal('doing'), Type.Literal('blocked'), Type.Literal('done'), Type.Literal('all')])),
  cursor: Type.Optional(Type.String({ maxLength: 200 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMITS.maxLimit })) }, { additionalProperties: false });
const getSchema = Type.Object({ id: taskId }, { additionalProperties: false });
const queryHint = 'List a group: task_list({"groupId":"1","state":"all"}); one task: task_get({"id":"2"}).';

export function registerTaskTools(pi: ExtensionAPI, tasks: TasksModule): void {
  pi.registerTool({ name: 'task_list', label: 'Tasks', description: 'List unfinished tasks (default), optionally filter groupId/state and page with cursor/limit. Group counts include all children. One task detail uses task_get({id}).',
    parameters: listSchema, prepareArguments: checkedArguments(listSchema, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      const { rows, data } = await tasks.list(ctx, { parentId: params.groupId, state: params.state as TaskFilter | undefined });
      const views = new Map(taskViews(data).map(task => [task.id, task]));
      const label = (task: TaskView) => taskLabel({ ...task, title: boundedText(task.title, 200) });
      const { page, nextCursor } = paginate(rows, task => {
        const group = views.get(task.parentId ?? task.id)!;
        return { createdAt: new Date(group.createdAt).toISOString(), id: `${group.id.padStart(16, '0')}:${(task.parentId ? task.id : '0').padStart(16, '0')}` };
      }, params.cursor, params.limit ?? LIST_LIMITS.defaultLimit, { oldest: true, budgetBytes: LIST_LIMITS.defaultBytes - 512,
        size: task => Buffer.byteLength(label(task)) + Buffer.byteLength(boundedText(task.blockedReason ?? '', 200))
          + (task.parentId ? Buffer.byteLength(label(views.get(task.parentId)!)) : 0) + 80 });
      // A page may start mid-group. Reinsert organization context without advancing its cursor.
      const shown = new Map<string, TaskView>();
      for (const task of page) { if (task.parentId) shown.set(task.parentId, views.get(task.parentId)!); shown.set(task.id, task); }
      const more = nextCursor ? `more: task_list(${JSON.stringify({ ...params, cursor: nextCursor })})` : undefined;
      return textResult([`tasks ${page.length}/${rows.length} ${params.state ?? 'unfinished'}${params.groupId ? ` group #${params.groupId}` : ''}`,
        ...[...shown.values()].map(task => `${label(task)}${task.blockedReason ? ` · ${boundedText(task.blockedReason, 200)}` : ''}`), more],
      { tasks: [...shown.values()], nextCursor });
    },
    renderCall: (_args, _theme, ctx) => ({ invalidate() {}, render: width => ctx.state.finished ? [] : new Text('Tasks', 0, 0).render(width) }),
    renderResult(result, options, theme, ctx) {
      ctx.state.finished = !options.isPartial;
      if (ctx.isError) return new Text(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'), 0, 0);
      const rows = (result.details as { tasks: TaskView[] }).tasks;
      return new Text([...rows.slice(0, options.expanded ? rows.length : 8).map(task => `${task.parentId ? '  ' : ''}${taskDisplay(task, theme)} ${taskIcon(task.status)}${task.progress ? ` ${task.progress.done}/${task.progress.total}` : ''}`),
        ...!options.expanded && rows.length > 8 ? [`… ${rows.length - 8} more · expand`] : [],
        ...(result.details as { nextCursor?: string }).nextCursor ? ['More tasks · next page available'] : []].join('\n') || 'No tasks', 0, 0);
    }, renderShell: 'self',
  });
  pi.registerTool({ name: 'task_get', label: 'Task', description: 'Get one group or child by id, with description, blockers and execution references. A group does not expand its children; use task_list({groupId}) for them.',
    parameters: getSchema, prepareArguments: checkedArguments(getSchema, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      const { rows, data } = await tasks.list(ctx, params), views = new Map(taskViews(data).map(task => [task.id, task]));
      return textResult(taskDetails(rows[0], views), { task: rows[0] });
    },
  });
  pi.registerTool({ name: 'task_edit', label: 'Tasks',
    description: 'Update progress with {op:"start"|"done"|"block"|"unblock",id}; block accepts reason. add creates a group with children titles, or a child with parentId. update changes fields; delete needs cascade:true for a nonempty group. Batch: {op:"batch",changes:[operations]}; all or none commit. Multiple tasks may run. Dependencies still block after unblock. Changes never stop jobs/agents or complete goal.',
    parameters: editSchema, prepareArguments: editArguments,
    async execute(_id, params, signal, _update, ctx) {
      const result = await tasks.edit(ctx, editChanges(params), signal);
      return textResult(editLines(result), result);
    },
    renderShell: 'self',
    renderCall: (_args, _theme, ctx) => ({ invalidate() {}, render: width => ctx.state.finished ? [] : new Text('正在更新任务…', 0, 0).render(width) }),
    renderResult(result, options, _theme, ctx) {
      ctx.state.finished = !options.isPartial;
      if (ctx.isError) return new Text(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'), 0, 0);
      const data = result.details as EditResult, changes = data.changes;
      const lines = [...changes.map(receiptDisplay), ...data.derived.map(derivedDisplay)];
      return new Text([...lines.slice(0, options.expanded ? lines.length : 6),
        ...lines.length > 6 && !options.expanded ? [`… ${lines.length - 6} more changes`] : [],
        ...options.expanded ? changes.filter(change => change.fields).map(change => `#${change.id} ${JSON.stringify(change.fields)}`) : [],
        ...options.expanded ? data.progress.map(group => `#${group.id} ${group.done}/${group.total}`) : [],
        ...data.warnings.map(warning => `⚠ ${warning}`)].join('\n'), 0, 0);
    },
  });
}
