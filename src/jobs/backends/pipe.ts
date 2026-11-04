// Adapted from pi-background-jobs 0.1.3 src/process.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite changes: stdin stays open for job_write; POSIX children lead their own process group;
// the result is the backend-neutral Tracked handle.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ResolvedShellConfig } from '../terminal/shell.ts';
import { trackIdentity, type Tracked } from './process.ts';
import type { ExitObservation } from '../types.ts';

async function openOutput(path: string): Promise<FileHandle> {
  const target = resolve(path);
  for (let current = target; ; current = dirname(current)) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Linked output path refused'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
  const parent = await fs.realpath(dirname(target));
  const before = await fs.lstat(target).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
  if (before && (!before.isFile() || before.nlink !== 1 || before.size !== 0)) throw new Error('Output must be a unique empty regular file');
  // No truncate before verification. Retain the verified descriptor through spawn.
  const file = await fs.open(target, before ? 'r+' : 'wx', 0o600);
  try {
    const opened = await file.stat();
    const current = await fs.lstat(target);
    if (current.isSymbolicLink() || opened.nlink !== 1 || opened.dev !== current.dev || opened.ino !== current.ino ||
      (before && (before.dev !== opened.dev || before.ino !== opened.ino)) || await fs.realpath(dirname(target)) !== parent) throw new Error('Output path changed during open');
    return file;
  } catch (error) { await file.close().catch(() => {}); throw error; }
}

export async function launchPipe(input: { command: string; cwd: string; shell: ResolvedShellConfig; stdoutPath: string; stderrPath: string }): Promise<Tracked> {
  // Windows append-only handles fail in MSYS Bash builtins, so outputs are plain verified files.
  const stdout = await openOutput(input.stdoutPath);
  let stderr: FileHandle;
  try { stderr = await openOutput(input.stderrPath); } catch (error) { await stdout.close().catch(() => {}); throw error; }
  try {
    const byStdin = input.shell.commandTransport === 'stdin';
    const child = spawn(input.shell.shell, byStdin ? [...input.shell.args] : [...input.shell.args, input.command], {
      cwd: input.cwd, env: { ...process.env }, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', stdout.fd, stderr.fd],
    });
    const exit = Promise.withResolvers<ExitObservation>();
    const started = Promise.withResolvers<void>();
    let inputError: string | undefined;
    const run: Tracked = {
      pid: 0, spawnedAt: Date.now(), startedMonotonic: performance.now(), exited: exit.promise,
      identity: Promise.resolve(undefined), knownResidual: false,
      write(data) { if (!child.stdin?.writable) throw new Error('Job no longer accepts input'); child.stdin.write(data); },
      endInput() { child.stdin?.end(); },
      dispose() { child.stdin?.destroy(); },
    };
    const observe = (code: number | null, signal: string | null, error?: string) => {
      if (run.exitObserved) return;
      run.exitObserved = { code, signal, ...(error || inputError ? { error: error ?? inputError } : {}) };
      exit.resolve(run.exitObserved);
    };
    child.once('exit', (code, signal) => observe(code, signal));
    child.once('error', error => { observe(null, null, String(error)); started.reject(error); });
    child.once('spawn', () => started.resolve());
    child.stdin?.on('error', error => { inputError = String(error); });
    // Legacy WSL bash reads its script from stdin; such shells cannot also receive job input.
    if (byStdin) child.stdin?.end(input.command);
    await started.promise;
    run.pid = child.pid!;
    trackIdentity(run);
    return run;
  } finally {
    // The child holds its own descriptors; the parent copies are no longer needed.
    await Promise.allSettled([stdout.close(), stderr.close()]);
  }
}
