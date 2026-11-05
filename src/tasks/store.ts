// File locks, reload-before-write, snapshots and atomic save adapted from
// @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT, third-party/licenses/pi-tasks.txt).
// pi-suite changes: asynchronous retries, versioned validation, copy-on-write batches.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { applyChanges, validateHierarchy } from './model.ts';
import { emptyTasks, storeSchema, type TaskChange, type TaskData } from './types.ts';

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
async function remove(path: string): Promise<void> { try { await unlink(path); } catch (error) { if (code(error) !== 'ENOENT') throw error; } }
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { if (code(error) === 'ESRCH') return false; if (code(error) === 'EPERM') return true; throw error; }
}
async function lock(path: string, signal?: AbortSignal): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const token = `${process.pid}:${randomUUID()}`;
  for (let poll = 0; poll < 100; poll++) {
    signal?.throwIfAborted();
    try { await writeFile(path, token, { flag: 'wx', mode: 0o600 }); return token; }
    catch (error) { if (code(error) !== 'EEXIST') throw error; }
    let owner: string;
    try { owner = await readFile(path, 'utf8'); } catch (error) { if (code(error) === 'ENOENT') continue; throw error; }
    const pid = Number.parseInt(owner, 10);
    // Creation precedes token writing; tolerate the brief empty-file window before reclaiming.
    if (pid > 0 ? !live(pid) : poll >= 2) {
      try { if (await readFile(path, 'utf8') === owner) await remove(path); }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
    } else await sleep(50, undefined, { signal });
  }
  throw new ToolError('TASK_LOCK_TIMEOUT', `Task file is locked: ${path}`);
}
async function unlock(path: string, token: string): Promise<void> {
  // A reclaimed lock may belong to a successor; release only our exact pid:uuid token.
  try { if (await readFile(path, 'utf8') === token) await unlink(path); }
  catch (error) { if (code(error) !== 'ENOENT') throw error; }
}

export class TaskStore {
  private data = emptyTasks();
  private queue = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(readonly path?: string) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get current(): TaskData { return this.data; }
  private async load(): Promise<TaskData> {
    if (!this.path) return this.data;
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if (code(error) === 'ENOENT') return this.data; throw error; }
    try {
      const value: unknown = JSON.parse(text);
      if (!Value.Check(storeSchema, value)) throw new Error('Invalid version or task data');
      validateHierarchy(value); return value;
    } catch (error) { throw new ToolError('TASK_STORE_INVALID', `${this.path}: ${String(error)}; current state is retained and the file is not overwritten`); }
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(run);
    // Release this serialization slot after failures too; the caller still receives rejection.
    this.queue = work.then(() => {}, () => {}); return work;
  }
  snapshot(): Promise<TaskData> {
    return this.serial(async () => { this.data = await this.load(); return structuredClone(this.data); });
  }
  private mutate<T>(apply: (data: TaskData) => T, signal?: AbortSignal): Promise<T> {
    return this.serial(async () => {
      const token = this.path ? await lock(`${this.path}.lock`, signal) : undefined;
      try {
        const data = structuredClone(await this.load());
        signal?.throwIfAborted();
        const result = apply(data);
        if (this.path) {
          const tmp = `${this.path}.${token!.split(':')[1]}.tmp`;
          try {
            await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
            signal?.throwIfAborted(); await rename(tmp, this.path);
          } finally { await remove(tmp); }
        }
        this.data = data;
        for (const listener of this.listeners) listener();
        return result;
      } finally { if (this.path && token) await unlock(`${this.path}.lock`, token); }
    });
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
