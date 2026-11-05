import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { DetailsView } from '../ui/details.ts';
import type { Dock } from '../ui/dock.ts';
import { fileSource, READ_LIMITS, type ReadPage } from '../runtime/read.ts';
import type { JobReader } from './control.ts';
import type { JobSummary, Stream } from './types.ts';
import { isTerminal } from './state.ts';
import { readJobLog } from './query.ts';
import { summaryLine } from './index.ts';
import { sanitizeText } from '../runtime/text.ts';

const REFRESH_MS = 250;
/** A bounded byte window over the existing log. UI readers never own or stop a process. */
export class JobLogView extends DetailsView {
  private page?: ReadPage;
  private totalBytes = 0;
  private autoFollow = true;
  private error?: string;
  private closed = false;
  private timer?: NodeJS.Timeout;
  private unsubscribe: () => void;
  private queue = Promise.resolve();

  constructor(private terminal: TUI, private manager: JobReader, private job: JobSummary,
    private stream: Stream, private live: boolean, done: () => void) {
    super(terminal, () => this.header(), new Text('Loading log…', 0, 0), done, [
      { label: 'Previous bytes', run: () => { void this.previous(); } },
      { label: 'Next bytes', run: () => { void this.next(); } },
      { label: 'Follow latest', run: () => { void this.follow(); } },
    ]);
    this.unsubscribe = live ? manager.subscribe(() => {
      if (this.closed) return;
      const wasFinished = isTerminal(this.job.state);
      this.job = manager.peek(job.id);
      // Settlement can land between a size poll and its next timer. Read the flushed final
      // output once instead of relying on a timer that now correctly stops for terminal jobs.
      if (!wasFinished && isTerminal(this.job.state)) void this.refresh();
      terminal.requestRender();
    }) : () => {};
  }
  private header(): string {
    if (this.error) return `${this.job.id} · read failed: ${this.error}`;
    const following = this.autoFollow && this.reader.atBottom && !this.reader.searching;
    return `${summaryLine(this.job)} · ${this.stream} bytes ${this.page?.offset ?? 0}-${this.page?.nextOffset ?? 0}/${this.totalBytes} · ${following ? 'following' : 'paused'}`;
  }
  private request(action: () => Promise<void>): Promise<void> {
    // Serialize pagination and refresh so a slower earlier read cannot replace a newer window.
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      await action(); this.error = undefined;
      if (!this.closed) this.terminal.requestRender();
    }).catch(error => {
      this.error = error instanceof Error ? error.message : String(error);
      clearTimeout(this.timer);
      if (!this.closed) this.terminal.requestRender();
    });
    return this.queue;
  }
  private async size(): Promise<number> {
    const source = await fileSource(this.manager.logPath(this.job, this.stream));
    try { return source.size; } finally { await source.close(); }
  }
  private async load(offset: number, mode: 'latest' | 'follow' | 'page', limitBytes: number = READ_LIMITS.maxBytes): Promise<void> {
    const page = await readJobLog(this.manager, this.job, this.stream, { offset, limitBytes });
    if (this.closed) return;
    // Reading is asynchronous: navigation during the read must still pause following.
    if (mode === 'follow' && (!this.reader.atBottom || this.reader.searching)) return;
    this.page = page; this.totalBytes = page.totalBytes;
    if (mode === 'page') this.reader.offset = 0;
    // Program text stays literal; code fences in a log must not become Markdown structure.
    this.reader.setContent(new Text(sanitizeText(page.text) || '(no output)', 0, 0), mode !== 'page');
  }
  initialize(): Promise<void> { return this.follow(); }
  follow(): Promise<void> {
    return this.request(async () => {
      this.autoFollow = true;
      const size = await this.size();
      await this.load(Math.max(0, size - READ_LIMITS.maxBytes), 'latest');
      this.arm();
    });
  }
  previous(): Promise<void> {
    return this.request(async () => {
      this.autoFollow = false;
      const end = this.page?.offset ?? 0;
      if (end) { const start = Math.max(0, end - READ_LIMITS.maxBytes); await this.load(start, 'page', end - start); }
    });
  }
  next(): Promise<void> {
    return this.request(async () => {
      this.autoFollow = false;
      if (this.page && this.page.nextOffset < this.totalBytes) await this.load(this.page.nextOffset, 'page');
    });
  }
  /** Paused readers observe only the size; their content and search position remain unchanged. */
  refresh(): Promise<void> {
    return this.request(async () => {
      const size = await this.size();
      this.totalBytes = size;
      if (size !== this.page?.totalBytes && this.autoFollow && this.reader.atBottom && !this.reader.searching) {
        await this.load(Math.max(0, size - READ_LIMITS.maxBytes), 'follow');
      }
    });
  }
  private arm(): void {
    clearTimeout(this.timer);
    if (this.closed || !this.live || isTerminal(this.job.state)) return;
    this.timer = setTimeout(() => { void this.refresh().then(() => { if (!this.error) this.arm(); }); }, REFRESH_MS);
    this.timer.unref();
  }
  override handleInput(data: string): void {
    super.handleInput(data);
    // A terminal job has no timer; returning to the bottom must fetch its last output too.
    if (this.autoFollow && this.reader.atBottom && !this.reader.searching) void this.refresh();
  }
  override handleMouse(event: TuiMouseEvent) {
    const result = super.handleMouse(event);
    if (result?.handled && this.autoFollow && this.reader.atBottom && !this.reader.searching) void this.refresh();
    return result;
  }
  dispose(): void { this.closed = true; clearTimeout(this.timer); this.unsubscribe(); }
}

export async function showJobLog(ctx: ExtensionContext, dock: Dock, manager: JobReader, job: JobSummary, stream: Stream, live: boolean): Promise<void> {
  dock.setDetail(true);
  let view: JobLogView | undefined;
  try {
    await ctx.ui.custom<void>(async (tui, _theme, _keys, done) => {
      view = new JobLogView(tui, manager, job, stream, live, done);
      await view.initialize(); return view;
    });
  } finally { view?.dispose(); dock.setDetail(false); }
}
