// Adapted from pi-interactive-shell 0.18.0 pty-session.ts (MIT, third-party/licenses/pi-interactive-shell.txt).
// pi-suite changes: output goes to the job's disk log instead of an in-memory raw buffer;
// process-tree stops are owned by the job backend, so this class only signals for disposal.
import xterm from '@xterm/headless';
import type { Terminal as XtermTerminal } from '@xterm/headless';
import { buildCursorPositionResponse, buildPrimaryDeviceAttributesResponse, splitAroundDeviceQueries } from './protocol.ts';
import { renderLineFromCells, sanitizeLine } from './render.ts';
import type { ResolvedShellConfig } from './shell.ts';
import { createPtyProcess, type PtyProcess } from '../backends/pty.ts';

export interface PtySessionOptions {
  command: string; shellConfig: ResolvedShellConfig; cwd: string;
  cols?: number; rows?: number; scrollback?: number;
  /** Receives program output in order, before listeners; the job log sink. */
  sink: (data: string) => void;
}

export class PtyTerminalSession {
  private ptyProcess: PtyProcess;
  private xterm: XtermTerminal;
  private disposed = false;
  private completing = false;
  private scrollOffset = 0;
  private followBottom = true;
  // Ordered writes: xterm renders each chunk before device queries are answered and listeners run.
  private queue = Promise.resolve();
  private dataListeners = new Set<(data: string) => void>();
  private visualListeners = new Set<() => void>();
  private finalScreen: { ansi: string[]; plain: string[] } = { ansi: [], plain: [] };
  readonly exit = Promise.withResolvers<{ exitCode: number; signal?: number }>();

  constructor(private options: PtySessionOptions) {
    if (options.shellConfig.commandTransport !== 'argv') {
      throw new Error(`Pi selected "${options.shellConfig.shell}", which requires stdin command transport; PTY jobs need a Git Bash shellPath.`);
    }
    const { cols = 80, rows = 24, scrollback = 5000 } = options;
    this.xterm = new xterm.Terminal({ cols, rows, scrollback, allowProposedApi: true, convertEol: true });
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ TERM: 'xterm-256color', ...process.env })) if (value !== undefined) env[key] = value;
    this.ptyProcess = createPtyProcess(options.shellConfig.shell, [...options.shellConfig.args, options.command],
      { name: 'xterm-256color', cols, rows, cwd: options.cwd, env });
    this.ptyProcess.onData(data => {
      if (this.disposed) return;
      const { segments, trailingText } = splitAroundDeviceQueries(typeof data === 'string' ? data : data.toString('utf8'));
      for (const segment of segments) this.enqueue(segment.text, segment.queryAfter);
      if (trailingText) this.enqueue(trailingText);
    });
    this.ptyProcess.onExit(({ exitCode, signal }) => {
      if (this.disposed || this.completing) return;
      this.completing = true;
      // The exit banner is shown in the terminal view only; the job log keeps program bytes.
      this.queue = this.queue.then(() => this.render(`\n[Process exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}]\n`))
        .then(() => this.exit.resolve({ exitCode, signal: signal || undefined }));
    });
  }

  private render(text: string): Promise<void> {
    const rendered = Promise.withResolvers<void>();
    this.xterm.write(text, () => rendered.resolve());
    return rendered.promise.then(() => { for (const listener of [...this.visualListeners]) listener(); });
  }
  private enqueue(text: string, query?: 'cursor-position' | 'primary-device-attributes'): void {
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      if (text) {
        this.options.sink(text);
        await this.render(text);
        for (const listener of [...this.dataListeners]) listener(text);
      }
      if (!query || this.disposed) return;
      const buffer = this.xterm.buffer.active;
      this.ptyProcess.write(query === 'cursor-position' ? buildCursorPositionResponse(buffer.cursorY + 1, buffer.cursorX + 1) : buildPrimaryDeviceAttributesResponse());
    }).catch(error => { if (!this.disposed) this.options.sink(`\n[pi-suite: terminal render failed: ${String(error)}]\n`); });
  }

  onData(listener: (data: string) => void): () => void { this.dataListeners.add(listener); return () => this.dataListeners.delete(listener); }
  onVisualChange(listener: () => void): () => void { this.visualListeners.add(listener); return () => this.visualListeners.delete(listener); }
  get pid(): number { return this.ptyProcess.pid; }
  get cols(): number { return this.xterm.cols; }
  get rows(): number { return this.xterm.rows; }
  get processExited(): boolean { return this.ptyProcess.processExited; }

  write(data: string): void {
    if (this.disposed || this.completing) throw new Error('Terminal no longer accepts input');
    this.ptyProcess.write(data);
  }
  resize(cols: number, rows: number): void {
    if (this.disposed || (cols === this.xterm.cols && rows === this.xterm.rows) || cols < 1 || rows < 1) return;
    this.xterm.resize(cols, rows);
    if (!this.disposed && !this.completing) this.ptyProcess.resize(cols, rows);
    for (const listener of [...this.visualListeners]) listener();
  }

  /** Current screen; ANSI lines keep colors for the attach view, plain lines for transfer to the model. */
  getViewportLines(options: { ansi?: boolean } = {}): string[] {
    // After disposal the xterm buffer is gone; the last screen captured at disposal remains.
    if (this.disposed) return options.ansi ? this.finalScreen.ansi : this.finalScreen.plain;
    const buffer = this.xterm.buffer.active;
    if (this.followBottom) this.scrollOffset = 0;
    const start = Math.max(0, buffer.length - this.xterm.rows - this.scrollOffset);
    const lines: string[] = [];
    for (let i = 0; i < this.xterm.rows; i++) {
      const line = buffer.getLine(start + i);
      const plain = sanitizeLine(line?.translateToString(true) ?? '');
      if (!options.ansi) { lines.push(plain); continue; }
      const rendered = renderLineFromCells(line, this.xterm.cols);
      // Fall back to plain text if special color encodings would render a visibly blank line.
      lines.push(plain.trim() && !rendered.replace(/\x1b\[[0-9;]*m/g, '').trim() ? plain + '\u001b[0m' : rendered);
    }
    return lines;
  }
  scroll(lines: number): void {
    if (this.disposed) return;
    const max = Math.max(0, this.xterm.buffer.active.length - this.xterm.rows);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + lines, max));
    this.followBottom = this.scrollOffset === 0;
    for (const listener of [...this.visualListeners]) listener();
  }

  /** Signal only the PTY backend; the job backend performs group/tree stop and confirmation. */
  kill(signal: NodeJS.Signals = 'SIGKILL'): void { if (!this.disposed) this.ptyProcess.kill(signal); }
  get closed(): boolean { return this.disposed; }
  dispose(): void {
    if (this.disposed) return;
    this.finalScreen = { ansi: this.getViewportLines({ ansi: true }), plain: this.getViewportLines() };
    this.disposed = true;
    try { this.ptyProcess.close(); } finally {
      for (const listener of [...this.visualListeners]) listener();
      this.dataListeners.clear(); this.visualListeners.clear(); this.xterm.dispose();
    }
  }
}
