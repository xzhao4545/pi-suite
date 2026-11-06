// Imported from pi-background-jobs 0.1.3 src/windows-process.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite changes: operates on the backend-neutral Tracked handle (pid) so pipe and PTY jobs share it;
// async CIM queries reuse one resident PowerShell instead of starting one per query.
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, win32 } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { Tracked as RunningCommand } from './process.ts';
import type { ProcessIdentity, CleanupEvidence } from '../types.ts';

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
// One CIM query as rows of { pid, parentPid, createdAt }; `$target` 0 lists every process.
const QUERY_ROWS = "@(Get-CimInstance Win32_Process -Filter $(if ($target) { \"ProcessId = $target\" } else { 'ProcessId > 0' }) | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o')} })";
const UTF8 = '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)';
function queryArgs(pid?: number): string[] {
  const target = pid === undefined ? '0' : pidArgument(pid);
  return ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${UTF8}; $target=${target}; ConvertTo-Json -InputObject ${QUERY_ROWS} -Compress`];
}
// Requests are JSON lines { id, pid }; each reply is { id, rows } or { id, error }. A failed query
// replies with its error and the loop continues; stdin EOF (Pi exited or idle close) ends it.
const WORKER_SCRIPT = `$ErrorActionPreference='Stop'; ${UTF8}; while ($null -ne ($line = [Console]::In.ReadLine())) { $request = ConvertFrom-Json $line; try { $target = [int]$request.pid; $reply = [pscustomobject]@{id=$request.id; rows=${QUERY_ROWS}} } catch { $reply = [pscustomobject]@{id=$request.id; error=[string]$_} }; [Console]::Out.WriteLine((ConvertTo-Json -InputObject $reply -Compress -Depth 4)); [Console]::Out.Flush() }`;
const rowsSchema = Type.Array(Type.Object({
  pid: Type.Integer({ minimum: 1 }), parentPid: Type.Integer({ minimum: 0 }), createdAt: Type.String(),
}));
const replySchema = Type.Union([
  Type.Object({ id: Type.Integer({ minimum: 1 }), rows: rowsSchema }),
  Type.Object({ id: Type.Integer({ minimum: 1 }), error: Type.String() }),
]);
function parseRows(rows: unknown): ProcessRow[] {
  if (!Value.Check(rowsSchema, rows) || rows.some(row => !Number.isFinite(Date.parse(row.createdAt)))) throw new Error('Invalid CIM process identities');
  return rows;
}
const powershell = () => systemPath('WindowsPowerShell/v1.0/powershell.exe');
const WORKER_IDLE_MS = 60_000;
type Query = { id: number; pid?: number; resolve(rows: ProcessRow[]): void; reject(error: unknown): void; timer: NodeJS.Timeout; signal?: AbortSignal; abort?: () => void };

/**
 * Starting powershell.exe costs about as much as the CIM query itself, and one stop needs three
 * queries plus each job's start identity. A single resident worker answers them in order; it is
 * started on demand, unref'd so it never keeps Pi alive, and closed after an idle minute.
 * Queries are read-only, so a timed-out query restarts a possibly hung worker and the others resend.
 */
class QueryWorker {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Query>();
  private nextId = 1;
  private idle?: NodeJS.Timeout;

  query(deadline: number, pid?: number, signal?: AbortSignal): Promise<ProcessRow[]> {
    const delay = remaining(deadline);
    if (pid !== undefined) pidArgument(pid);
    signal?.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers<ProcessRow[]>();
    const query: Query = { id: this.nextId++, pid, resolve, reject, signal,
      timer: setTimeout(() => { this.finish(query); reject(new Error('CIM query timed out')); this.restart(); }, delay) };
    query.abort = () => { this.finish(query); reject(signal!.reason ?? new Error('Cleanup deadline exhausted')); };
    signal?.addEventListener('abort', query.abort, { once: true });
    this.pending.set(query.id, query);
    clearTimeout(this.idle);
    try { this.send(query); } catch (error) { this.finish(query); reject(error); }
    return promise;
  }
  private send(query: Query): void {
    this.child ??= this.start();
    this.child.stdin.write(`${JSON.stringify({ id: query.id, pid: query.pid ?? 0 })}\n`);
  }
  private start(): ChildProcessWithoutNullStreams {
    const child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', WORKER_SCRIPT], { windowsHide: true, stdio: 'pipe' });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    createInterface({ input: child.stdout }).on('line', line => this.reply(child, line));
    child.stdin.on('error', error => this.fail(child, error));
    child.on('error', error => this.fail(child, error));
    child.on('close', code => this.fail(child, new Error(`CIM worker exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`)));
    // Pending query timers keep the event loop alive while an answer is owed; the worker itself must not.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      if ('unref' in stream && typeof stream.unref === 'function') stream.unref();
    }
    return child;
  }
  private reply(child: ChildProcessWithoutNullStreams, line: string): void {
    if (child !== this.child) return;
    let reply: unknown;
    try { reply = JSON.parse(line); } catch (error) { this.fail(child, new Error(`Invalid CIM worker reply: ${String(error)}`)); return; }
    if (!Value.Check(replySchema, reply)) { this.fail(child, new Error('Invalid CIM worker reply shape')); return; }
    const query = this.pending.get(reply.id);
    if (!query) return; // Already timed out or aborted.
    this.finish(query);
    try {
      if ('error' in reply) throw new Error(`CIM query failed: ${reply.error}`);
      query.resolve(parseRows(reply.rows));
    } catch (error) { query.reject(error); }
  }
  private finish(query: Query): void {
    clearTimeout(query.timer);
    query.signal?.removeEventListener('abort', query.abort!);
    this.pending.delete(query.id);
    if (!this.pending.size && this.child) {
      this.idle = setTimeout(() => this.stop(), WORKER_IDLE_MS);
      this.idle.unref();
    }
  }
  private stop(): void {
    const child = this.child;
    this.child = undefined;
    child?.stdin.end();
  }
  /** Replace a possibly hung worker; queries still owed an answer are resent to the new one. */
  private restart(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const query of this.pending.values()) {
      try { this.send(query); } catch (error) { this.finish(query); query.reject(error); }
    }
  }
  /** The current worker failed: every query it owed fails with that cause; the next query starts a new one. */
  private fail(child: ChildProcessWithoutNullStreams, error: unknown): void {
    if (child !== this.child) return;
    this.child = undefined;
    child.kill();
    for (const query of [...this.pending.values()]) { this.finish(query); query.reject(error); }
  }
}
const worker = new QueryWorker();
export const systemCommands: SystemCommands = {
  query: (deadline, pid, signal) => worker.query(deadline, pid, signal),
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
  return parseRows(JSON.parse(result.stdout.trim()));
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
  if (run.exitObserved || !run.pid) return undefined;
  try {
    const deadline=Math.min(Date.now()+3000,run.cleanupDeadline??Infinity);
    remaining(deadline);
    if(run.cleanupSignal?.aborted)return undefined;
    run.identityController=new AbortController();
    const abort=()=>run.identityController?.abort();
    run.cleanupSignal?.addEventListener('abort',abort,{once:true});
    if(run.cleanupSignal?.aborted)abort();
    let rows:ProcessRow[];
    try{rows=await systemCommands.query(deadline,run.pid,run.identityController.signal);}
    finally{run.cleanupSignal?.removeEventListener('abort',abort);}
    const row = rows.find(row => row.pid === run.pid);
    if (run.exitObserved || !row || Date.parse(row.createdAt) < run.spawnedAt - 1000 || Date.parse(row.createdAt) > latestStart + 1000) return undefined;
    const identity = { pid: row.pid, createdAt: row.createdAt };
    run.rootIdentity = identity;
    return identity;
  } catch { return undefined; }
}
async function beforeDeadline<T>(promise: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  const delay = remaining(deadline);
  const expired = Promise.withResolvers<never>();
  const abort = () => expired.reject(new Error('Cleanup deadline exhausted'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, delay);
  try { return await Promise.race([promise, expired.promise]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function requireRoot(run: RunningCommand, root: ProcessIdentity | undefined): asserts root is ProcessIdentity {
  if (!root || root.pid !== run.pid) throw new Error('Root identity unavailable; PID stop refused');
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
      await beforeDeadline(sleep(50), budget(), run.cleanupSignal);
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
