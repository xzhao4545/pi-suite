import { fileSource, readBounded, boundedText, READ_LIMITS, type ReadPage, type ReadRequest } from '../runtime/read.ts';
import { ToolError } from '../runtime/errors.ts';
import { sanitizeText } from '../runtime/text.ts';
import type { JobReader } from './control.ts';
import type { InputRecord, JobSummary, Stream } from './types.ts';
import type { MonitorEvent } from './monitors/runtime.ts';
import { normalizeVisibleText } from './terminal/visible-text.ts';
import { passwordSafeSource } from './terminal/read.ts';

export function streamsOf(job: JobSummary): Stream[] {
  return [...job.mode === 'pty' ? ['output'] as const : ['stdout', 'stderr'] as const, 'input', ...job.monitor ? ['events'] as const : []];
}
function renderEvents(raw: string): string {
  return raw.split('\n').map(line => {
    if (!line.trim()) return line;
    let event: MonitorEvent;
    try { event = JSON.parse(line); } catch { return line; }
    return `#${event.eventId} ${event.at} ${event.triggerId} ${event.stream}: ${sanitizeText(event.lineOrDiff)}${event.detectorError ? ` · detector failed: ${event.detectorError}` : ''}`;
  }).join('\n');
}
export function renderInput(raw: string): string {
  return raw.split('\n').map(line => {
    if (!line.trim()) return line;
    let record: InputRecord;
    try { record = JSON.parse(line); } catch { return line; }
    return `${record.at} ${record.source} ${record.kind} ${record.sensitive ? '[sensitive input sent]' : JSON.stringify(record.text ?? '')}`;
  }).join('\n');
}

/** One log reader for tools, viewers and settlement previews; all offsets remain raw bytes. */
export async function readJobLog(manager: Pick<JobReader, 'logPath'>, job: JobSummary, requested: Stream | undefined, request: ReadRequest): Promise<ReadPage & {stream: Stream}> {
  const stream = requested ?? (job.mode === 'pty' ? 'output' : 'stdout'), streams = streamsOf(job);
  if (!streams.includes(stream)) throw new ToolError('UNSUPPORTED_STREAM', `${job.id} has streams ${streams.join(', ')}`, job.id);
  const pty = job.mode === 'pty' && stream === 'output';
  const render = stream === 'input' ? renderInput : stream === 'events' ? renderEvents : pty ? normalizeVisibleText : sanitizeText;
  const raw = await fileSource(manager.logPath(job, stream)), source = pty ? passwordSafeSource(raw) : raw;
  try {
    const page = await readBounded(source, request, render);
    const note = pty && job.fullScreen ? '[Full-screen terminal output; use /jobs to view the live or last screen when available.]\n' : '';
    const budget = request.limitBytes ?? READ_LIMITS.defaultBytes;
    return {...page, text: note + (pty ? boundedText(page.text, budget) : page.text), stream};
  } finally { await source.close(); }
}

/** Collected before publishing the terminal state, so one boundary gets the complete notice. */
export async function outputPreview(manager: Pick<JobReader, 'logPath'>, job: JobSummary): Promise<string> {
  const streams: Stream[] = job.mode === 'pty' ? ['output'] : ['stdout', 'stderr'];
  const parts: string[] = [];
  for (const stream of streams) {
    const page = await readJobLog(manager, job, stream, {limitBytes: Math.floor(2048 / streams.length)});
    if (page.text.trim()) parts.push(`${stream}:\n${page.text}`);
  }
  return boundedText(parts.join('\n'), 2048);
}
