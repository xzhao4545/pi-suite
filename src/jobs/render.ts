import { truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { toolRenderers, stateLine, type ToolExpandedRow } from '../ui/tool-render.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { JobSummary } from './types.ts';

type JobDetails = { job: JobSummary; attach?: string };
type JobArgs = { id: string };
type StartArgs = { name?: string; command?: string; mode?: string };
type ReadArgs = JobArgs & { stream?: string };
type ReadDetails = { id: string; stream: string; offset: number; nextOffset: number; totalBytes: number; matches?: number };
type WriteArgs = JobArgs & { input?: string; keys?: string[]; paste?: string; submit?: boolean; endInput?: boolean; sensitive?: boolean };
const name = (job: JobSummary) => job.name || job.command.split('\n')[0];
const cleanupTone = (cleanup: string) => cleanup === 'pending' || cleanup === 'unconfirmed' ? 'warning' as const : 'dim' as const;
function jobFields(job: JobSummary, text: string): ToolExpandedRow[] {
  return [
    // Jobs execute through Pi's Bash selection (including Git Bash/WSL on Windows).
    { command: job.command, shell: 'bash', label: 'command' }, { label: 'cwd', value: job.cwd },
    ...job.timeoutMs ? [{ label: 'timeout', value: `${job.timeoutMs}ms` }] : [],
    ...job.taskId ? [{ label: 'task', value: job.taskId }] : [],
    { label: 'state', value: job.state, tone: stateLine(job.state).tone },
    { label: 'cleanup', value: job.cleanup.state, tone: cleanupTone(job.cleanup.state) },
    ...job.cleanup.error ? [{ label: 'cleanup error', value: job.cleanup.error, tone: 'warning' as const }] : [],
    ...job.error ? [{ label: 'error', value: job.error, tone: 'error' as const }] : [], text,
  ];
}
export const startRenderers = toolRenderers<StartArgs, JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: truncateToWidth(args.name ?? args.command?.split('\n')[0] ?? 'agent', 60), meta: [args.mode ?? 'pipe'] }),
  collapsed: ({ job, attach }) => ({ ...stateLine(job.state), title: job.id, summary: name(job),
    meta: [{ text: job.state, tone: stateLine(job.state).tone! }, job.mode, ...job.timeoutMs ? [`timeout ${job.timeoutMs / 1000}s`] : [],
      ...attach ? [attach === 'transfer' ? 'screen returned' : 'left terminal'] : []] }),
  expanded: ({ job }, _args, text) => jobFields(job, text),
});
export const listRenderers = toolRenderers<{ state?: string; scope?: string }, { jobs: JobSummary[]; nextCursor?: string; errors: string[] }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Jobs' }),
  collapsed: (data, args) => ({ icon: '', title: 'Jobs', summary: `${data.jobs.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: data => [...data.jobs.flatMap(job => [
    { ...stateLine(job.state), title: job.id, summary: name(job), meta: [{ text: job.state, tone: stateLine(job.state).tone! },
      `${((job.elapsedMs ?? Date.now() - Date.parse(job.startedAt ?? job.createdAt)) / 1000).toFixed(1)}s`,
      { text: `cleanup ${job.cleanup.state}`, tone: cleanupTone(job.cleanup.state) }] },
    ...job.error ? [{ label: 'error', value: job.error, tone: 'error' as const }] : [],
  ]), ...data.errors.map(error => ({ label: 'history error', value: error, tone: 'error' as const })),
    ...data.nextCursor ? [{ label: 'more', value: 'next page available', tone: 'warning' as const }] : []],
});
export const getRenderers = toolRenderers<JobArgs, JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: args.id }),
  collapsed: ({ job }) => ({ ...stateLine(job.state), title: job.id, summary: name(job),
    meta: [{ text: job.state, tone: stateLine(job.state).tone! }, ...job.error ? [{ text: 'error', tone: 'error' as const }] : []] }),
  expanded: ({ job }, _args, text) => [...jobFields(job, text), { code: JSON.stringify(job, null, 2), language: 'json', label: 'details' }],
});
export const readRenderers = toolRenderers<ReadArgs, ReadDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job read', summary: args.id, meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: 'Job read', summary: `${data.id} · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B`, meta: data.matches !== undefined ? [`${data.matches} matches`] : [] }),
});
export const writeRenderers = toolRenderers<WriteArgs, JobDetails>({
  // Never put input into a call line, including the host's expanded call slot.
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job input', summary: args.id }),
  // Successful receipts contain only counts, never input. Redact diagnostics, not coincidental
  // receipt words (e.g. a sensitive input literally named "sent" must not break byte parsing).
  redact: (args, text, isError) => args.sensitive && isError ? [args.input, args.paste, ...(args.keys ?? [])].reduce<string>((shown, value) =>
    value && sanitizeText(value) ? shown.replaceAll(sanitizeText(value), '[sensitive]') : shown, text) : text,
  // Use the acknowledged byte count, including when compaction removed the call arguments.
  collapsed: ({ job }, args, text) => ({ icon: '', title: 'Job input', summary: `${job.id} · sent ${/sent (\d+) bytes/.exec(text)![1]} B`, meta: args.endInput ? ['stdin closed'] : [] }),
  expanded: (_data, args, text) => [{ label: args.keys ? 'keys' : args.paste !== undefined ? 'paste' : 'input',
    value: args.sensitive ? '[sensitive]' : args.keys ? args.keys.join(' ') : args.paste ?? args.input ?? '' }, text],
});
export const stopRenderers = toolRenderers<JobArgs, StopOutcome & JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job stop', summary: args.id }),
  collapsed: data => ({ ...data.requested ? stateLine(data.state) : { icon: '', tone: undefined }, title: data.job.id,
    summary: data.requested ? data.state : 'already settled',
    meta: [{ text: `cleanup ${data.cleanup === 'managed_scope_confirmed' ? 'confirmed' : data.cleanup}`, tone: cleanupTone(data.cleanup) }] }),
  expanded: (data, _args, text) => [...jobFields(data.job, text),
    { code: JSON.stringify(data.affected, null, 2), language: 'json', label: 'affected' }],
});
