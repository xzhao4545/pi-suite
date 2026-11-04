import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join, win32 } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import type { RunningCommand } from './process.ts';
import type { ProcessIdentity, CleanupEvidence } from './types.ts';

export type ProcessRow = ProcessIdentity & { parentPid: number };
export type SystemCommands = {
  query(deadline: number, pid?: number, signal?: AbortSignal): Promise<ProcessRow[]>;
  kill(pid: number, deadline: number, signal?: AbortSignal): Promise<number | null>;
};
const execute = promisify(execFile);
function remaining(deadline: number): number {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new Error('Cleanup deadline exhausted');
  return ms;
}
function systemPath(file: string): string {
  if (process.platform !== 'win32') throw new Error('Only Windows has been validated');
  // This first version is validated only on the actual C:\\Windows installation.
  // Never allow a mutable env/PATH value to select a substitute control executable.
  const trustedRoot = 'C:\\Windows';
  const declared = process.env.SystemRoot;
  if (!declared || !win32.isAbsolute(declared) || win32.normalize(declared).toLowerCase() !== trustedRoot.toLowerCase()) throw new Error('Unvalidated system root; trusted Windows controls refused');
  for (const directory of [trustedRoot, join(trustedRoot, 'System32')]) {
    if (lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== directory.toLowerCase()) throw new Error('Trusted Windows directory redirected');
  }
  return join(trustedRoot, 'System32', file);
}
function pidArgument(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process PID');
  return String(pid);
}
function queryArgs(pid?: number): string[] {
  const filter = pid === undefined ? " -Filter 'ProcessId > 0'" : ` -Filter 'ProcessId = ${pidArgument(pid)}'`;
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $rows=@(Get-CimInstance Win32_Process${filter} | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o')} }); ConvertTo-Json -InputObject $rows -Compress`;
  return ['-NoProfile', '-NonInteractive', '-Command', script];
}
function parseRows(text: string): ProcessRow[] {
  const rows: unknown = JSON.parse(text.trim());
  if (!Array.isArray(rows)) throw new Error('Invalid CIM response');
  for (const item of rows) {
    if (!item || typeof item !== 'object') throw new Error('Invalid process row');
    const row = item as ProcessRow;
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || !Number.isSafeInteger(row.parentPid) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new Error('Invalid process identity');
  }
  return rows as ProcessRow[];
}
const powershell = () => systemPath('WindowsPowerShell/v1.0/powershell.exe');
export const systemCommands: SystemCommands = {
  async query(deadline, pid, signal) {
    const result = await execute(powershell(), queryArgs(pid), { timeout: remaining(deadline), windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', signal });
    return parseRows(result.stdout);
  },
  async kill(pid, deadline, signal) {
    try {
      await execute(systemPath('taskkill.exe'), ['/F', '/T', '/PID', pidArgument(pid)], { timeout: remaining(deadline), windowsHide: true, signal });
      return 0;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'number') return code;
      throw error;
    }
  },
};
function querySync(deadline: number, pid?: number): ProcessRow[] {
  const result = spawnSync(powershell(), queryArgs(pid), { timeout: remaining(deadline), windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || 'CIM query failed');
  return parseRows(result.stdout);
}
export function sameIdentity(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.createdAt === b.createdAt;
}
export function selectScope(rows: ProcessRow[], root: ProcessIdentity): ProcessIdentity[] {
  const first = rows.find(row => sameIdentity(row, root));
  if (!first) return [];
  const scope: ProcessRow[] = [first];
  for (let index = 0; index < scope.length; index++) {
    const parent = scope[index];
    for (const row of rows) {
      if (row.parentPid === parent.pid && Date.parse(row.createdAt) >= Date.parse(parent.createdAt) && !scope.some(item => item.pid === row.pid)) scope.push(row);
    }
  }
  return scope.map(({pid, createdAt}) => ({pid, createdAt}));
}
export async function captureIdentity(run: RunningCommand, latestStart: number): Promise<ProcessIdentity | undefined> {
  if (run.exitObserved || run.child.pid === undefined) return undefined;
  try {
    const deadline=Math.min(Date.now()+3000,run.cleanupDeadline??Infinity);
    remaining(deadline);
    if(run.cleanupSignal?.aborted)return undefined;
    run.identityController=new AbortController();
    const abort=()=>run.identityController?.abort();
    run.cleanupSignal?.addEventListener('abort',abort,{once:true});
    if(run.cleanupSignal?.aborted)abort();
    let rows:ProcessRow[];
    try{rows=await systemCommands.query(deadline,run.child.pid,run.identityController.signal);}
    finally{run.cleanupSignal?.removeEventListener('abort',abort);}
    const row = rows.find(row => row.pid === run.child.pid);
    if (run.exitObserved || !row || Date.parse(row.createdAt) < run.spawnedAt - 1000 || Date.parse(row.createdAt) > latestStart + 1000) return undefined;
    const identity = { pid: row.pid, createdAt: row.createdAt };
    run.rootIdentity = identity;
    return identity;
  } catch { return undefined; }
}
async function beforeDeadline<T>(promise: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (()=>void)|undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort=()=>reject(new Error('Cleanup deadline exhausted'));
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      timer = setTimeout(abort, remaining(deadline));
    })]);
  } finally { if (timer) clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort); }
}
function requireRoot(run: RunningCommand, root: ProcessIdentity | undefined): asserts root is ProcessIdentity {
  if (!root || root.pid !== run.child.pid) throw new Error('Root identity unavailable; PID stop refused');
  if (run.exitObserved) throw new Error('Root already exited; cannot establish a reliable stop scope');
}
function scopeAbsent(scope: ProcessIdentity[], rows: ProcessRow[]): boolean {
  return scope.every(identity => !rows.some(row => sameIdentity(row, identity)));
}
function retainScope(run: RunningCommand, scope: ProcessIdentity[]): void {
  const retained = run.retainedScope ??= [];
  for (const identity of scope) if (!retained.some(item => sameIdentity(item, identity))) retained.push(identity);
}
export async function stopWindows(run: RunningCommand, deadline: number, commands: SystemCommands = systemCommands): Promise<CleanupEvidence> {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [], rootExited: !!run.exitObserved };
  const budget = () => Math.min(deadline, run.cleanupDeadline ?? deadline);
  try {
    remaining(budget());
    const root = await beforeDeadline(run.identity, budget(), run.cleanupSignal);
    requireRoot(run, root);
    const rows = await commands.query(budget(), undefined, run.cleanupSignal);
    requireRoot(run, root);
    evidence.scope = selectScope(rows, root);
    if (!evidence.scope.length) throw new Error('Root identity mismatch or missing');
    // Publish before the next await: synchronous process exit may take over meanwhile.
    retainScope(run, evidence.scope);
    const current = await commands.query(budget(), root.pid, run.cleanupSignal);
    requireRoot(run, root);
    if (!current.some(row => sameIdentity(row, root))) throw new Error('Root identity changed before termination');
    // Query + PID-based taskkill are not atomic. TOCTOU risk remains.
    remaining(budget());
    evidence.taskkillExitCode = await commands.kill(root.pid, budget(), run.cleanupSignal);
    const confirmationScope = [...evidence.scope, ...(run.retainedScope ?? [])];
    let after = await commands.query(budget(), undefined, run.cleanupSignal);
    while (!scopeAbsent(confirmationScope, after) && budget() - Date.now() > 200) {
      await beforeDeadline(new Promise(resolve => setTimeout(resolve, 50)), budget(), run.cleanupSignal);
      after = await commands.query(budget(), undefined, run.cleanupSignal);
    }
    if (!run.exitObserved && scopeAbsent(confirmationScope, after)) await beforeDeadline(run.exited, budget(), run.cleanupSignal);
    evidence.rootExited = !!run.exitObserved;
    if (!run.knownResidual && evidence.taskkillExitCode === 0 && evidence.rootExited && scopeAbsent(confirmationScope, after)) evidence.state = 'managed_scope_confirmed';
    else throw new Error('Termination or managed-scope exit could not be confirmed');
  } catch (error) {
    evidence.rootExited = !!run.exitObserved;
    evidence.error = String(error);
  }
  return evidence;
}
export function stopWindowsSync(run: RunningCommand, deadline: number): CleanupEvidence {
  const evidence: CleanupEvidence = { state: 'unconfirmed', scope: [], rootExited: !!run.exitObserved };
  try {
    remaining(deadline);
    const root = run.rootIdentity;
    requireRoot(run, root);
    const rows = querySync(deadline);
    evidence.scope = selectScope(rows, root);
    if (!evidence.scope.length) {
      evidence.rootExited = !rows.some(row => sameIdentity(row, root));
      throw new Error('Root identity mismatch or missing; stop scope unavailable');
    }
    retainScope(run, evidence.scope);
    if (!querySync(deadline, root.pid).some(row => sameIdentity(row, root))) throw new Error('Root identity changed before termination');
    const killed = spawnSync(systemPath('taskkill.exe'), ['/F', '/T', '/PID', pidArgument(root.pid)], { timeout: remaining(deadline), windowsHide: true, encoding: 'utf8' });
    evidence.taskkillExitCode = killed.status;
    if (killed.error) throw killed.error;
    const after = querySync(deadline);
    evidence.rootExited = !after.some(row => sameIdentity(row, root));
    if (!run.knownResidual && killed.status === 0 && evidence.rootExited && scopeAbsent([...evidence.scope, ...(run.retainedScope ?? [])], after)) evidence.state = 'managed_scope_confirmed';
    else throw new Error('Managed-scope cleanup unconfirmed at exit');
  } catch (error) { evidence.error = String(error); }
  return evidence;
}
