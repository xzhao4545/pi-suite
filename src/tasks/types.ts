// Adapted from @tintinweb/pi-tasks 0.9.1 src/types.ts (MIT, third-party/licenses/pi-tasks.txt).
// Groups organize direct children; execution status is stored only on children.
import { Type, type Static } from 'typebox';

export const taskId = Type.String({ pattern: '^[1-9][0-9]*$' });
const title = Type.String({ minLength: 1, maxLength: 200 });
const description = Type.String({ maxLength: 8000 });
const status = Type.Union([Type.Literal('todo'), Type.Literal('doing'), Type.Literal('done')]);
const dependencies = Type.Array(taskId, { maxItems: 100, uniqueItems: true });
const editable = { title: Type.Optional(title), description: Type.Optional(description), blockedBy: Type.Optional(dependencies) };
export const changeSchema = Type.Union([
  Type.Object({ op: Type.Literal('add'), title, description: editable.description, blockedBy: editable.blockedBy,
    parentId: Type.Optional(taskId), status: Type.Optional(status), children: Type.Optional(Type.Array(title, { maxItems: 100 })) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('update'), id: taskId, ...editable, parentId: Type.Optional(taskId), status: Type.Optional(status) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('delete'), id: taskId, cascade: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);
export type TaskChange = Static<typeof changeSchema>;
export const storeSchema = Type.Object({
  version: Type.Literal(1), nextId: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  tasks: Type.Array(Type.Object({
    id: taskId, title, description: Type.Optional(description), parentId: Type.Optional(taskId), status: Type.Optional(status),
    blockedBy: dependencies, owner: Type.Optional(Type.String()), jobIds: Type.Array(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }), updatedAt: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type TaskData = Static<typeof storeSchema>;
export type Task = TaskData['tasks'][number];
export type TaskStatus = Static<typeof status>;
export type TaskView = Omit<Task, 'status'> & { status: TaskStatus; blocks: string[]; progress?: { done: number; total: number } };
export type EditReceipt = { op: TaskChange['op']; id: string; parentId?: string; fields?: Record<string, unknown> };
export type EditResult = { changes: EditReceipt[]; progress: { id: string; status: TaskStatus; done: number; total: number }[]; warnings: string[] };
export const emptyTasks = (): TaskData => ({ version: 1, nextId: 1, tasks: [] });
