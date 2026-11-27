// Adapted from pi-interactive-shell 0.18.0 pty-session.ts (MIT, third-party/licenses/pi-interactive-shell.txt).
// pi-suite changes: output goes to the job's disk log instead of an in-memory raw buffer;
// process-tree stops are owned by the job backend, so this class only signals for disposal.
import { TerminalScreen } from './screen.ts';
import type { TerminalSnapshot } from './snapshot.ts';
import { buildCursorPositionResponse, buildPrimaryDeviceAttributesResponse, splitAroundDeviceQueries } from './protocol.ts';
import type { ResolvedShellConfig } from './shell.ts';
import { createPtyProcess, type PtyProcess } from '../backends/pty.ts';

export interface PtySessionOptions {
  command: string; shellConfig: ResolvedShellConfig; cwd: string;
  cols?: number; rows?: number; scrollback?: number;
  /** Receives program output in order, before listeners; the job log sink. */
  sink: (data: string) => void;
}

export class PtyTerminalSession extends TerminalScreen {
  private ptyProcess: PtyProcess;
  private disposed = false;
  private completing = false;
  private alternateScreen = false;
  private finalSnapshot?: TerminalSnapshot;
  // Ordered writes: xterm renders each chunk before device queries are answered and listeners run.
  private queue = Promise.resolve();
  private dataListeners = new Set<(data: string) => void>();
  readonly exit = Promise.withResolvers<{ exitCode: number; signal?: number }>();

  constructor(private options: PtySessionOptions) {
    const { cols = 80, rows = 24, scrollback = 5000 } = options;
    super(cols, rows, scrollback);
    if (options.shellConfig.commandTransport !== 'argv') {
      throw new Error(`PTY jobs cannot use "${options.shellConfig.shell}" because it reads commands from stdin; set shellPath to Git Bash in Pi settings.json`);
    }
    this.xterm.buffer.onBufferChange(buffer => { if (buffer.type === 'alternate') this.alternateScreen = true; });
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
      // Resolve only after all output is interpreted. The exit status belongs in viewer
      // metadata, not in the process screen (especially not inside an alternate buffer).
      this.queue = this.queue.then(() => this.exit.resolve({ exitCode, signal: signal || undefined }));
    });
  }

  private enqueue(text: string, query?: 'cursor-position' | 'primary-device-attributes'): void {
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      if (text) {
        this.options.sink(text);
        await this.renderText(text);
        for (const listener of [...this.dataListeners]) listener(text);
      }
      if (!query || this.disposed) return;
      const buffer = this.xterm.buffer.active;
      this.ptyProcess.write(query === 'cursor-position' ? buildCursorPositionResponse(buffer.cursorY + 1, buffer.cursorX + 1) : buildPrimaryDeviceAttributesResponse());
    }).catch(error => { if (!this.disposed) this.options.sink(`\n[pi-suite: terminal render failed: ${String(error)}]\n`); });
  }

  onData(listener: (data: string) => void): () => void { this.dataListeners.add(listener); return () => this.dataListeners.delete(listener); }
  get pid(): number { return this.ptyProcess.pid; }
  get processExited(): boolean { return this.ptyProcess.processExited; }
  get fullScreen(): boolean { return this.alternateScreen; }

  write(data: string): void {
    if (this.disposed || this.completing) throw new Error('Terminal no longer accepts input');
    this.ptyProcess.write(data);
  }
  override resize(cols: number, rows: number): void {
    if (this.disposed || (cols === this.cols && rows === this.rows) || cols < 1 || rows < 1) return;
    super.resize(cols, rows);
    if (!this.completing) this.ptyProcess.resize(cols, rows);
  }

  /** Captured exactly once at settlement, independently of a viewer's scroll position. */
  override snapshot(): TerminalSnapshot { return this.finalSnapshot ??= super.snapshot(); }

  /** Signal only the PTY backend; the job backend performs group/tree stop and confirmation. */
  kill(signal: NodeJS.Signals = 'SIGKILL'): void { if (!this.disposed) this.ptyProcess.kill(signal); }
  /** History deletion, unlike closing a viewer, owns destruction of the saved buffer. */
  releaseScreen(): void { super.dispose(); }
  override get closed(): boolean { return this.disposed || this.completing; }
  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.ptyProcess.close(); } finally {
      this.visualChanged(); this.dataListeners.clear();
      // The ended owner retains its bounded xterm buffer for history scrolling. A viewer
      // only unsubscribes; it must never destroy a terminal still owned by the manager.
    }
  }
}
