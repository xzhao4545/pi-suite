// Adapted from pi-background-jobs 0.1.3 src/store.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// Layout: <agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/{job.json,stdout.log,stderr.log,output.log,input.jsonl,events.jsonl}.
// A single job.json replaces meta/result: every write is an atomic rename, so a reader never
// sees a partial record. Log reading lives in read.ts; this module owns paths and history.
import { lstatSync, realpathSync, mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { readdir, readFile, writeFile, rename, rm, stat, unlink, appendFile } from 'node:fs/promises';
import { join, relative, sep, isAbsolute } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { isTerminal } from './state.ts';
import { ToolError } from '../runtime/errors.ts';
import type { JobSummary, Workspace, Stream, InputRecord } from './types.ts';

const JOB_ID = /^job_[a-f0-9]{8}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = ['starting', 'running', 'stopping', 'completed', 'failed', 'stopped', 'timed_out'];
const CLEANUP = ['not_required', 'pending', 'managed_scope_confirmed', 'unconfirmed'];
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export const LOG_FILES: Record<Stream, string> = { stdout: 'stdout.log', stderr: 'stderr.log', output: 'output.log', input: 'input.jsonl', events: 'events.jsonl' };

export class JobStore {
  private base: string;
  readonly root: string;
  constructor(agentDir: string) {
    this.base = realpathSync(agentDir);
    this.root = join(this.base, 'pi-suite', 'jobs');
  }
  // Also used during synchronous process exit. Reject links at every owned level.
  private secure(path: string, createDirs = false): void {
    if (!contained(this.root, path)) throw new ToolError('UNSAFE_PATH', 'Job path leaves managed directory');
    let current = this.base;
    for (const piece of relative(this.base, path).split(sep).filter(Boolean)) {
      current = join(current, piece);
      try {
        if (lstatSync(current).isSymbolicLink() || !contained(this.base, realpathSync(current))) throw new ToolError('UNSAFE_PATH', 'Managed path redirected by a link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (createDirs) mkdirSync(current, { mode: 0o700 });
        else break;
      }
    }
  }
  directory(job: Pick<JobSummary, 'id' | 'workspace'>): string {
    if (!JOB_ID.test(job.id) || !HASH.test(job.workspace.hash)) throw new ToolError('UNSAFE_PATH', 'Invalid internal job identity');
    const dir = join(this.root, job.workspace.hash, job.id);
    this.secure(dir);
    return dir;
  }
  /** Checked path of one log; callers open it themselves so streams stay in one place. */
  logPath(job: Pick<JobSummary, 'id' | 'workspace'>, stream: Stream): string {
    const path = join(this.directory(job), LOG_FILES[stream]);
    this.secure(path);
    return path;
  }
  /** Allocate an unused short ID and its directory; collisions are retried, never reused. */
  allocate(workspace: Workspace): string {
    for (;;) {
      const id = `job_${randomBytes(4).toString('hex')}`;
      const dir = join(this.root, workspace.hash, id);
      this.secure(dir);
      if (existsSync(dir)) continue;
      this.secure(dir, true);
      return id;
    }
  }
  async create(job: JobSummary): Promise<void> {
    const streams: Stream[] = [...job.mode === 'pty' ? ['output', 'input'] as const : ['stdout', 'stderr', 'input'] as const, ...job.monitor ? ['events'] as const : []];
    try {
      for (const stream of streams) await writeFile(this.logPath(job, stream), '', { flag: 'wx', mode: 0o600 });
      await this.save(job);
    } catch (error) { throw new ToolError('STORAGE_ERROR', String(error), job.id); }
  }
  async save(job: JobSummary): Promise<void> {
    const dir = this.directory(job), dest = join(dir, 'job.json'), temp = join(dir, `.${randomUUID()}.tmp`);
    this.secure(dest);
    try {
      await writeFile(temp, JSON.stringify(job), { flag: 'wx', mode: 0o600 });
      await rename(temp, dest);
    } catch (error) { throw new ToolError('STORAGE_ERROR', String(error), job.id); }
    finally { await unlink(temp).catch(() => {}); }
  }
  saveSync(job: JobSummary): void {
    const dir = this.directory(job), dest = join(dir, 'job.json'), temp = join(dir, `.${randomUUID()}.tmp`);
    this.secure(dest);
    try { writeFileSync(temp, JSON.stringify(job), { flag: 'wx', mode: 0o600 }); renameSync(temp, dest); }
    catch (error) { throw new ToolError('STORAGE_ERROR', String(error), job.id); }
    finally { try { unlinkSync(temp); } catch {} }
  }
  async appendInput(job: JobSummary, record: InputRecord): Promise<void> {
    await appendFile(this.logPath(job, 'input'), JSON.stringify(record) + '\n', { mode: 0o600 });
  }
  /** Monitor events, one JSON line each; job_read renders them through the events stream. */
  async appendEvent(job: JobSummary, event: object): Promise<void> {
    await appendFile(this.logPath(job, 'events'), JSON.stringify(event) + '\n', { mode: 0o600 });
  }
  async logBytes(job: JobSummary): Promise<number> {
    let bytes = 0;
    for (const stream of job.mode === 'pty' ? ['output'] as const : ['stdout', 'stderr'] as const) bytes += (await stat(this.logPath(job, stream))).size;
    return bytes;
  }
  async workspaceBytes(workspace: Workspace): Promise<number> {
    if (!HASH.test(workspace.hash)) throw new ToolError('UNSAFE_PATH', 'Invalid workspace hash');
    const count = async (path: string): Promise<number> => {
      this.secure(path);
      let info;
      try { info = await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
      if (!info.isDirectory()) return info.size;
      let bytes = 0;
      for (const entry of await readdir(path)) bytes += await count(join(path, entry));
      return bytes;
    };
    return count(join(this.root, workspace.hash));
  }
  /** History of one workspace. Corrupt records are reported per job instead of failing the list. */
  async list(workspace: Workspace): Promise<{ jobs: JobSummary[]; errors: string[] }> {
    if (!HASH.test(workspace.hash)) throw new ToolError('UNSAFE_PATH', 'Invalid workspace hash');
    const root = join(this.root, workspace.hash); this.secure(root);
    const jobs: JobSummary[] = [], errors: string[] = [];
    let ids: string[];
    try { ids = await readdir(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(String(error)); return { jobs, errors }; }
    for (const id of ids) {
      try { jobs.push(await this.load(workspace, id)); }
      catch (error) { errors.push(`${id}: ${String(error)}`.slice(0, 512)); }
    }
    return { jobs, errors };
  }
  async load(workspace: Workspace, id: string): Promise<JobSummary> {
    const path = join(this.directory({ id, workspace }), 'job.json'); this.secure(path);
    const job = JSON.parse(await readFile(path, 'utf8')) as JobSummary;
    if (job?.schemaVersion !== 1 || job.id !== id || job.workspace?.hash !== workspace.hash || job.workspace.key !== workspace.key ||
      !STATES.includes(job.state) || !['pipe', 'pty'].includes(job.mode) || typeof job.command !== 'string' ||
      typeof job.ownerSessionId !== 'string' || !CLEANUP.includes(job.cleanup?.state)) throw new ToolError('CORRUPT_HISTORY', 'Unsupported or mismatched job record', id);
    return job;
  }
  async remove(job: JobSummary): Promise<void> {
    // Check disk state again; the caller's snapshot cannot authorize deleting live history.
    const stored = await this.load(job.workspace, job.id);
    if (!isTerminal(stored.state) || ['pending', 'unconfirmed'].includes(stored.cleanup.state)) throw new ToolError('JOB_OCCUPIED', 'Cannot delete an active or unconfirmed job', job.id);
    await rm(this.directory(job), { recursive: true });
  }
}
