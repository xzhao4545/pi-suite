import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { textResult } from '../runtime/tools.ts';
import type { TasksModule } from './index.ts';
import { changeSchema, taskId } from './types.ts';
import { openBlockers, taskDetails, taskLabel } from './query.ts';
import { taskViews } from './model.ts';

export function registerTaskTools(pi: ExtensionAPI, tasks: TasksModule): void {
  pi.registerTool({
    name: 'task_list', label: 'List Tasks',
    description: 'Query this session\'s two-level task list. Default: unfinished groups and children; group progress always counts all children. id views one task even if done; parentId views one group and its children. id and parentId are exclusive. includeDone shows completed tasks; detail includes descriptions, open blockers and execution references.',
    parameters: Type.Object({ id: Type.Optional(taskId), parentId: Type.Optional(taskId), includeDone: Type.Optional(Type.Boolean()), detail: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      const { rows, data } = await tasks.list(ctx, params), views = new Map(taskViews(data).map(task => [task.id, task]));
      const summaries = rows.map(task => ({ id: task.id, title: task.title, status: task.status,
        ...task.parentId ? { parentId: task.parentId } : { progress: task.progress },
        blockedBy: openBlockers(task, views) }));
      return textResult([`tasks ${rows.length} items`, ...rows.flatMap(task => params.detail ? taskDetails(task, views) :
        [taskLabel(task), ...openBlockers(task, views).length ? [`blockedBy: ${openBlockers(task, views).map(id => `#${id}`).join(', ')}`] : []]),
        'edit: task_edit({"changes":[…]})'], { tasks: params.detail ? rows.map(task => ({ ...task, blockedBy: openBlockers(task, views) })) : summaries });
    },
  });
  pi.registerTool({
    name: 'task_edit', label: 'Edit Tasks',
    description: 'Atomically add/update/delete a batch in this session\'s two-level task list. add without parentId creates a group; children is a flat title array. add with parentId creates a child (default todo). Only children accept status todo/doing/done or move via parentId. Group progress is derived; deleting a group with children needs cascade:true. update sends changed fields only; description="" clears it. blockedBy replaces dependency IDs; problematic/open blockers produce warnings. No change commits if any operation is invalid. Deleting/completing tasks never stops jobs/agents or completes the goal.',
    parameters: Type.Object({ changes: Type.Array(changeSchema, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const result = await tasks.edit(ctx, params.changes, signal);
      return textResult([`task_edit ${result.changes.length} changes`,
        ...result.changes.map(change => `${change.op} #${change.id}${change.parentId ? ` parent #${change.parentId}` : ''}${change.fields && Object.keys(change.fields).length ? ` ${JSON.stringify(change.fields)}` : ''}`),
        ...result.progress.map(group => `#${group.id} ${group.done}/${group.total} ${group.status}`),
        ...result.warnings.map(warning => `warning: ${warning}`), 'list: task_list({})'], result);
    },
  });
}
