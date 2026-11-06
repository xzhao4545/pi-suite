// Shared file locks, reload-before-write and atomic snapshots extracted from TaskStore.
// Adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ToolError } from './errors.ts';

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
async function remove(path: string): Promise<void> { try { await unlink(path); } catch (error) { if (code(error) !== 'ENOENT') throw error; } }
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { if (code(error) === 'ESRCH') return false; if (code(error) === 'EPERM') return true; throw error; }
}
async function lock(path: string, prefix: string, signal?: AbortSignal): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const token = `${process.pid}:${randomUUID()}`;
  for (let poll = 0; poll < 100; poll++) {
    signal?.throwIfAborted();
    try { await writeFile(path, token, { flag: 'wx', mode: 0o600 }); return token; }
    catch (error) {
      // Windows exposes a delete-pending lock name as EPERM until the last reader closes.
      if (process.platform === 'win32' && code(error) === 'EPERM') { await sleep(50, undefined, { signal }); continue; }
      if (code(error) !== 'EEXIST') throw error;
    }
    let owner: string;
    try { owner = await readFile(path, 'utf8'); }
    catch (error) {
      if (code(error) === 'ENOENT') continue;
      if (process.platform === 'win32' && code(error) === 'EPERM') { await sleep(50, undefined, { signal }); continue; }
      throw error;
    }
    const pid = Number.parseInt(owner, 10);
    // Creation precedes token writing; tolerate the brief empty-file window before reclaiming.
    if (pid > 0 ? !live(pid) : poll >= 2) {
      try { if (await readFile(path, 'utf8') === owner) await remove(path); }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
    } else await sleep(50, undefined, { signal });
  }
  throw new ToolError(`${prefix}_LOCK_TIMEOUT`, `File is locked: ${path}`);
}
async function unlock(path: string, token: string): Promise<void> {
  // A reclaimed lock may belong to a successor; release only our exact pid:uuid token.
  try { if (await readFile(path, 'utf8') === token) await unlink(path); }
  catch (error) { if (code(error) !== 'ENOENT') throw error; }
}

export class JsonStore<Data> {
  protected data: Data;
  private queue = Promise.resolve();
  private listeners = new Set<() => void>();
  private observers = new Map<() => void, (error: unknown) => void>();
  private watcher?: FSWatcher;
  private refreshTimer?: NodeJS.Timeout;
  constructor(readonly path: string | undefined, initial: Data, private decode: (value: unknown) => Data, private prefix: string) { this.data = initial; }
  subscribe(listener: () => void, onExternalError?: (error: unknown) => void): () => void {
    this.listeners.add(listener);
    if (onExternalError) { this.observers.set(listener, onExternalError); this.observe(); }
    return () => {
      this.listeners.delete(listener); this.observers.delete(listener);
      if (!this.observers.size) { this.watcher?.close(); this.watcher = undefined; clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }
    };
  }
  private observe(): void {
    if (!this.path || this.watcher || !this.observers.size) return;
    const target = dirname(this.path);
    let directory = target;
    for (;;) {
      try {
        // Observe the directory because commits replace the inode. Before its first
        // creation, an existing ancestor detects new directories without polling.
        this.watcher = watch(directory, { persistent: false }, (_event, name) => {
          if (directory !== target) { this.watcher?.close(); this.watcher = undefined; this.observe(); }
          else if (name && String(name) !== basename(this.path!)) return;
          if (!this.observers.size) return;
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.snapshot().catch(error => { for (const report of this.observers.values()) report(error); });
          }, 25);
          this.refreshTimer.unref();
        });
        this.watcher.on('error', error => { for (const report of this.observers.values()) report(error); });
        return;
      } catch (error) {
        if (code(error) === 'ENOENT' && dirname(directory) !== directory) { directory = dirname(directory); continue; }
        for (const report of this.observers.values()) report(error);
        return;
      }
    }
  }
  get current(): Data { return this.data; }
  private async load(): Promise<Data> {
    if (!this.path) return this.data;
    let text: string;
    try { text = await readFile(this.path, 'utf8'); } catch (error) { if (code(error) === 'ENOENT') return this.data; throw error; }
    try {
      const value: unknown = JSON.parse(text);
      return this.decode(value);
    } catch (error) { throw new ToolError(`${this.prefix}_STORE_INVALID`, `${this.path}: ${String(error)}; current state is retained and the file is not overwritten`); }
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(run);
    // Release this serialization slot after failures too; the caller still receives rejection.
    this.queue = work.then(() => {}, () => {}); return work;
  }
  snapshot(): Promise<Data> {
    return this.serial(async () => {
      // Windows cannot atomically replace a file while another process still holds its read handle.
      // Snapshot shares the cross-process lock so the old target closes before rename.
      const lockPath = process.platform === 'win32' && this.path ? `${this.path}.lock` : undefined;
      // A missing snapshot linearizes before the first commit; do not create its directory/lock
      // or open a target that could appear concurrently without participating in the lock.
      if (lockPath) {
        try { await access(this.path!); }
        catch (error) { if (code(error) === 'ENOENT') return structuredClone(this.data); throw error; }
      }
      const token = lockPath ? await lock(lockPath, this.prefix) : undefined;
      try {
        const data = await this.load(), changed = JSON.stringify(data) !== JSON.stringify(this.data);
        this.data = data;
        if (changed) for (const listener of this.listeners) listener();
        return structuredClone(this.data);
      }
      finally { if (lockPath && token) await unlock(lockPath, token); }
    });
  }
  protected mutate<T>(apply: (data: Data) => T, signal?: AbortSignal): Promise<T> {
    return this.serial(async () => {
      const token = this.path ? await lock(`${this.path}.lock`, this.prefix, signal) : undefined;
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
}
