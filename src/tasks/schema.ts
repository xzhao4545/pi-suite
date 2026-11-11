import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { checkedArguments } from '../runtime/tools.ts';
import { taskId, taskScope, groupId, title, description, status, reason, generationSchema, changeSchema, type TaskChange } from './types.ts';

const operation = Type.Union([Type.Literal('add'), Type.Literal('update'), Type.Literal('delete'), Type.Literal('start'),
  Type.Literal('done'), Type.Literal('block'), Type.Literal('unblock'), Type.Literal('batch'), Type.Literal('clear')]);
export const editSchema = Type.Object({ generation: generationSchema, scope: Type.Optional(taskScope), op: operation, id: Type.Optional(taskId), title: Type.Optional(title),
  description: Type.Optional(description), parentId: Type.Optional(groupId), status: Type.Optional(status),
  blockedBy: Type.Optional(Type.Array(taskId, { maxItems: 100, uniqueItems: true })), blockedReason: Type.Optional(reason),
  reason: Type.Optional(reason), cascade: Type.Optional(Type.Boolean()), children: Type.Optional(Type.Array(title, { maxItems: 100 })),
  changes: Type.Optional(Type.Array(changeSchema, { minItems: 1, maxItems: 100 })) }, { additionalProperties: false });
type EditArgs = Static<typeof editSchema>;
const hint = 'Read task_list({}) for generation. One task: task_edit({"generation":"<source>","op":"done","id":"1.2"}); clear owner list: {"generation":"<source>","op":"clear"}; batch: {"generation":"<source>","op":"batch","changes":[{"op":"start","id":"1.3"}]}. No changes committed.';
export const editArguments = (args: unknown): EditArgs => {
  const params = checkedArguments(editSchema, hint)(args);
  const { scope: _scope, generation: _generation, ...change } = params;
  if (change.op === 'clear' ? Object.keys(change).length !== 1 : change.op === 'batch' ? !change.changes || Object.keys(change).some(key => key !== 'op' && key !== 'changes') : !Value.Check(changeSchema, change)) {
    throw new ToolError('INVALID_ARGS', `Fields do not match op=${params.op}. ${hint}`);
  }
  return params;
};
export const editChanges = ({ scope: _scope, generation: _generation, ...params }: EditArgs): TaskChange[] | 'clear' =>
  params.op === 'clear' ? 'clear' : params.op === 'batch' ? params.changes! : [params as TaskChange];
