import { paginate } from '../runtime/tools.ts';
import { bucket } from './state.ts';
import type { JobReader } from './control.ts';
import { isWorkflowGate, type JobSummary, type Workspace } from './types.ts';
import { displayName } from './index.ts';
export { readJobLog, renderInput, streamsOf } from './output.ts';

/** Filters shared by job_list and /jobs: same buckets and session scope as the status count. */
export type ListState = 'active' | 'finished' | 'all';
export type ListScope = 'session' | 'workspace';
export interface ListQuery { state: ListState; scope: ListScope; sessionId: string; cursor?: string; limit: number }
export interface ListRow { job: JobSummary; live: boolean; unsettled: boolean }
export interface ListResult { rows: ListRow[]; nextCursor?: string; errors: string[] }
export interface SessionScope { jobs(): JobSummary[]; visible(job: JobSummary): boolean }

export async function listJobs(manager: JobReader, workspace: Workspace, query: ListQuery, session?: SessionScope): Promise<ListResult> {
  const { jobs, errors } = await manager.list(workspace);
  const merged = new Map(jobs.map(row => [row.job.id, row]));
  // Storage yields to lifecycle changes; use current owned views when merging live jobs.
  if (query.scope === 'session') for (const job of session?.jobs() ?? []) merged.set(job.id, {job, live: true});
  const rows = [...merged.values()].map(({ job, live }) => ({ job, live, unsettled: bucket(job, live) === 'unsettled' }))
    .filter(row => !isWorkflowGate(row.job) && (query.scope === 'workspace' || (session ? session.visible(row.job) : row.job.ownerSessionId === query.sessionId)) &&
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
    ...(job.handsFree ? [`supervision: ${job.handsFree.config.mode} · updates ${job.handsFree.updates} · output budget ${job.handsFree.totalCharsSent}/${job.handsFree.config.maxTotalChars} chars`] : []),
    `cleanup: ${job.cleanup.state}${job.cleanup.error ? ` (${job.cleanup.error})` : ''}`,
    ...(job.error ? [`error: ${job.error}`] : []),
    ...(job.taskId ? [`task: ${job.taskId}`] : []),
    ...(job.creator ? [`created by ${job.creator.agentId ?? job.creator.workflowId} ${job.creator.runId}`] : []),
  ];
}
