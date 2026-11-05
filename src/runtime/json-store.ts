// Shared file locks, reload-before-write and atomic snapshots extracted from TaskStore.
// Adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  constructor(readonly path: string | undefined, initial: Data, private decode: (value: unknown) => Data, private prefix: string) { this.data = initial; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
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
    return this.serial(async () => { this.data = await this.load(); return structuredClone(this.data); });
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
