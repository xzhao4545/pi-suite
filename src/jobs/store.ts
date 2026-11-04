import { lstatSync, realpathSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { open, readdir, readFile, writeFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { resolve, join, relative, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isTerminal } from './state.ts';
import { JobError, LIMITS, type JobSummary, type LogRequest, type LogPage, type Workspace, type JobListReport, type JobDiagnostic } from './types.ts';

const JOB_ID = /^job_[a-f0-9]{32}$/;
const RUN_ID = /^run_[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function sanitize(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export class JobStore {
  private base: string;
  private root: string;
  constructor(agentDir: string) {
    this.base = realpathSync(agentDir);
    this.root = join(this.base, 'background-jobs');
  }
  // Also used during synchronous process exit. Reject links at every owned level.
  private secure(path: string, createDirs = false): void {
    if (!contained(this.root, path)) throw new JobError('UNSAFE_PATH', 'Task path leaves managed directory');
    const pieces = relative(this.base, path).split(sep).filter(Boolean);
    let current = this.base;
    for (const piece of pieces) {
      current = join(current, piece);
      try {
        const info = lstatSync(current);
        if (info.isSymbolicLink() || !contained(this.base, realpathSync(current))) throw new JobError('UNSAFE_PATH', 'Managed path redirected by a link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (createDirs) mkdirSync(current, { mode: 0o700 });
        else break;
      }
    }
  }
  private directory(job: JobSummary): string {
    if (!JOB_ID.test(job.jobId) || !RUN_ID.test(job.ownerRuntimeId) || !HASH.test(job.workspace.hash)) throw new JobError('UNSAFE_PATH', 'Invalid internal job identity');
    const dir = join(this.root, job.workspace.hash, job.ownerRuntimeId, job.jobId);
    if (resolve(job.stdoutPath) !== join(dir, 'stdout.log') || resolve(job.stderrPath) !== join(dir, 'stderr.log')) throw new JobError('UNSAFE_PATH', 'Unexpected log path');
    this.secure(dir);
    return dir;
  }
  async create(job: JobSummary): Promise<void> {
    const dir = this.directory(job);
    this.secure(dir, true);
    try {
      for (const path of [job.stdoutPath, job.stderrPath]) { this.secure(path); await writeFile(path, '', { flag: 'wx', mode: 0o600 }); }
      await this.saveMeta(job);
    } catch (error) { throw new JobError('STORAGE_ERROR', String(error), job.jobId); }
  }
  private async save(job: JobSummary, file: string): Promise<void> {
    const dir = this.directory(job), dest = join(dir, file), temp = join(dir, `.${randomUUID()}.tmp`);
    this.secure(dest);
    try {
      await writeFile(temp, JSON.stringify(job), { flag: 'wx', mode: 0o600 });
      await rename(temp, dest);
    } catch (error) { throw new JobError('STORAGE_ERROR', String(error), job.jobId); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async saveMeta(job: JobSummary): Promise<void> { await this.save(job, 'meta.json'); }
  async saveResult(job: JobSummary): Promise<void> { await this.save(job, 'result.json'); }
  saveResultSync(job: JobSummary): void {
    const dir = this.directory(job), dest = join(dir, 'result.json'), temp = join(dir, `.${randomUUID()}.tmp`);
    this.secure(dest);
    try { writeFileSync(temp, JSON.stringify(job), { flag: 'wx', mode: 0o600 }); renameSync(temp, dest); }
    catch (error) { throw new JobError('STORAGE_ERROR', String(error), job.jobId); }
    finally { try { unlinkSync(temp); } catch {} }
  }
  async readLogs(job: JobSummary, request: LogRequest): Promise<LogPage> {
    const limit = request.limitBytes ?? LIMITS.defaultReadBytes;
    if (!['stdout','stderr'].includes(request.stream) || !Number.isInteger(limit) || limit < 4 || limit > LIMITS.maxReadBytes ||
      (request.offset !== undefined && (!Number.isSafeInteger(request.offset) || request.offset < 0)) ||
      (request.tail !== undefined && typeof request.tail !== 'boolean') || (request.tail !== undefined && request.offset !== undefined)) {
      throw new JobError('INVALID_LOG_REQUEST', 'Invalid stream, offset, tail or read limit');
    }
    this.directory(job);
    const path = request.stream === 'stdout' ? job.stdoutPath : job.stderrPath;
    this.secure(path);
    const checked = lstatSync(path);
    if(!checked.isFile() || checked.nlink !== 1)throw new JobError('UNSAFE_PATH','Log must be an unlinked regular file');
    const file = await open(path, 'r');
    try {
      const opened=await file.stat();this.secure(path);
      const current=lstatSync(path);
      if(!opened.isFile()||opened.nlink!==1||opened.dev!==checked.dev||opened.ino!==checked.ino||current.dev!==opened.dev||current.ino!==opened.ino)throw new JobError('UNSAFE_PATH','Log identity changed during open');
      const size = opened.size;
      let offset = request.tail ? Math.max(0, size - limit) : Math.min(request.offset ?? 0, size);
      const buffer = Buffer.alloc(Math.min(limit + 3, size - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      let start = 0, end = Math.min(limit, bytesRead);
      const warnings: string[] = [];
      while (start < Math.min(3, bytesRead) && (buffer[start] & 0xc0) === 0x80) start++;
      if (start) warnings.push('Skipped partial UTF-8 character at offset');
      // Back off a partial trailing codepoint only if more bytes remain in the file.
      if (offset + end < size && end > start) {
        let lead = end - 1;
        while (lead > start && (buffer[lead] & 0xc0) === 0x80) lead--;
        const byte = buffer[lead];
        const length = byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 1;
        if (lead + length > end) end = lead;
      }
      end = Math.max(start, end);
      const raw = buffer.subarray(start, end);
      try { new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { warnings.push('Invalid UTF-8 replaced for display'); }
      const nextOffset = offset + end;
      offset += start;
      return { text: sanitize(raw.toString('utf8')), offset, nextOffset, endOfLog: nextOffset >= size, stream: request.stream, warnings };
    } finally { await file.close(); }
  }
  async logBytes(job: JobSummary): Promise<number> {
    this.directory(job);
    let bytes = 0;
    for (const path of [job.stdoutPath, job.stderrPath]) { this.secure(path); bytes += (await stat(path)).size; }
    return bytes;
  }
  async workspaceBytes(workspace: Workspace): Promise<number> {
    if (!HASH.test(workspace.hash)) throw new JobError('UNSAFE_PATH', 'Invalid workspace hash');
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
  private async loadJob(workspace: Workspace, runtime: string, id: string): Promise<JobSummary> {
    if (!HASH.test(workspace.hash) || !RUN_ID.test(runtime) || !JOB_ID.test(id)) throw new JobError('UNSAFE_PATH', 'Invalid history identity');
    const dir = join(this.root, workspace.hash, runtime, id); this.secure(dir);
    try {
      const meta = await this.loadJSON(join(dir, 'meta.json'));
      let result: unknown;
      try { result = await this.loadJSON(join(dir, 'result.json')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const raw of result === undefined ? [meta] : [meta, result]) this.validate(raw, workspace, runtime, id);
      const job = (result ?? meta) as JobSummary;
      this.directory(job);
      return { ...job, history: true };
    } catch (error) { throw new JobError('CORRUPT_HISTORY', `Unconfirmed history ${id}: ${String(error)}`, id); }
  }
  async listReport(workspace: Workspace): Promise<JobListReport> {
    if (!HASH.test(workspace.hash)) throw new JobError('UNSAFE_PATH', 'Invalid workspace hash');
    const root = join(this.root, workspace.hash); this.secure(root);
    const jobs: JobSummary[] = [], diagnostics: JobDiagnostic[] = [];
    const diagnose = (location: string, error: unknown, runtimeId?: string, jobId?: string) => {
      diagnostics.push({ source: 'history', code: 'CORRUPT_HISTORY',
        message: sanitize(String(error)).slice(0, 1024), location: sanitize(relative(this.root, location)).slice(0, 512), runtimeId, jobId });
    };
    let runtimes: string[];
    try { runtimes = await readdir(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnose(root, error); return { jobs, diagnostics }; }
    for (const runtime of runtimes) {
      const runtimeDir = join(root, runtime);
      try {
        if (!RUN_ID.test(runtime)) throw new Error('Unknown runtime directory');
        this.secure(runtimeDir);
        for (const id of await readdir(runtimeDir)) {
          try { jobs.push(await this.loadJob(workspace, runtime, id)); }
          catch (error) { diagnose(join(runtimeDir, id), error, runtime, JOB_ID.test(id) ? id : undefined); }
        }
      } catch (error) { diagnose(runtimeDir, error, RUN_ID.test(runtime) ? runtime : undefined); }
    }
    return { jobs, diagnostics };
  }
  async list(workspace: Workspace): Promise<JobSummary[]> {
    const report = await this.listReport(workspace);
    if (report.diagnostics.length) {
      const first = report.diagnostics[0]; throw new JobError(first.code, first.message, first.jobId);
    }
    return report.jobs;
  }
  private async loadJSON(path: string): Promise<unknown> { this.secure(path); return JSON.parse(await readFile(path,'utf8')); }
  private validate(raw: unknown, workspace: Workspace, runtime: string, id: string): asserts raw is JobSummary {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid metadata');
    const job = raw as JobSummary;
    if (job.schemaVersion !== 1 || job.jobId !== id || job.ownerRuntimeId !== runtime || job.workspace?.key !== workspace.key || job.workspace.hash !== workspace.hash ||
      !['starting','running','stopping','completed','failed','cancelled','timed_out'].includes(job.state) || typeof job.holdsLock !== 'boolean' ||
      typeof job.ownerSessionId !== 'string' || typeof job.command !== 'string' || typeof job.cwd !== 'string' || typeof job.name !== 'string' ||
      typeof job.createdAt !== 'string' || !Number.isInteger(job.timeoutSeconds) || typeof job.exclusive !== 'boolean' ||
      (job.exitCode !== null && !Number.isInteger(job.exitCode)) || !job.cleanup ||
      !['not_required','pending','managed_scope_confirmed','unconfirmed'].includes(job.cleanup.state) || !Array.isArray(job.cleanup.scope) || typeof job.cleanup.rootExited !== 'boolean' ||
      typeof job.workspace.root !== 'string' || typeof job.workspace.key !== 'string' || typeof job.history !== 'boolean' ||
      job.timeoutSeconds < 1 || job.timeoutSeconds > LIMITS.maxRunSeconds ||
      (job.stopReason !== undefined && !['user','timeout','log_limit','quit','start_aborted'].includes(job.stopReason)) ||
      [job.startedAt,job.endedAt,job.storageError,job.notificationError,job.cleanup.error].some(value=>value!==undefined&&typeof value!=='string') ||
      (job.cleanup.taskkillExitCode!==undefined&&job.cleanup.taskkillExitCode!==null&&!Number.isSafeInteger(job.cleanup.taskkillExitCode)) ||
      job.cleanup.scope.some(identity=>!identity||typeof identity!=='object'||!Number.isSafeInteger(identity.pid)||identity.pid<=0||typeof identity.createdAt!=='string')) throw new Error('Unsupported or mismatched metadata');
  }
  async remove(job: JobSummary): Promise<void> {
    if (job.holdsLock || !isTerminal(job.state) || ['pending', 'unconfirmed'].includes(job.cleanup.state)) throw new JobError('JOB_OCCUPIED', 'Cannot delete active or unconfirmed job', job.jobId);
    const dir = this.directory(job);
    // Check disk identity again; caller's snapshot cannot authorize deleting held history.
    const stored = await this.loadJob(job.workspace, job.ownerRuntimeId, job.jobId);
    if (stored.holdsLock || !isTerminal(stored.state) || ['pending', 'unconfirmed'].includes(stored.cleanup.state)) throw new JobError('JOB_OCCUPIED', 'Stored task is not safely deletable', job.jobId);
    await rm(dir, { recursive: true });
  }
}
