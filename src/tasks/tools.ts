import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { registerBoundTool, checkedArguments, LIST_LIMITS, paginate, textResult } from '../runtime/tools.ts';
import { boundedText } from '../runtime/read.ts';
import type { TasksModule } from './index.ts';
import { taskId, taskScope, groupId, generationSchema, type TaskScope, type TaskView } from './types.ts';
import { taskDetails, taskLabel, type TaskFilter } from './query.ts';
import { taskViews } from './model.ts';
import { editSchema, editArguments, editChanges } from './schema.ts';
import { requireGeneration } from './types.ts';
import { editLines } from './presentation.ts';

import { listRenderers, getRenderers, editRenderers } from './render.ts';

const listSchema = Type.Object({ generation: Type.Optional(generationSchema), groupId: Type.Optional(groupId),
  state: Type.Optional(Type.Union([Type.Literal('unfinished'), Type.Literal('doing'), Type.Literal('blocked'), Type.Literal('done'), Type.Literal('all')])),
  cursor: Type.Optional(Type.String({ maxLength: 200 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMITS.maxLimit })) }, { additionalProperties: false });
const getSchema = Type.Object({ generation: generationSchema, id: taskId, scope: Type.Optional(taskScope) }, { additionalProperties: false });
const queryHint = 'Get the local generation with task_list({}). Pass the source generation with groupId, cursor, or id.';

export function registerTaskTools(pi: ExtensionAPI, tasks: TasksModule): void {
  const scopeHint = tasks.scopeHint;
  // Assignment is fixed at admission. Omit drops object options; retain strict validation.
  const getParameters = scopeHint ? getSchema : Type.Omit(getSchema, ['scope'], { additionalProperties: false });
  const editParameters = scopeHint ? editSchema : Type.Omit(editSchema, ['scope'], { additionalProperties: false });
  registerBoundTool(pi, { name: 'task_list', label: 'Tasks', description: 'List tasks by group and state (default: unfinished); page with cursor and limit. Call task_list({}) for the local generation. Pass the source generation with groupId or cursor. Group counts include all children. For one task, use task_get.' + scopeHint,
    parameters: listSchema, prepareArguments: checkedArguments(listSchema, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.groupId || params.cursor) requireGeneration(params.generation);
      const { rows, data } = await tasks.list(ctx, { parentId: params.groupId, state: params.state as TaskFilter | undefined }, params.generation);
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
      const more = nextCursor ? `more: task_list(${JSON.stringify({ ...params, generation: data.generation, cursor: nextCursor })})` : undefined;
      return textResult([`generation: ${data.generation}`, `tasks ${page.length}/${rows.length} ${params.state ?? 'unfinished'}${params.groupId ? ` group ${params.groupId}` : ''}`,
        ...[...shown.values()].map(task => `${label(task)}${task.blockedReason ? ` · ${boundedText(task.blockedReason, 200)}` : ''}`), more],
      { tasks: [...shown.values()], generation: data.generation, nextCursor });
    },
    ...listRenderers,
  }, 'initial');
  registerBoundTool(pi, { name: 'task_get', label: 'Task', description: 'Read one group or child, including description, blockers and execution links. A group read does not list its children; call task_list with groupId and generation.' + scopeHint,
    parameters: getParameters, prepareArguments: checkedArguments(getParameters, queryHint),
    async execute(_id, params, _signal, _update, ctx) {
      const scope = (params as { scope?: TaskScope }).scope;
      const { task, views } = await tasks.get(ctx, params.id, params.generation, scope);
      return textResult([`generation: ${params.generation}`, scope === 'assigned' ? `assigned task ${params.id} (parent list)` : undefined, ...taskDetails(task, views)], { task, generation: params.generation });
    },
    ...getRenderers,
  }, 'initial');
  registerBoundTool(pi, { name: 'task_edit', label: 'Tasks',
    description: 'Use the source generation from task_list({}) for local edits. Add a group with optional children titles (no status), or a child with parentId (no children). Use start/done/block/unblock with a child ID such as 1.2; block accepts reason. Multiple children may be doing. Unblock does not remove dependencies. Update fields; to move, delete then add. Deleting a group with children requires cascade:true. Batch changes commit all or none. Use top-level clear, not in a batch or assigned scope, to delete the whole local list with its dependencies and execution links and restart numbering at 1; a nonempty list also clears when all tasks are done. IDs may be reused after a clear, under a new generation. Edits do not stop executions or complete the goal.' + scopeHint,
    parameters: editParameters, prepareArguments: editArguments,
    async execute(_id, params, signal, _update, ctx) {
      const scope = (params as { scope?: TaskScope }).scope;
      const result = await tasks.edit(ctx, editChanges(params), params.generation, signal, scope);
      return textResult([`generation: ${result.generation}`, scope === 'assigned' ? 'assigned task progress (parent list)' : undefined,
        result.cleared ? `tasks cleared (${result.cleared}); numbering restarts at 1, old references expired` : undefined, ...editLines(result)], result);
    },
    ...editRenderers,
  }, 'initial');
}
