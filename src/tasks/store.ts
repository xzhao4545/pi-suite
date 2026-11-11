// Task-specific mutations use the shared asynchronous JSON store/lock protocol.
// Adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { JsonStore } from '../runtime/json-store.ts';
import { ToolError } from '../runtime/errors.ts';
import { applyChanges, taskViews, validateHierarchy } from './model.ts';
import { checkGeneration, emptyTasks, requireGeneration, storeSchema, groupId, type TaskChange, type TaskData, type TaskDisplay, type TaskEditResult } from './types.ts';

const { generation: _generation, resetReason: _resetReason, ...v3Fields } = storeSchema.properties;
const v3Schema = Type.Object({ ...v3Fields, version: Type.Literal(3) }, { additionalProperties: false });

const { nextChild: _nextChild, ...legacyFields } = storeSchema.properties.tasks.items.properties;
const legacySchema = Type.Object({ ...v3Fields, version: Type.Literal(2),
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
  (data as unknown as { version: number }).version = 3;
  return data;
}

function decode(value: unknown, generation: string): TaskData {
  value = migrate(value);
  if (Value.Check(v3Schema, value)) value = { ...value, version: 4, generation };
  if (!Value.Check(storeSchema, value)) throw new Error('Invalid version or task data');
  validateHierarchy(value); return value;
}
const display = (data: TaskData): TaskDisplay[] => taskViews(data).map(({ id, title, parentId, status, updatedAt, progress }) =>
  ({ id, title, parentId, status, updatedAt, progress }));
const complete = (data: TaskData) => data.tasks.length > 0 && taskViews(data).every(task => task.status === 'done');

export class TaskStore extends JsonStore<TaskData> {
  private ready: Promise<void>;
  private completionListeners = new Set<(rows: TaskDisplay[], generation: string, sourceGeneration: string) => void>();
  readonly initialGeneration: string;
  constructor(path?: string, legacy?: Promise<unknown>) {
    // Readers/processes of an uninitialized or v3 file must agree before the first locked
    // commit. Clear then replaces this capability with a fresh, unpredictable generation.
    const initial = emptyTasks(path ? `initial:${createHash('sha256').update(path).digest('hex')}` : undefined);
    super(path, initial, value => decode(value, initial.generation), 'TASK');
    this.initialGeneration = initial.generation;
    this.ready = legacy ? legacy.then(value => { this.data = decode(value, initial.generation); }) : Promise.resolve();
  }
  override async snapshot(generation?: string): Promise<TaskData> {
    await this.ready;
    const data = await super.snapshot();
    if (generation !== undefined) checkGeneration(data, generation);
    return data;
  }
  async edit(changes: TaskChange[], generation: string, signal?: AbortSignal): Promise<TaskEditResult> {
    requireGeneration(generation); await this.ready;
    let completed: TaskDisplay[] | undefined;
    const result = await this.mutate(data => {
      // Check after reload and lock wait, not against the caller's stale cache.
      checkGeneration(data, generation);
      const result = applyChanges(data, changes);
      if (complete(data)) { completed = display(data); Object.assign(data, emptyTasks(undefined, 'completed')); }
      return { ...result, generation: data.generation, ...completed ? { cleared: 'completed' as const } : {} };
    }, signal);
    if (completed) for (const listener of this.completionListeners) listener(completed, result.generation, generation);
    return result;
  }
  async clear(generation: string, signal?: AbortSignal): Promise<TaskEditResult> {
    requireGeneration(generation); await this.ready;
    return this.mutate(data => {
      checkGeneration(data, generation); Object.assign(data, emptyTasks(undefined, 'clear'));
      return { changes: [], derived: [], progress: [], warnings: [], generation: data.generation, cleared: 'clear' };
    }, signal);
  }
  /** Only the currently bound target opts into cleaning completed restored data. */
  async recover(): Promise<TaskData> {
    const data = await this.snapshot();
    if (complete(data)) await this.mutate(current => {
      checkGeneration(current, data.generation);
      if (complete(current)) Object.assign(current, emptyTasks(undefined, 'completed'));
    });
    return this.snapshot();
  }
  async seed(seed: TaskData, generation: string): Promise<void> {
    requireGeneration(generation); await this.ready;
    return this.mutate(data => {
      checkGeneration(data, generation);
      // Independent target identity also prevents re-seeding a cleared target.
      if (!data.tasks.length && data.nextId === 1 && data.generation === this.initialGeneration) {
        const clone = structuredClone(seed);
        Object.assign(data, clone, { generation: data.generation });
      }
    });
  }
  onCompletion(listener: (rows: TaskDisplay[], generation: string, sourceGeneration: string) => void): () => void {
    this.completionListeners.add(listener); return () => this.completionListeners.delete(listener);
  }
  async link(id: string, reference: { agentId?: string; jobId?: string }, generation: string): Promise<void> {
    requireGeneration(generation); await this.ready;
    return this.mutate(data => {
      checkGeneration(data, generation);
      const task = data.tasks.find(task => task.id === id);
      if (!task?.parentId) throw new ToolError('NOT_FOUND', `No execution task ${id}`);
      if (reference.agentId) task.owner = reference.agentId;
      if (reference.jobId && !task.jobIds.includes(reference.jobId)) task.jobIds.push(reference.jobId);
      task.updatedAt = Date.now();
    });
  }
}

// Keep v3 reachable only for retirement, never as an alternative write path. A public
// snapshot queues behind its admitted mutations. Revoke new entries synchronously, then
// publish v4 only after that barrier; in-flight v3 writes cannot follow new task reuse.
const key = Symbol.for('pi-suite.tasks.stores.v4');
const oldKey = Symbol.for('pi-suite.tasks.stores.v3');
type LegacyStore = Pick<TaskStore, 'current' | 'snapshot' | 'edit' | 'seed' | 'link'>;
const globals = globalThis as typeof globalThis & { [key]?: Map<string, TaskStore>; [oldKey]?: Map<string, LegacyStore> };
function retire(store: LegacyStore): Promise<unknown> {
  const barrier = store.snapshot();
  const reject = () => Promise.reject(new ToolError('TASK_STALE', 'This pre-generation task store is retired; restart task control with the current tools. Execution is not stopped.'));
  for (const method of ['snapshot', 'edit', 'seed', 'link']) Object.defineProperty(store, method, { value: reject, configurable: true });
  return barrier.finally(() => {
    Object.defineProperty(store, 'current', { get() { throw new ToolError('TASK_STALE', 'Pre-generation task store is retired'); }, configurable: true });
  });
}
export function taskStore(target: string, path?: string): TaskStore {
  const stores = globals[key] ??= new Map();
  let store = stores.get(target);
  if (!store) {
    const old = globals[oldKey]?.get(target);
    const legacy = old ? retire(old) : undefined;
    // Keep the retired entry: pre-reload taskStore closures also retain this map and
    // would otherwise construct a fresh v3 writer for the same in-memory target.
    store = new TaskStore(path, legacy); stores.set(target, store);
  }
  return store;
}
