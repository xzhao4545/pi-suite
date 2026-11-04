import { setTimeout as sleep } from 'node:timers/promises';
import { stopWindows, stopWindowsSync, captureIdentity } from './windows-tree.ts';
import { LIMITS, type CleanupEvidence, type ExitObservation, type ProcessIdentity } from '../types.ts';
import type { PtyTerminalSession } from '../terminal/session.ts';

/**
 * Backend-neutral handle for one launched job. Pipe and PTY backends fill it; stop and quit
 * logic only depend on pid, exit observation and the platform tree/group primitives.
 * On POSIX the root is always a process-group leader (detached pipe child or PTY session).
 */
export type Tracked = {
  pid: number; spawnedAt: number; startedMonotonic: number; exited: Promise<ExitObservation>; exitObserved?: ExitObservation;
  identity: Promise<ProcessIdentity | undefined>; rootIdentity?: ProcessIdentity; knownResidual: boolean;
  retainedScope?: ProcessIdentity[]; cleanupDeadline?: number; cleanupSignal?: AbortSignal; identityController?: AbortController;
  write(data: string): void; endInput?(): void; resize?(cols: number, rows: number): void;
  terminal?: PtyTerminalSession; dispose(): void;
};

export function trackIdentity(run: Tracked): void {
  // Windows needs a CIM identity before PID-based tree stop; POSIX uses the live process group.
  if (process.platform === 'win32') run.identity = captureIdentity(run, Date.now());
}

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
async function stopPosix(run: Tracked, deadline: number): Promise<CleanupEvidence> {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [{ pid: run.pid, createdAt: new Date(run.spawnedAt).toISOString() }], rootExited: !!run.exitObserved };
  try {
    // The group outlives its leader while any member runs, so the group, not the root, is the target.
    signalGroup(run.pid, 'SIGTERM');
    const graceEnd = Math.min(deadline, Date.now() + LIMITS.termGraceMs);
    while (groupAlive(run.pid) && Date.now() < graceEnd) await sleep(25);
    if (groupAlive(run.pid)) signalGroup(run.pid, 'SIGKILL');
    while (groupAlive(run.pid) && Date.now() < deadline) await sleep(25);
    if (!run.exitObserved) await Promise.race([run.exited, sleep(Math.max(0, deadline - Date.now()))]);
    evidence.rootExited = !!run.exitObserved;
    if (!groupAlive(run.pid) && evidence.rootExited && !run.knownResidual) evidence.state = 'managed_scope_confirmed';
    else throw new Error('Process group or root exit could not be confirmed before the deadline');
  } catch (error) { evidence.rootExited = !!run.exitObserved; evidence.error = String(error); }
  return evidence;
}
function stopPosixSync(run: Tracked): CleanupEvidence {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [{ pid: run.pid, createdAt: new Date(run.spawnedAt).toISOString() }], rootExited: !!run.exitObserved };
  try { signalGroup(run.pid, 'SIGKILL'); if (!groupAlive(run.pid)) { evidence.state = 'managed_scope_confirmed'; evidence.rootExited = true; } }
  catch (error) { evidence.error = String(error); }
  return evidence;
}

export async function stopTracked(run: Tracked, deadline: number): Promise<CleanupEvidence> {
  const evidence = process.platform === 'win32' ? await stopWindows(run, deadline) : await stopPosix(run, deadline);
  run.dispose();
  return evidence;
}
export function stopTrackedSync(run: Tracked, deadline: number): CleanupEvidence {
  return process.platform === 'win32' ? stopWindowsSync(run, deadline) : stopPosixSync(run);
}
