// Task-specific mutations use the shared asynchronous JSON store/lock protocol.
// Adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { JsonStore } from '../runtime/json-store.ts';
import { ToolError } from '../runtime/errors.ts';
import { applyChanges, validateHierarchy } from './model.ts';
import { emptyTasks, storeSchema, groupId, type TaskChange, type TaskData } from './types.ts';

const { nextChild: _nextChild, ...legacyFields } = storeSchema.properties.tasks.items.properties;
const legacySchema = Type.Object({ ...storeSchema.properties, version: Type.Literal(2),
  tasks: Type.Array(Type.Object({ ...legacyFields, id: groupId,
    blockedBy: Type.Array(groupId, { maxItems: 100, uniqueItems: true }) }, { additionalProperties: false })),
}, { additionalProperties: false });

function migrate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2) return value;
  // Validate the historical shape before transforming it; malformed files remain errors.
  if (!Value.Check(legacySchema, value)) throw new Error('Invalid version 2 task data');
  const data = structuredClone(value) as unknown as TaskData;
  if (new Set(data.tasks.map(task => task.id)).size !== data.tasks.length
    || data.tasks.some(task => !Number.isSafeInteger(Number(task.id)) || Number(task.id) >= data.nextId)) throw new Error('Invalid version 2 task IDs');
  const ids = new Map<string, string>();
  const children = new Map<string, TaskData['tasks']>();
  for (const task of data.tasks) if (task.parentId) {
    const list = children.get(task.parentId) ?? [];
    list.push(task); children.set(task.parentId, list);
  }
  for (const group of data.tasks.filter(task => !task.parentId)) {
    group.nextChild = 1;
    const sorted = (children.get(group.id) ?? []).sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id));
    for (const child of sorted) ids.set(child.id, `${group.id}.${group.nextChild++}`);
  }
  // Keep group slots, while child slots follow their newly assigned ordinals.
  const positions = new Map<string, number>();
  data.tasks = data.tasks.map(task => {
    if (!task.parentId) return task;
    const index = positions.get(task.parentId) ?? 0;
    positions.set(task.parentId, index + 1);
    return children.get(task.parentId)![index];
  });
  for (const task of data.tasks) {
    task.id = ids.get(task.id) ?? task.id;
    task.blockedBy = task.blockedBy.map(id => ids.get(id) ?? id);
  }
  data.version = 3;
  return data;
}

export class TaskStore extends JsonStore<TaskData> {
  constructor(path?: string) {
    super(path, emptyTasks(), value => {
      // Reads migrate in memory; only a later locked edit publishes version 3.
      value = migrate(value);
      if (!Value.Check(storeSchema, value)) throw new Error('Invalid version or task data');
      validateHierarchy(value); return value;
    }, 'TASK');
  }
  edit(changes: TaskChange[], signal?: AbortSignal) { return this.mutate(data => applyChanges(data, changes), signal); }
  seed(seed: TaskData): Promise<void> {
    return this.mutate(data => { if (!data.tasks.length && data.nextId === 1) Object.assign(data, structuredClone(seed)); });
  }
  link(id: string, reference: { agentId?: string; jobId?: string }): Promise<void> {
    return this.mutate(data => {
      const task = data.tasks.find(task => task.id === id);
      if (!task?.parentId) throw new ToolError('NOT_FOUND', `No execution task ${id}`);
      if (reference.agentId) task.owner = reference.agentId;
      if (reference.jobId && !task.jobIds.includes(reference.jobId)) task.jobIds.push(reference.jobId);
      task.updatedAt = Date.now();
    });
  }
}

// Consumers share one store/queue only when their session target keys match. Memory-only
// sessions retain their list across /reload; files still lock against external writers.
const key = Symbol.for('pi-suite.tasks.stores.v3');
const globals = globalThis as typeof globalThis & { [key]?: Map<string, TaskStore> };
export function taskStore(target: string, path?: string): TaskStore {
  const stores = globals[key] ??= new Map();
  let store = stores.get(target);
  if (!store) { store = new TaskStore(path); stores.set(target, store); }
  return store;
}
