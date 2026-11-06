import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { checkedArguments } from '../runtime/tools.ts';
import { taskId, title, description, status, reason, changeSchema, type TaskChange } from './types.ts';

const operation = Type.Union([Type.Literal('add'), Type.Literal('update'), Type.Literal('delete'), Type.Literal('start'),
  Type.Literal('done'), Type.Literal('block'), Type.Literal('unblock'), Type.Literal('batch')]);
export const editSchema = Type.Object({ op: operation, id: Type.Optional(taskId), title: Type.Optional(title),
  description: Type.Optional(description), parentId: Type.Optional(taskId), status: Type.Optional(status),
  blockedBy: Type.Optional(Type.Array(taskId, { maxItems: 100, uniqueItems: true })), blockedReason: Type.Optional(reason),
  reason: Type.Optional(reason), cascade: Type.Optional(Type.Boolean()), children: Type.Optional(Type.Array(title, { maxItems: 100 })),
  changes: Type.Optional(Type.Array(changeSchema, { minItems: 1, maxItems: 100 })) }, { additionalProperties: false });
type EditArgs = Static<typeof editSchema>;
const hint = 'One task: task_edit({"op":"done","id":"2"}); batch: {"op":"batch","changes":[{"op":"start","id":"3"}]}. No changes committed.';
export const editArguments = (args: unknown): EditArgs => {
  const params = checkedArguments(editSchema, hint)(args);
  if (params.op === 'batch' ? !params.changes || Object.keys(params).some(key => key !== 'op' && key !== 'changes') : !Value.Check(changeSchema, params)) {
    throw new ToolError('INVALID_ARGS', `Fields do not match op=${params.op}. ${hint}`);
  }
  return params;
};
export const editChanges = (params: EditArgs): TaskChange[] => params.op === 'batch' ? params.changes! : [params as TaskChange];
