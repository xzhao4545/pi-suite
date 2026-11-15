import xterm from '@xterm/headless';
import type { Terminal as XtermTerminal, ITerminalAddon } from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { renderLineFromCells, sanitizeLine } from './render.ts';

import { SNAPSHOT_BYTES, SNAPSHOT_SCROLLBACK, type TerminalSnapshot } from './snapshot.ts';

/** One bounded terminal model serves live PTYs and restored, read-only final screens. */
export class TerminalScreen {
  protected xterm: XtermTerminal;
  protected visualListeners = new Set<() => void>();
  private serializer: InstanceType<typeof serialize.SerializeAddon>;
  private scrollOffset = 0;
  private viewRows: number;
  private cursorVisible = true;
  private screenDisposed = false;
  constructor(cols = 80, rows = 24, scrollback = 5000) {
    this.viewRows = rows;
    this.xterm = new xterm.Terminal({ cols, rows, scrollback, allowProposedApi: true, convertEol: true });
    this.xterm.buffer.onBufferChange(() => { this.scrollOffset = 0; });
    this.serializer = new serialize.SerializeAddon();
    // SerializeAddon targets browser xterm in its declarations, but uses the shared buffer API.
    this.xterm.loadAddon(this.serializer as unknown as ITerminalAddon);
    for (const [final, visible] of [['h', true], ['l', false]] as const) {
      this.xterm.parser.registerCsiHandler({prefix: '?', final}, params => {
        if (params.includes(25)) this.cursorVisible = visible;
        return false; // xterm must still apply all terminal modes itself.
      });
    }
  }
  protected async renderText(text: string): Promise<void> {
    const baseY = this.xterm.buffer.active.baseY;
    await new Promise<void>(resolve => this.xterm.write(text, resolve));
    // Keep the same history anchor while new lines arrive (until bounded scrollback evicts it).
    if (this.scrollOffset) this.scrollOffset += Math.max(0, this.xterm.buffer.active.baseY - baseY);
    this.visualChanged();
  }
  protected visualChanged(): void { for (const listener of [...this.visualListeners]) listener(); }
  onVisualChange(listener: () => void): () => void { this.visualListeners.add(listener); return () => this.visualListeners.delete(listener); }
  get cols(): number { return this.xterm.cols; }
  get rows(): number { return this.xterm.rows; }
  get closed(): boolean { return true; }
  get following(): boolean { return this.scrollOffset === 0; }
  get viewport() {
    const buffer = this.xterm.buffer.active;
    const start = Math.max(0, buffer.baseY + Math.max(0, this.rows - this.viewRows) - this.scrollOffset);
    return { start, total: buffer.length, alternate: buffer.type === 'alternate', following: this.following,
      cursor: { x: Math.min(this.cols - 1, buffer.cursorX), y: buffer.baseY + buffer.cursorY - start,
        visible: this.cursorVisible && this.following && !this.screenDisposed } };
  }
  resize(cols: number, rows: number): void {
    if (this.screenDisposed || cols === this.cols && rows === this.rows) return;
    this.xterm.resize(cols, rows); this.visualChanged();
  }
  getViewportLines(options: {ansi?: boolean; cursor?: boolean; hardwareCursor?: boolean; height?: number} = {}): string[] {
    this.viewRows = options.height ?? this.rows;
    const viewport = this.viewport, height = this.viewRows;
    const lines: string[] = [];
    for (let index = 0; index < height; index++) {
      const line = this.xterm.buffer.active.getLine(viewport.start + index);
      lines.push(options.ansi ? renderLineFromCells(line, this.cols,
        options.cursor && viewport.cursor.visible && viewport.cursor.y === index ? viewport.cursor.x : undefined, options.hardwareCursor)
        : sanitizeLine(line?.translateToString(true) ?? ''));
    }
    return lines;
  }
  scroll(lines: number): void {
    if (this.screenDisposed) return;
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + lines, this.xterm.buffer.active.baseY + Math.max(0, this.rows - this.viewRows)));
    this.visualChanged();
  }
  follow(): void { this.scrollOffset = 0; this.visualChanged(); }
  snapshot(): TerminalSnapshot {
    let scrollback = Math.min(SNAPSHOT_SCROLLBACK, this.xterm.buffer.normal.baseY);
    let data = this.serializer.serialize({scrollback});
    // Highly styled cells can cost much more than plain text. Reduce whole serialized rows;
    // slicing the ANSI stream would corrupt the snapshot's terminal state.
    while (Buffer.byteLength(data) > SNAPSHOT_BYTES && scrollback > 0) {
      scrollback = Math.floor(scrollback / 2); data = this.serializer.serialize({scrollback});
    }
    if (Buffer.byteLength(data) > SNAPSHOT_BYTES) throw new Error('Final terminal screen exceeds snapshot byte limit');
    const {cursorX: x, cursorY: y, type} = this.xterm.buffer.active;
    return { version: 1, cols: this.cols, rows: this.rows, scrollback, data,
      cursor: {x, y, visible: this.cursorVisible}, alternate: type === 'alternate' };
  }
  static async restore(snapshot: TerminalSnapshot): Promise<TerminalScreen> {
    const screen = new TerminalScreen(snapshot.cols, snapshot.rows, snapshot.scrollback);
    try { await screen.renderText(snapshot.data); screen.cursorVisible = snapshot.cursor.visible; return screen; }
    catch (error) { screen.dispose(); throw error; }
  }
  dispose(): void { if (this.screenDisposed) return; this.screenDisposed = true; this.visualListeners.clear(); this.xterm.dispose(); }
}
