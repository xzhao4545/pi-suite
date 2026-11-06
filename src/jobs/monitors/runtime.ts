// Matching, cooldown, dedupe, poll-diff summary and detector protocol adapted from
// pi-interactive-shell 0.18.0 headless-monitor.ts and index.ts (MIT,
// third-party/licenses/pi-interactive-shell.txt). pi-suite changes: the monitor tails the job's
// own log files, so pipe and PTY jobs share it and the logs stay the single source of output.
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { normalizeVisibleText } from '../terminal/visible-text.ts';
import { sanitizeText } from '../../runtime/text.ts';
import type { ResolvedShellConfig } from '../terminal/shell.ts';
import { POLL_BOUNDARY, type CompiledMonitor, type Strategy } from './compile.ts';

export type MonitorEvent = {
  eventId: number; at: string; strategy: Strategy; triggerId: string; matchedText: string; lineOrDiff: string;
  stream: 'stdout' | 'stderr' | 'output';
  /** The detector failed; the candidate is delivered with the error instead of being dropped. */
  detectorError?: string;
};
type Candidate = Omit<MonitorEvent, 'eventId' | 'at'>;
type Source = { path: string; stream: MonitorEvent['stream']; pty: boolean; offset: number; decoder: StringDecoder; partial: string };
const TAIL_MS = 250;

function summarizeDiff(previous: string, current: string): string {
  if (!previous) return `Output changed: now has content (${current.length} chars)`;
  if (!current) return 'Output changed: now empty';
  const before = previous.split('\n'), after = current.split('\n');
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (before[index] === after[index]) continue;
    const clip = (line = '') => line.length > 120 ? `${line.slice(0, 117)}...` : line;
    return `Output changed at line ${index + 1}: "${clip(before[index])}" -> "${clip(after[index])}"`;
  }
  return 'Output changed';
}

async function runDetector(detector: NonNullable<CompiledMonitor['detector']>, candidate: Candidate, shell: ResolvedShellConfig, cwd: string): Promise<Partial<Candidate> & { emit: boolean }> {
  const exited = Promise.withResolvers<number | null>();
  const child = spawn(shell.shell, [...shell.args, detector.command], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => { child.kill(); exited.reject(new Error(`detector timed out after ${detector.timeoutMs}ms`)); }, detector.timeoutMs);
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.once('error', exited.reject);
  child.once('exit', exited.resolve);
  child.stdin.end(`${JSON.stringify(candidate)}\n`);
  let code: number | null;
  try { code = await exited.promise; } finally { clearTimeout(timer); }
  if (code !== 0) throw new Error(`detector exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
  if (!stdout.trim()) return { emit: true };
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch (error) { throw new Error(`detector returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (typeof parsed === 'boolean') return { emit: parsed };
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('detector decision must be true, false or an object');
  const decision = parsed as Record<string, unknown>;
  const fields: Partial<Candidate> = {};
  for (const key of ['triggerId', 'matchedText', 'lineOrDiff'] as const) {
    if (decision[key] === undefined) continue;
    if (typeof decision[key] !== 'string') throw new Error(`detector decision ${key} must be a string`);
    fields[key] = decision[key];
  }
  return { ...fields, emit: decision.emit !== false };
}

/**
 * Watches one job's output for trigger matches. stream and file-watch match each complete line;
 * poll-diff compares complete OSC-delimited iterations (including stderr), not wall-clock windows.
 * Candidates pass cooldown and dedupe, then the optional detector, in order; record() persists and notifies.
 */
export class JobMonitor {
  private timer: NodeJS.Timeout;
  private queue = Promise.resolve();
  private lastFired = new Map<string, number>();
  private seen = new Set<string>();
  private previous?: string;
  private reading?: Promise<void>;

  constructor(private config: CompiledMonitor, private sources: Source[], private shell: ResolvedShellConfig, private cwd: string,
    private record: (candidate: Candidate) => void) {
    this.timer = setInterval(() => { void this.tick(); }, TAIL_MS);
    this.timer.unref();
  }
  static sources(entries: { path: string; stream: MonitorEvent['stream'] }[], pty: boolean): Source[] {
    return entries.map(entry => ({ ...entry, pty, offset: 0, decoder: new StringDecoder('utf8'), partial: '' }));
  }

  private tick(final = false): Promise<void> {
    // One read at a time: a slow disk must not interleave two reads of the same offset.
    return this.reading ??= this.readNew(final).finally(() => { this.reading = undefined; });
  }
  private async readNew(final: boolean): Promise<void> {
    for (const source of this.sources) {
      const file = await open(source.path, 'r');
      let text = '';
      try {
        const { size } = await file.stat();
        if (size > source.offset) {
          const buffer = Buffer.alloc(size - source.offset);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, source.offset);
          source.offset += bytesRead;
          text = source.decoder.write(buffer.subarray(0, bytesRead));
        }
      } finally { await file.close(); }
      if (final) text += source.decoder.end();
      this.accept(source, text, final);
    }
  }
  private accept(source: Source, text: string, final: boolean): void {
    if (this.config.strategy === 'poll-diff') {
      // Keep incomplete markers/output across disk reads. A stop in the middle of an iteration
      // must not turn its partial output into a spurious final change.
      const samples = (source.partial + text).split(POLL_BOUNDARY);
      source.partial = final ? '' : samples.pop()!;
      if (final) samples.pop();
      for (const raw of samples) {
        const sample = raw.split(/\r?\n/).map(line =>
          (source.pty ? normalizeVisibleText(line) : sanitizeText(line)).trimEnd()).filter(Boolean).join('\n');
        this.pollSample(sample, source.stream);
      }
      return;
    }
    const lines = (source.partial + text).split(/\r?\n/);
    source.partial = final ? '' : lines.pop()!;
    for (const raw of lines) {
      // PTY lines replay CR overwrites to the final visible text; pipe lines drop control bytes.
      const line = (source.pty ? normalizeVisibleText(raw) : sanitizeText(raw)).trimEnd();
      if (!line) continue;
      this.match(line, line, source.stream);
    }
  }
  private pollSample(sample: string, stream: MonitorEvent['stream']): void {
    // The first sample is the baseline; afterwards only a changed sample can fire.
    if (this.previous === undefined || sample === this.previous) { this.previous ??= sample; return; }
    const diff = summarizeDiff(this.previous, sample);
    this.previous = sample;
    this.match(sample, diff, stream);
  }
  private match(text: string, lineOrDiff: string, stream: MonitorEvent['stream']): void {
    for (const trigger of this.config.triggers) {
      const matchedText = trigger.match(text);
      if (matchedText === undefined) continue;
      const cooldown = trigger.cooldownMs ?? this.config.cooldownMs ?? 0, now = Date.now();
      if (cooldown > 0 && now - (this.lastFired.get(trigger.id) ?? -Infinity) < cooldown) continue;
      const key = `${trigger.id}\u0000${lineOrDiff}`;
      if (this.config.dedupe && this.seen.has(key)) continue;
      this.lastFired.set(trigger.id, now); this.seen.add(key);
      this.decide({ strategy: this.config.strategy, triggerId: trigger.id, matchedText, lineOrDiff, stream });
    }
  }
  private decide(candidate: Candidate): void {
    const detector = this.config.detector;
    if (!detector) { this.record(candidate); return; }
    this.queue = this.queue.then(async () => {
      try {
        const decision = await runDetector(detector, candidate, this.shell, this.cwd);
        if (decision.emit) this.record({ ...candidate, ...decision, strategy: candidate.strategy, stream: candidate.stream });
      } catch (error) { this.record({ ...candidate, detectorError: error instanceof Error ? error.message : String(error) }); }
    });
  }
  /** After the job's logs are flushed: read the rest, match the last partial lines, drain detectors. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.reading;
    await this.tick(true);
    await this.queue;
  }
}
