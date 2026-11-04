import type { Theme } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, type Component, type KeyId, type TUI } from '@earendil-works/pi-tui';

/** What the terminal view needs from a live PTY; the job module adapts its session to this. */
export interface TerminalSource {
  readonly cols: number;
  readonly rows: number;
  readonly closed: boolean;
  getViewportLines(options?: { ansi?: boolean }): string[];
  resize(cols: number, rows: number): void;
  scroll(lines: number): void;
  onVisualChange(listener: () => void): () => void;
}
export interface TerminalKeys { detachKey: KeyId; returnKey: KeyId; transferKey: KeyId }
export type TerminalExit = { action: 'detach' | 'transfer'; screen: string[] };
export interface TerminalViewOptions {
  title: () => string;
  /** User keystrokes; an error string is shown in the hint line instead of being thrown. */
  write(data: string): void;
  returnControl(): void;
  userControl: () => boolean;
}

/**
 * Attach view for a PTY job. It renders the headless terminal's screen, forwards keys to the
 * program and never stops the job: leaving the view (detach) keeps the program running.
 * Shift+Up/Down scroll the terminal's own scrollback without sending input.
 */
export class TerminalView implements Component {
  private unsubscribe: () => void;
  private error?: string;
  private height = 1;

  constructor(private tui: TUI, private theme: Theme, private source: TerminalSource, private keys: TerminalKeys,
    private options: TerminalViewOptions, private done: (result: TerminalExit) => void) {
    this.unsubscribe = source.onVisualChange(() => tui.requestRender());
  }
  render(width: number): string[] {
    // Header and hint line take two rows; the program gets the rest of the 80% view.
    this.height = Math.max(3, Math.floor(this.tui.terminal.rows * 0.8) - 2);
    if (!this.source.closed) this.source.resize(Math.max(20, width), this.height);
    const control = this.source.closed ? 'exited' : this.options.userControl() ? 'you control input' : 'model controls input';
    const screen = this.source.getViewportLines({ ansi: true }).slice(-this.height);
    const hint = this.error ? this.theme.fg('warning', this.error)
      : `${this.keys.detachKey} leave (job keeps running) · ${this.keys.returnKey} return to model · ${this.keys.transferKey} send screen · Shift+↑↓ scroll`;
    return [truncateToWidth(this.theme.fg('accent', `${this.options.title()} · ${control}`), width),
      ...screen.map(line => truncateToWidth(line, width)), truncateToWidth(this.theme.fg('dim', hint), width)];
  }
  handleInput(data: string): void {
    this.error = undefined;
    if (matchesKey(data, this.keys.detachKey) || (this.source.closed && matchesKey(data, Key.escape))) return this.finish('detach');
    if (matchesKey(data, this.keys.transferKey)) return this.finish('transfer');
    if (matchesKey(data, this.keys.returnKey)) { this.options.returnControl(); this.tui.requestRender(); return; }
    if (matchesKey(data, Key.shift('up'))) { this.source.scroll(Math.max(1, this.height - 1)); return; }
    if (matchesKey(data, Key.shift('down'))) { this.source.scroll(-Math.max(1, this.height - 1)); return; }
    if (this.source.closed) { this.error = `Program exited; ${this.keys.detachKey} or Esc to leave`; this.tui.requestRender(); return; }
    try { this.options.write(data); } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.tui.requestRender(); }
  }
  invalidate(): void {}
  private finish(action: TerminalExit['action']): void {
    const screen = this.source.getViewportLines();
    this.dispose();
    this.done({ action, screen });
  }
  dispose(): void { this.unsubscribe(); }
}
