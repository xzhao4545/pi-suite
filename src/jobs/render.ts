import type { MessageRenderer } from '@earendil-works/pi-coding-agent';
import { Box, truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { readingText } from '../ui/reading.ts';
import { readPageFields } from '../ui/rendering/read-page.ts';
import { toolRenderers, toolLine, stateLine, type ToolExpandedRow, type ToolLine } from '../ui/tool-render.ts';
import type { ReadPage } from '../runtime/read.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { JobSummary } from './types.ts';

export const JOB_SCREEN = 'pi-suite:job-screen';
export type JobScreenDetails = Pick<JobSummary, 'id' | 'state'> & { screenLines: string[] };
type JobDetails = { job: JobSummary; attach?: string; screenLines?: string[] };

const screenCaption = ({ id, state }: Pick<JobScreenDetails, 'id' | 'state'>): ToolLine => ({
  icon: '', title: 'Job screen', summary: id, meta: [{ text: state, tone: stateLine(state).tone! }],
});
// Keep a terminal row a row, including indentation and blank rows. Never reflow it as Markdown.
const screenBody = (screenLines: string[]) => {
  const lines = screenLines.map(sanitizeText);
  return readingText(() => lines);
};
export const jobScreenRenderer: MessageRenderer<JobScreenDetails> = ({ details }, { expanded, outputPad }, theme) => {
  // A persisted transfer can predate structured details; let Pi show its original content.
  if (!details?.screenLines) return;
  const box = new Box(outputPad, 0, text => theme.bg('customMessageBg', text));
  box.addChild(readingText(width => [toolLine(theme, screenCaption(details), width)]));
  if (expanded) box.addChild(screenBody(details.screenLines));
  return box;
};
type JobArgs = { id: string };
type StartArgs = { name?: string; command?: string; mode?: string };
type ReadArgs = JobArgs & { stream?: string };
type ReadDetails = ReadPage & { id: string; stream: string; stderrBytes?: number };
type WriteArgs = JobArgs & { input?: string; keys?: string[]; paste?: string; sensitive?: boolean };
// Saved receipts from before these fields were recorded still have a job ID.
type WriteDetails = JobDetails & { bytesSent?: number; stdinClosed?: boolean };
const name = (job: JobSummary) => job.name || job.command.split('\n')[0];
const cleanupTone = (cleanup: string) => cleanup === 'pending' || cleanup === 'unconfirmed' ? 'warning' as const : 'dim' as const;
function jobFields(job: JobSummary): ToolExpandedRow[] {
  return [
    // Jobs execute through Pi's Bash selection (including Git Bash/WSL on Windows).
    { command: job.command, shell: 'bash', label: 'command' }, { label: 'cwd', value: job.cwd },
    ...job.timeoutMs ? [{ label: 'timeout', value: `${job.timeoutMs}ms` }] : [],
    ...job.taskId ? [{ label: 'task', value: `${job.taskId} · source generation: ${job.taskGeneration ?? 'unavailable (legacy link expired)'}` }] : [],
    { label: 'state', value: job.state, tone: stateLine(job.state).tone },
    { label: 'cleanup', value: job.cleanup.state, tone: cleanupTone(job.cleanup.state) },
    ...job.cleanup.error ? [{ label: 'cleanup error', value: job.cleanup.error, tone: 'warning' as const }] : [],
    ...job.error ? [{ label: 'error', value: job.error, tone: 'error' as const }] : [],
  ];
}
export const startRenderers = toolRenderers<StartArgs, JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: truncateToWidth(args.name ?? args.command?.split('\n')[0] ?? 'agent', 60), meta: [args.mode ?? 'pipe'] }),
  collapsed: ({ job, attach, screenLines }) => screenLines ? screenCaption(job) : ({ ...stateLine(job.state), title: job.id, summary: name(job),
    meta: [{ text: job.state, tone: stateLine(job.state).tone! }, job.mode, ...job.timeoutMs ? [`timeout ${job.timeoutMs / 1000}s`] : [],
      ...attach ? [attach === 'transfer' ? 'screen returned' : 'left terminal'] : []] }),
  expanded: ({ job, screenLines }, _args, text) => screenLines ? screenBody(screenLines) : [...jobFields(job), text],
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
export const getRenderers = toolRenderers<JobArgs, JobDetails & { live: boolean }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job', summary: args.id }),
  collapsed: ({ job }) => ({ ...stateLine(job.state), title: job.id, summary: name(job),
    meta: [{ text: job.state, tone: stateLine(job.state).tone! }, ...job.error ? [{ text: 'error', tone: 'error' as const }] : []] }),
  expanded: ({ job, live }) => [...jobFields(job), { label: 'live', value: String(live) },
    { code: JSON.stringify(job, null, 2), language: 'json', label: 'details' }],
});
export const readRenderers = toolRenderers<ReadArgs, ReadDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job read', summary: args.id, meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: 'Job read', summary: `${data.id} · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B`, meta: data.matches !== undefined ? [`${data.matches} matches`] : [] }),
  expanded: data => [...readPageFields(data),
    ...data.stderrBytes !== undefined ? [{ label: 'stderrBytes', value: String(data.stderrBytes) }] : [], data.text],
});
export const writeRenderers = toolRenderers<WriteArgs, WriteDetails>({
  // Never put input into a call line, including the host's expanded call slot.
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job input', summary: args.id }),
  // Successful receipts contain only counts. Redact diagnostics, not coincidental receipt words.
  redact: (args, text, isError) => args.sensitive && isError ? [args.input, args.paste, ...(args.keys ?? [])].reduce<string>((shown, value) =>
    value && sanitizeText(value) ? shown.replaceAll(sanitizeText(value), '[sensitive]') : shown, text) : text,
  collapsed: ({ job, bytesSent, stdinClosed }) => ({ icon: '', title: 'Job input',
    summary: bytesSent === undefined ? job.id : `${job.id} · sent ${bytesSent} B`, meta: stdinClosed ? ['stdin closed'] : [] }),
  expanded: ({ bytesSent, stdinClosed }, args) => [{ label: args.keys ? 'keys' : args.paste !== undefined ? 'paste' : 'input',
    value: args.sensitive ? '[sensitive]' : args.keys ? args.keys.join(' ') : args.paste ?? args.input ?? '' },
    ...bytesSent !== undefined ? [{ label: 'bytesSent', value: String(bytesSent) }] : [],
    ...stdinClosed !== undefined ? [{ label: 'stdinClosed', value: String(stdinClosed) }] : []],
});
export const stopRenderers = toolRenderers<JobArgs, StopOutcome & JobDetails>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Job stop', summary: args.id }),
  collapsed: data => ({ ...data.requested ? stateLine(data.state) : { icon: '', tone: undefined }, title: data.job.id,
    summary: data.requested ? data.state : 'already settled',
    meta: [{ text: `cleanup ${data.cleanup === 'managed_scope_confirmed' ? 'confirmed' : data.cleanup}`, tone: cleanupTone(data.cleanup) }] }),
  expanded: data => [...jobFields(data.job), { label: 'requested', value: String(data.requested) },
    { code: JSON.stringify(data.affected, null, 2), language: 'json', label: 'affected' }],
});
