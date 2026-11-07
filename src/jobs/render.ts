import { truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { JobSummary } from './types.ts';

type JobDetails = { job: JobSummary; attach?: string };
type JobArgs = { id: string };
type StartArgs = { name?: string; command?: string; mode?: string };
type ReadArgs = JobArgs & { stream?: string };
type ReadDetails = { id: string; stream: string; offset: number; nextOffset: number; totalBytes: number; matches?: number };
type WriteArgs = JobArgs & { input?: string; keys?: string[]; paste?: string; submit?: boolean; endInput?: boolean; sensitive?: boolean };
const name = (job: JobSummary) => job.name || job.command.split('\n')[0];
export const startRenderers = toolRenderers<StartArgs, JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: truncateToWidth(args.name ?? args.command?.split('\n')[0] ?? 'agent', 60), meta: [args.mode ?? 'pipe'] }),
  collapsed: ({ job, attach }) => ({ ...stateLine(job.state), title: job.id, summary: name(job),
    meta: [job.mode, ...job.timeoutMs ? [`timeout ${job.timeoutMs / 1000}s`] : [],
      ...attach ? [attach === 'transfer' ? 'screen returned' : 'left terminal'] : []] }),
  expanded: ({ job }, _args, text) => [`command: ${job.command}`, `cwd: ${job.cwd}`,
    ...job.timeoutMs ? [`timeout: ${job.timeoutMs}ms`] : [], ...job.taskId ? [`task: ${job.taskId}`] : [], text].map(sanitizeText),
});
export const listRenderers = toolRenderers<{ state?: string; scope?: string }, { jobs: JobSummary[]; nextCursor?: string; errors: string[] }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Jobs' }),
  collapsed: (data, args) => ({ icon: '', title: 'Jobs', summary: `${data.jobs.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: (data) => [...data.jobs.map(job => `${stateLine(job.state).icon} ${job.id} · ${name(job)} · ${((job.elapsedMs ?? Date.now() - Date.parse(job.startedAt ?? job.createdAt)) / 1000).toFixed(1)}s${job.error ? ` · ${job.error}` : ''}`),
    ...data.errors.map(error => `history error: ${error}`), ...data.nextCursor ? ['More jobs · next page available'] : []].map(sanitizeText),
});
export const getRenderers = toolRenderers<JobArgs, JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: args.id }),
  collapsed: ({ job }) => ({ ...stateLine(job.state), title: job.id, summary: `${name(job)} · ${job.state}`, meta: job.error ? ['error'] : [] }),
});
export const readRenderers = toolRenderers<ReadArgs, ReadDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job read', summary: args.id, meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: 'Job read', summary: `${data.id} · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B`, meta: data.matches !== undefined ? [`${data.matches} matches`] : [] }),
});
export const writeRenderers = toolRenderers<WriteArgs, JobDetails>({
  // Never put input into a call line, including the host's expanded call slot.
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job input', summary: args.id }),
  // Use the acknowledged byte count, including when compaction removed the call arguments.
  collapsed: ({ job }, args, text) => ({ icon: '', title: 'Job input', summary: `${job.id} · sent ${/sent (\d+) bytes/.exec(text)![1]} B`, meta: args.endInput ? ['stdin closed'] : [] }),
  expanded: (_data, args, text) => [args.sensitive ? '[sensitive]' : args.keys ? `keys: ${args.keys.join(' ')}` : args.paste !== undefined ? `paste: ${args.paste}` : `input: ${args.input ?? ''}`, text].map(sanitizeText),
});
export const stopRenderers = toolRenderers<JobArgs, StopOutcome & JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job stop', summary: args.id }),
  collapsed: data => ({ ...data.requested ? stateLine(data.state) : { icon: '', tone: undefined }, title: data.job.id,
    summary: data.requested ? `${data.state} · cleanup ${data.cleanup === 'managed_scope_confirmed' ? 'confirmed' : data.cleanup}` : 'already settled' }),
});
