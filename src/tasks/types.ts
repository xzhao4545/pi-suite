// Adapted from @tintinweb/pi-tasks 0.9.1 src/types.ts (MIT, third-party/licenses/pi-tasks.txt).
// Groups organize direct children; execution status is stored only on children.
import { Type, type Static } from 'typebox';

export const groupId = Type.String({ pattern: '^[1-9][0-9]*$' });
export const childId = Type.String({ pattern: '^[1-9][0-9]*\\.[1-9][0-9]*$' });
export const taskId = Type.String({ pattern: '^[1-9][0-9]*(?:\\.[1-9][0-9]*)?$' });
export const title = Type.String({ minLength: 1, maxLength: 200 });
export const description = Type.String({ maxLength: 8000 });
export const status = Type.Union([Type.Literal('todo'), Type.Literal('doing'), Type.Literal('blocked'), Type.Literal('done')]);
export const reason = Type.String({ maxLength: 500 });
const dependencies = Type.Array(taskId, { maxItems: 100, uniqueItems: true });
const editable = { title: Type.Optional(title), description: Type.Optional(description), blockedBy: Type.Optional(dependencies) };
export const mutationSchema = Type.Union([
  Type.Object({ op: Type.Literal('add'), title, description: editable.description, blockedBy: editable.blockedBy,
    parentId: Type.Optional(groupId), status: Type.Optional(status), children: Type.Optional(Type.Array(title, { maxItems: 100 })) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('update'), id: taskId, ...editable, status: Type.Optional(status), blockedReason: Type.Optional(reason) }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('delete'), id: taskId, cascade: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
]);
export const changeSchema = Type.Union([mutationSchema,
  Type.Object({ op: Type.Union([Type.Literal('start'), Type.Literal('done'), Type.Literal('unblock')]), id: childId }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('block'), id: childId, reason: Type.Optional(reason) }, { additionalProperties: false }),
]);
export type TaskChange = Static<typeof changeSchema>;
export const storeSchema = Type.Object({
  version: Type.Literal(3), nextId: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  tasks: Type.Array(Type.Object({
    id: taskId, nextChild: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })), title, description: Type.Optional(description), parentId: Type.Optional(groupId), status: Type.Optional(status),
    blockedBy: dependencies, owner: Type.Optional(Type.String()), jobIds: Type.Array(Type.String()),
    blockedReason: Type.Optional(reason),
    createdAt: Type.Integer({ minimum: 0 }), updatedAt: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type TaskData = Static<typeof storeSchema>;
export type Task = TaskData['tasks'][number];
export type TaskStatus = Static<typeof status>;
export type TaskView = Omit<Task, 'status'> & { status: TaskStatus; blocks: string[]; progress?: { done: number; total: number } };
export type EditReceipt = { op: TaskChange['op']; id: string; title: string; parentId?: string; fields?: Record<string, unknown>; before?: TaskStatus; after?: TaskStatus };
export type DerivedChange = { id: string; title: string; parentId: string; before: TaskStatus; status: TaskStatus };
export type EditResult = { changes: EditReceipt[]; derived: DerivedChange[]; progress: { id: string; status: TaskStatus; done: number; total: number }[]; warnings: string[] };
export const emptyTasks = (): TaskData => ({ version: 3, nextId: 1, tasks: [] });
