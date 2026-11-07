import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { registerBoundTool, checkedArguments, LIST_LIMITS, paginate, textResult } from '../runtime/tools.ts';
import { boundedText } from '../runtime/read.ts';
import type { TasksModule } from './index.ts';
import { taskId, taskScope, groupId, type TaskScope, type TaskView } from './types.ts';
import { taskDetails, taskLabel, type TaskFilter } from './query.ts';
import { taskViews } from './model.ts';
import { editSchema, editArguments, editChanges } from './schema.ts';
import { editLines } from './presentation.ts';

import { listRenderers, getRenderers, editRenderers } from './render.ts';

const listSchema = Type.Object({ groupId: Type.Optional(groupId),
  state: Type.Optional(Type.Union([Type.Literal('unfinished'), Type.Literal('doing'), Type.Literal('blocked'), Type.Literal('done'), Type.Literal('all')])),
  cursor: Type.Optional(Type.String({ maxLength: 200 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMITS.maxLimit })) }, { additionalProperties: false });
const getSchema = Type.Object({ id: taskId, scope: Type.Optional(taskScope) }, { additionalProperties: false });
const queryHint = 'List a group: task_list({"groupId":"1","state":"all"}); one task: task_get({"id":"1.2"}).';

export function registerTaskTools(pi: ExtensionAPI, tasks: TasksModule): void {
  const scopeHint = tasks.scopeHint;
  // Assignment is fixed at admission. Omit drops object options; retain strict validation.
  const getParameters = scopeHint ? getSchema : Type.Omit(getSchema, ['scope'], { additionalProperties: false });
  const editParameters = scopeHint ? editSchema : Type.Omit(editSchema, ['scope'], { additionalProperties: false });
  registerBoundTool(pi, { name: 'task_list', label: 'Tasks', description: 'List unfinished tasks (default), optionally filter groupId/state and page with cursor/limit. Group counts include all children. One task detail uses task_get({id}).' + scopeHint,
    parameters: listSchema, prepareArguments: checkedArguments(listSchema, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      const { rows, data } = await tasks.list(ctx, { parentId: params.groupId, state: params.state as TaskFilter | undefined });
      const views = new Map(taskViews(data).map(task => [task.id, task]));
      const label = (task: TaskView) => taskLabel({ ...task, title: boundedText(task.title, 200) });
      const { page, nextCursor } = paginate(rows, task => {
        const group = views.get(task.parentId ?? task.id)!;
        return { createdAt: new Date(group.createdAt).toISOString(), id: `${group.id.padStart(16, '0')}:${(task.parentId ? task.id.split('.')[1]! : '0').padStart(16, '0')}` };
      }, params.cursor, params.limit ?? LIST_LIMITS.defaultLimit, { oldest: true, budgetBytes: LIST_LIMITS.defaultBytes - 512,
        size: task => Buffer.byteLength(label(task)) + Buffer.byteLength(boundedText(task.blockedReason ?? '', 200))
          + (task.parentId ? Buffer.byteLength(label(views.get(task.parentId)!)) : 0) + 80 });
      // A page may start mid-group. Reinsert organization context without advancing its cursor.
      const shown = new Map<string, TaskView>();
      for (const task of page) { if (task.parentId) shown.set(task.parentId, views.get(task.parentId)!); shown.set(task.id, task); }
      const more = nextCursor ? `more: task_list(${JSON.stringify({ ...params, cursor: nextCursor })})` : undefined;
      return textResult([`tasks ${page.length}/${rows.length} ${params.state ?? 'unfinished'}${params.groupId ? ` group ${params.groupId}` : ''}`,
        ...[...shown.values()].map(task => `${label(task)}${task.blockedReason ? ` · ${boundedText(task.blockedReason, 200)}` : ''}`), more],
      { tasks: [...shown.values()], nextCursor });
    },
    ...listRenderers,
  }, 'initial');
  registerBoundTool(pi, { name: 'task_get', label: 'Task', description: 'Get one group or child by id, with description, blockers and execution references. A group does not expand its children; use task_list({groupId}) for them.' + scopeHint,
    parameters: getParameters, prepareArguments: checkedArguments(getParameters, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      const scope = (params as { scope?: TaskScope }).scope;
      const { task, views } = await tasks.get(ctx, params.id, scope);
      return textResult([scope === 'assigned' ? `assigned task ${params.id} (parent list)` : undefined, ...taskDetails(task, views)], { task });
    },
    ...getRenderers,
  }, 'initial');
  registerBoundTool(pi, { name: 'task_edit', label: 'Tasks',
    description: 'Update progress with {op:"start"|"done"|"block"|"unblock",id}; block accepts reason. add creates a group with children titles, or a child with parentId. Child IDs use group.ordinal, e.g. 1.2. update changes fields; moving requires delete then add; delete needs cascade:true for a nonempty group. Batch: {op:"batch",changes:[operations]}; all or none commit. Multiple tasks may run. Dependencies still block after unblock. Changes never stop jobs/agents or complete goal.' + scopeHint,
    parameters: editParameters, prepareArguments: editArguments,
    async execute(_id, params, signal, _update, ctx) {
      const scope = (params as { scope?: TaskScope }).scope;
      const result = await tasks.edit(ctx, editChanges(params), signal, scope);
      return textResult([scope === 'assigned' ? 'assigned task progress (parent list)' : undefined, ...editLines(result)], result);
    },
    ...editRenderers,
  }, 'initial');
}
