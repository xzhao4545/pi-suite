import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { getShellConfig } from '@earendil-works/pi-coding-agent';
import { captureIdentity, stopWindows, stopWindowsSync } from './windows-process.ts';
import type { ProcessIdentity, ExitObservation, CleanupEvidence, StopReason } from './types.ts';

export type RunningCommand = {
  child: ChildProcess; spawnedAt: number; exited: Promise<ExitObservation>;
  identity: Promise<ProcessIdentity | undefined>; knownResidual: boolean;
  retainedScope?: ProcessIdentity[]; // Earlier observed identities veto unsafe retry confirmation; never used for killing.
  exitObserved?: ExitObservation; rootIdentity?: ProcessIdentity; resourceError?: string;
  cleanupDeadline?: number; cleanupSignal?: AbortSignal; identityController?: AbortController;
};
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
export async function launchCommand(input: { command: string; cwd: string; stdoutPath: string; stderrPath: string; shellPath?: string; signal?: AbortSignal; onSpawned?: (run: RunningCommand) => void }): Promise<RunningCommand> {
  const shell = getShellConfig(input.shellPath);
  // Windows append-only handles fail in MSYS Bash builtins.
  const stdout = await openOutput(input.stdoutPath);
  let stderr: FileHandle;
  try { stderr = await openOutput(input.stderrPath); } catch (error) { await stdout.close().catch(() => {}); throw error; }
  let transferred: RunningCommand | undefined;
  try {
    if (input.signal?.aborted) throw new DOMException('Launch aborted before spawn', 'AbortError');
    const spawnedAt = Date.now();
    const byStdin = shell.commandTransport === 'stdin';
    const child = spawn(shell.shell, byStdin ? shell.args : [...shell.args, input.command], {
      cwd: input.cwd, env: { ...process.env }, windowsHide: true, detached: false,
      stdio: [byStdin ? 'pipe' : 'ignore', stdout.fd, stderr.fd],
    });
    let resolveExit!: (exit: ExitObservation) => void;
    const exited = new Promise<ExitObservation>(resolve => { resolveExit = resolve; });
    const run: RunningCommand = { child, spawnedAt, exited, identity: Promise.resolve(undefined), knownResidual: false };
    let inputError: string | undefined;
    const observe = (code: number | null, signal: string | null, error?: string) => {
      if (run.exitObserved) return;
      run.exitObserved = { code, signal, ...(error || inputError ? { error: error ?? inputError } : {}) };
      resolveExit(run.exitObserved);
    };
    child.once('exit', (code, signal) => observe(code, signal));
    child.once('error', error => observe(null, null, String(error)));
    const started = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve); child.once('error', reject);
    });
    child.stdin?.once('error', error => { inputError = String(error); });
    if (byStdin) child.stdin?.end(input.command);
    await started;
    // Capture only a currently active root, never reclaim its PID after exit.
    const latestStart = Date.now();
    transferred = run;
    input.onSpawned?.(run);
    // Ownership callback supplies any already-shrunk cleanup budget before baseline query.
    run.identity = captureIdentity(run, latestStart);
    return run;
  } finally {
    const closed = await Promise.allSettled([stdout.close(), stderr.close()]);
    const errors = closed.filter(item => item.status === 'rejected').map(item => String(item.reason));
    if (transferred && errors.length) transferred.resourceError = errors.join('; ');
  }
}
export async function stopCommand(run: RunningCommand, _reason: StopReason, deadline: number): Promise<CleanupEvidence> {
  return stopWindows(run, deadline);
}
export function stopCommandSync(run: RunningCommand, _reason: StopReason, deadline: number): CleanupEvidence {
  return stopWindowsSync(run, deadline);
}
