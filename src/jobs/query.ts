import { paginate } from '../runtime/tools.ts';
import { bucket } from './state.ts';
import type { JobManager } from './manager.ts';
import type { InputRecord, JobSummary, Workspace } from './types.ts';
import { displayName } from './index.ts';

/** Filters shared by job_list and /jobs: same buckets and session scope as the status count. */
export type ListState = 'active' | 'finished' | 'all';
export type ListScope = 'session' | 'workspace';
export interface ListQuery { state: ListState; scope: ListScope; sessionId: string; cursor?: string; limit: number }
export interface ListRow { job: JobSummary; live: boolean; unsettled: boolean }
export interface ListResult { rows: ListRow[]; nextCursor?: string; errors: string[] }

export async function listJobs(manager: JobManager, workspace: Workspace, query: ListQuery): Promise<ListResult> {
  const { jobs, errors } = await manager.list(workspace);
  const rows = jobs.map(({ job, live }) => ({ job, live, unsettled: bucket(job, live) === 'unsettled' }))
    .filter(row => (query.scope === 'workspace' || row.job.ownerSessionId === query.sessionId) &&
      (query.state === 'all' || bucket(row.job, row.live) === query.state));
  const { page, nextCursor } = paginate(rows, row => row.job, query.cursor, query.limit);
  return { rows: page, nextCursor, errors };
}

export function jobDetail(job: JobSummary): string[] {
  return [
    `name: ${displayName(job)}`, `cwd: ${job.cwd}`,
    `command: ${job.command.length > 2000 ? `${job.command.slice(0, 2000)}… [${job.command.length} chars]` : job.command}`,
    `created ${job.createdAt}${job.startedAt ? ` · started ${job.startedAt}` : ''}${job.endedAt ? ` · ended ${job.endedAt}` : ''}`,
    ...(job.timeoutMs ? [`timeoutMs: ${job.timeoutMs}`] : []),
    `cleanup: ${job.cleanup.state}${job.cleanup.error ? ` (${job.cleanup.error})` : ''}`,
    ...(job.error ? [`error: ${job.error}`] : []),
    ...(job.taskId ? [`task: ${job.taskId}`] : []),
    ...(job.creator ? [`created by ${job.creator.agentId} ${job.creator.runId}`] : []),
  ];
}

/** input.jsonl as one readable line per record; sensitive records show only that input was sent. */
export function renderInput(raw: string): string {
  return raw.split('\n').map(line => {
    if (!line.trim()) return line;
    let record: InputRecord;
    try { record = JSON.parse(line); } catch { return line; }
    return `${record.at} ${record.source} ${record.kind} ${record.sensitive ? '[sensitive input sent]' : JSON.stringify(record.text ?? '')}`;
  }).join('\n');
}
