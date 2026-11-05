// Task-specific mutations use the shared asynchronous JSON store/lock protocol.
// Adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
import { Value } from 'typebox/value';
import { JsonStore } from '../runtime/json-store.ts';
import { ToolError } from '../runtime/errors.ts';
import { applyChanges, validateHierarchy } from './model.ts';
import { emptyTasks, storeSchema, type TaskChange, type TaskData } from './types.ts';

export class TaskStore extends JsonStore<TaskData> {
  constructor(path?: string) {
    super(path, emptyTasks(), value => {
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
      if (!task?.parentId) throw new ToolError('NOT_FOUND', `No execution task #${id}`);
      if (reference.agentId) task.owner = reference.agentId;
      if (reference.jobId && !task.jobIds.includes(reference.jobId)) task.jobIds.push(reference.jobId);
      task.updatedAt = Date.now();
    });
  }
}

// All child consumers in this Pi process share one store/queue per target. Memory-only
// sessions also retain their list across /reload; files still lock against external writers.
const key = Symbol.for('pi-suite.tasks.stores.v1');
const globals = globalThis as typeof globalThis & { [key]?: Map<string, TaskStore> };
export function taskStore(target: string, path?: string): TaskStore {
  const stores = globals[key] ??= new Map();
  let store = stores.get(target);
  if (!store) { store = new TaskStore(path); stores.set(target, store); }
  return store;
}
