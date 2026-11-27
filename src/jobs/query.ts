import { paginate } from '../runtime/tools.ts';
import { boundedText } from '../runtime/read.ts';
import { bucket } from './state.ts';
import type { JobReader } from './control.ts';
import { isWorkflowGate, type JobSummary, type Workspace } from './types.ts';
import { displayName, summaryLine } from './index.ts';
import { field, part, plainDetailLines, statePart, type StructuredDetails } from '../ui/structured-details.ts';
export { readJobLog, renderInput, streamsOf } from './output.ts';

/** Filters shared by job_list and /jobs: same buckets and session scope as the status count. */
export type ListState = 'active' | 'finished' | 'all';
export type ListScope = 'session' | 'workspace';
export interface ListQuery { state: ListState; scope: ListScope; sessionId: string; cursor?: string; limit: number; budgetBytes?: number }
export interface ListRow { job: JobSummary; live: boolean; unsettled: boolean }
export interface ListResult { rows: ListRow[]; nextCursor?: string; errors: string[] }
export interface SessionScope { jobs(): JobSummary[]; visible(job: JobSummary): boolean }

export function selectJobRows(jobs: { job: JobSummary; live: boolean }[], query: Pick<ListQuery, 'scope' | 'state' | 'sessionId'>, session?: SessionScope): ListRow[] {
  const merged = new Map(jobs.map(row => [row.job.id, row]));
  // Storage yields to lifecycle changes; use current owned views when merging live jobs.
  if (query.scope === 'session') for (const job of session?.jobs() ?? []) merged.set(job.id, {job, live: true});
  return [...merged.values()].map(({ job, live }) => ({ job, live, unsettled: bucket(job, live) === 'unsettled' }))
    .filter(row => !isWorkflowGate(row.job) && (query.scope === 'workspace' || (session ? session.visible(row.job) : row.job.ownerSessionId === query.sessionId)) &&
      (query.state === 'all' || bucket(row.job, row.live) === query.state));
}
export async function listJobs(manager: JobReader, workspace: Workspace, query: ListQuery, session?: SessionScope): Promise<ListResult> {
  const { jobs, errors } = await manager.list(workspace);
  const { page, nextCursor } = paginate(selectJobRows(jobs, query, session), row => row.job, query.cursor, query.limit,
    { budgetBytes: query.budgetBytes, size: row => Buffer.byteLength(summaryLine(row.job) + boundedText(displayName(row.job), 200) + (row.job.error ?? '')) + 80 });
  return { rows: page, nextCursor, errors };
}
/** One field list feeds both the model-visible receipt and the colored Details pane. */
export function jobDetailView(job: JobSummary, fullCommand = false): StructuredDetails {
  const command = !fullCommand && job.command.length > 2000 ? `${job.command.slice(0, 2000)}… [${job.command.length} chars]` : job.command;
  const {cleanup} = job;
  const exit = job.exitCode ?? job.signal;
  const details: StructuredDetails = {rows: [
    field('name:', part(displayName(job), 'heading')), field('cwd:', part(job.cwd, 'meta')),
    field('mode:', job.mode), field('state:', statePart(job.state)),
    field('runtime:', job.elapsedMs === undefined ? 'not started' : part(`${(job.elapsedMs / 1000).toFixed(1)}s`, 'number')), null,
    field('command:', command), null,
    field('created', part(job.createdAt, 'meta'),
      ...(job.startedAt ? [part(' · started ', 'label'), part(job.startedAt, 'meta')] : []),
      ...(job.endedAt ? [part(' · ended ', 'label'), part(job.endedAt, 'meta')] : [])),
    job.exitCode !== null || job.signal ? field('exit:', part(`${exit}`, typeof exit === 'number' ? 'number' : undefined)) : undefined,
    job.timeoutMs ? field('timeoutMs:', part(job.timeoutMs, 'number')) : undefined,
    job.handsFree ? field('supervision:', job.handsFree.config.mode, part(' · updates ', 'label'), part(job.handsFree.updates, 'number'),
      part(' · output budget ', 'label'), part(`${job.handsFree.totalCharsSent}/${job.handsFree.config.maxTotalChars} chars`, 'number')) : undefined,
    field('cleanup:', statePart(cleanup.state, cleanup.state === 'pending' ? 'cleanup pending' : cleanup.state === 'unconfirmed' ? 'cleanup unconfirmed' : 'completed'),
      ...(cleanup.error ? [part(` (${cleanup.error})`, 'error')] : [])),
    ...(job.error ? [null, field('error:', part(job.error, 'error'))] : []), null,
    job.taskId ? field('task:', part(job.taskId, 'id'), part(' · source generation: ', 'label'), part(job.taskGeneration ?? 'unavailable (legacy link expired)', 'id')) : undefined,
    job.creator ? field('created by', part(`${job.creator.agentId ?? job.creator.workflowId}`, 'id'), part(' '), part(job.creator.runId, 'id')) : undefined,
  ]};
  return details;
}
export const jobDetail = (job: JobSummary, fullCommand = false): string[] => plainDetailLines(jobDetailView(job, fullCommand));

export function jobViewerDetails(job: JobSummary, live = true): StructuredDetails {
  return {rows: [field('ID:', part(job.id, 'id')), ...jobDetailView(job, true).rows,
    live ? undefined : [part('history only: not controlled by this Pi process', 'meta')]]};
}
