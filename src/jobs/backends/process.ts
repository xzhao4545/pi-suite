import { setTimeout as sleep } from 'node:timers/promises';
import { stopWindows, stopWindowsSync, captureIdentity } from './windows-tree.ts';
import { captureLinuxIdentity, captureLinuxScope, signalLinuxScope, linuxScopeAlive, linuxRootExited } from './linux-tree.ts';
import { errnoCode, LIMITS, type CleanupEvidence, type ExitObservation, type ProcessIdentity } from '../types.ts';
import type { PtyTerminalSession } from '../terminal/session.ts';

/**
 * Backend-neutral handle for one launched job. Pipe and PTY backends fill it; stop and quit
 * logic only depend on pid, exit observation and the platform tree/group primitives.
 * On POSIX the root is always a process-group leader (detached pipe child or PTY session).
 */
export type Tracked = {
  pid: number; spawnedAt: number; startedMonotonic: number; exited: Promise<ExitObservation>; exitObserved?: ExitObservation;
  identity: Promise<ProcessIdentity | undefined>; rootIdentity?: ProcessIdentity; identityError?: string; knownResidual: boolean;
  retainedScope?: ProcessIdentity[]; cleanupDeadline?: number; cleanupSignal?: AbortSignal; identityController?: AbortController;
  write(data: string): void; endInput?(): void; resize?(cols: number, rows: number): void;
  terminal?: PtyTerminalSession; dispose(): void;
};

export function trackIdentity(run: Tracked): void {
  // Linux tools can create their own sessions/groups; keep the root identity for tree capture.
  if (process.platform === 'win32') run.identity = captureIdentity(run, Date.now());
  else if (process.platform === 'linux') {
    try { run.identity = Promise.resolve(captureLinuxIdentity(run)); }
    catch (error) { run.identityError = String(error); }
  }
}

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (errnoCode(error) === 'ESRCH') return false; throw error; }
}
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) { if (errnoCode(error) !== 'ESRCH') throw error; }
}
async function stopPosix(run: Tracked, deadline: number): Promise<CleanupEvidence> {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [{ pid: run.pid, createdAt: new Date(run.spawnedAt).toISOString() }], rootExited: !!run.exitObserved };
  const linux = process.platform === 'linux';
  const alive = () => linux ? linuxScopeAlive(evidence.scope) : groupAlive(run.pid);
  const signal = (value: NodeJS.Signals) => linux ? signalLinuxScope(evidence.scope, value) : signalGroup(run.pid, value);
  try {
    if (linux) evidence.scope = captureLinuxScope(run);
    signal('SIGTERM');
    const graceEnd = Math.min(deadline, Date.now() + LIMITS.termGraceMs);
    while (alive() && Date.now() < graceEnd) await sleep(25);
    if (alive()) { if (linux) evidence.scope = captureLinuxScope(run); signal('SIGKILL'); }
    while (alive() && Date.now() < deadline) await sleep(25);
    if (!run.exitObserved) await Promise.race([run.exited, sleep(Math.max(0, deadline - Date.now()))]);
    evidence.rootExited = !!run.exitObserved;
    if (!alive() && evidence.rootExited && !run.knownResidual) evidence.state = 'managed_scope_confirmed';
    else throw new Error('Managed process scope or root exit could not be confirmed before the deadline');
  } catch (error) { evidence.rootExited = !!run.exitObserved; evidence.error = String(error); }
  return evidence;
}
function stopPosixSync(run: Tracked, deadline: number): CleanupEvidence {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [{ pid: run.pid, createdAt: new Date(run.spawnedAt).toISOString() }], rootExited: !!run.exitObserved };
  try {
    if (process.platform === 'linux') {
      evidence.scope = captureLinuxScope(run); signalLinuxScope(evidence.scope, 'SIGKILL');
      const wait = new Int32Array(new SharedArrayBuffer(4));
      while (linuxScopeAlive(evidence.scope) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
      evidence.rootExited = linuxRootExited(run);
      if (!linuxScopeAlive(evidence.scope) && evidence.rootExited && !run.knownResidual) evidence.state = 'managed_scope_confirmed';
      else throw new Error('Managed process scope could not be confirmed at exit');
    } else { signalGroup(run.pid, 'SIGKILL'); if (!groupAlive(run.pid)) { evidence.state = 'managed_scope_confirmed'; evidence.rootExited = true; } }
  }
  catch (error) { evidence.error = String(error); }
  return evidence;
}

export async function stopTracked(run: Tracked, deadline: number): Promise<CleanupEvidence> {
  const evidence = process.platform === 'win32' ? await stopWindows(run, deadline) : await stopPosix(run, deadline);
  run.dispose();
  return evidence;
}
export function stopTrackedSync(run: Tracked, deadline: number): CleanupEvidence {
  return process.platform === 'win32' ? stopWindowsSync(run, deadline) : stopPosixSync(run, deadline);
}
