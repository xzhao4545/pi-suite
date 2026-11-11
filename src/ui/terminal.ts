import type { Theme } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, type Component, type KeyId, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { commandFrame } from './frame.ts';
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
import { keyHint, separator } from './browser-chrome.ts';
import { readingRows } from './reading.ts';
import { DoubleLeft, type ViewerNavigation } from './viewer/navigation.ts';

/** Both the live PTY and a restored xterm screen implement the same visual boundary. */
export interface TerminalSource {
  readonly cols: number; readonly rows: number; readonly closed: boolean;
  readonly following?: boolean;
  readonly viewport?: {start: number; total: number; alternate: boolean; cursor: {x: number; y: number; visible: boolean}};
  getViewportLines(options?: {ansi?: boolean; cursor?: boolean; hardwareCursor?: boolean; height?: number}): string[];
  resize(cols: number, rows: number): void;
  scroll(lines: number): void;
  follow?(): void;
  onVisualChange(listener: () => void): () => void;
}
export interface TerminalKeys { detachKey: KeyId; returnKey: KeyId; transferKey: KeyId }
export type TerminalExit = { action: 'detach' | 'transfer'; screen: string[] };
export interface TerminalViewOptions {
  title: () => string;
  write(data: string): void;
  takeControl?(): void;
  returnControl(): void;
  userControl: () => boolean;
  canInput?: () => boolean;
  readonly?: boolean;
  initialInput?: boolean;
  navigation?: ViewerNavigation;
  actions?: DetailAction[];
  bottom?: (width: number) => string[];
  hideTitle?: boolean;
}

/** A visual subscriber, not an owner. Browse mode never forwards keys or acquires control. */
export class TerminalView implements Component {
  focused = true;
  readonly capturesViewportInput = true;
  private unsubscribe: () => void;
  private error?: string;
  private height = 1;
  private bodyStart = 1;
  private finished = false;
  private input = false;
  private doubleLeft = new DoubleLeft();
  private bar: ActionBar;
  constructor(private tui: TUI, private theme: Theme, private source: TerminalSource, private keys: TerminalKeys,
    private options: TerminalViewOptions, private done: (result: TerminalExit) => void) {
    this.unsubscribe = source.onVisualChange(() => {
      if (source.closed && this.input) this.releaseInput();
      tui.requestRender();
    });
    this.bar = new ActionBar(() => [
      ...options.actions ?? [],
      {key: 'f', label: 'Follow latest', run: () => this.follow()},
      {key: 'i', label: 'Input', available: () => this.canInput(), run: () => this.enterInput()},
    ], () => { throw new Error('Terminal actions do not accept inline text'); });
    if (options.initialInput) this.enterInput();
  }
  private canInput(): boolean { return !this.options.readonly && !this.source.closed && this.options.canInput?.() !== false; }
  get inputMode(): boolean { return this.input; }
  enterInput(): void {
    if (!this.canInput()) return;
    this.doubleLeft.reset(); this.bar.disarm();
    try { this.options.takeControl?.(); this.input = true; this.follow(); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    this.tui.requestRender();
  }
  private releaseInput(): void { if (this.input) { this.input = false; this.options.returnControl(); } }
  private follow(): void { if (this.source.follow) this.source.follow(); else this.source.scroll(-Number.MAX_SAFE_INTEGER); }
  render(width: number): string[] {
    if (!this.canInput() && this.input) this.releaseInput();
    const leave = keyHint(this.keys.detachKey, 'leave', this.theme);
    const help = this.input
      ? [leave, keyHint(this.keys.returnKey, 'return input', this.theme), keyHint(this.keys.transferKey, 'send screen', this.theme), keyHint('Shift+↑↓', 'history', this.theme)].join(' · ')
      : [leave, keyHint('Esc', 'back', this.theme), ...this.canInput() && this.focused ? [keyHint('i', 'input', this.theme)] : [],
        keyHint('↑↓ PgUp/PgDn Home/End', 'history', this.theme), ...this.options.navigation ? [keyHint('←←', 'close', this.theme)] : [],
        this.bar.render(this.theme, ['i'])].join(' · ');
    const total = readingRows(this.tui), titleRows = Number(!this.options.hideTitle);
    const bottom = this.options.bottom?.(width) ?? [];
    const metadata = bottom.length ? [separator(width, this.theme), ...bottom] : [];
    // Errors and confirmations must not erase the user's escape route. The promoted
    // input action is omitted from the secondary bar, without changing dispatch.
    const feedback = this.error ? this.theme.fg('warning', this.error) : !this.input ? this.bar.hint(this.theme) : undefined;
    const notice = feedback ? [truncateToWidth(feedback, width)] : [];
    const hints = keyHelp(help, width, Math.min(2, Math.max(1, total - titleRows - metadata.length - notice.length - 4)));
    this.height = Math.max(1, total - 3 - titleRows - metadata.length - notice.length - hints.length);
    this.bodyStart = 1 + titleRows;
    // Only process screen rows reach xterm/PTY. An unchanged size never causes resize/redraw.
    if (!this.source.closed && (this.source.cols !== width || this.source.rows !== this.height)) this.source.resize(Math.max(1, width), this.height);
    const screen = this.source.getViewportLines({ansi: true, cursor: this.focused, hardwareCursor: this.input && this.focused, height: this.height});
    const control = this.source.closed ? 'exited' : this.input ? 'you control input' : 'read-only view';
    return commandFrame(width, [...titleRows ? [truncateToWidth(this.theme.fg('accent', `${this.options.title()} · ${control}`), width)] : [],
      ...Array.from({length: this.height}, (_, index) => screen[index] ?? ''), ...metadata, ...notice, separator(width, this.theme), ...hints], this.theme)
      .map(line => truncateToWidth(line, width));
  }
  handleInput(data: string): void {
    this.error = undefined;
    if (this.input) {
      this.doubleLeft.reset();
      if (matchesKey(data, this.keys.detachKey)) return this.finish('detach');
      if (matchesKey(data, this.keys.transferKey)) return this.finish('transfer');
      if (matchesKey(data, this.keys.returnKey)) { this.releaseInput(); this.tui.requestRender(); return; }
      if (matchesKey(data, Key.shift('up'))) { this.source.scroll(Math.max(1, this.height - 1)); return; }
      if (matchesKey(data, Key.shift('down'))) { this.source.scroll(-Math.max(1, this.height - 1)); return; }
      if (!this.canInput()) { this.releaseInput(); this.tui.requestRender(); return; }
      try { this.options.write(data); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); this.tui.requestRender(); }
      return;
    }
    if (this.options.navigation && this.doubleLeft.handle(data)) { this.options.navigation.close(); return this.finish('detach'); }
    if (matchesKey(data, Key.escape) || matchesKey(data, this.keys.detachKey)) return this.finish('detach');
    if (this.bar.handleInput(data)) { this.tui.requestRender(); return; }
    if (matchesKey(data, Key.end)) this.follow();
    else if (matchesKey(data, Key.home)) this.source.scroll(Number.MAX_SAFE_INTEGER);
    else if (matchesKey(data, Key.up) || matchesKey(data, Key.shift('up'))) this.source.scroll(1);
    else if (matchesKey(data, Key.down) || matchesKey(data, Key.shift('down'))) this.source.scroll(-1);
    else if (matchesKey(data, Key.pageUp)) this.source.scroll(this.height);
    else if (matchesKey(data, Key.pageDown)) this.source.scroll(-this.height);
  }
  handleMouse(event: TuiMouseEvent) {
    this.doubleLeft.reset();
    if (event.type !== 'wheel' || event.y < this.bodyStart || event.y >= this.bodyStart + this.height) return;
    this.source.scroll(-(event.wheelDelta ?? 0) * 3); return {handled: true};
  }
  invalidate(): void {}
  finish(action: TerminalExit['action']): void {
    if (this.finished) return;
    this.finished = true;
    // Transfer is the actual current screen, not a manually scrolled history viewport.
    this.follow(); const screen = this.source.getViewportLines();
    this.dispose(); this.done({ action, screen });
  }
  dispose(): void { this.doubleLeft.reset(); this.releaseInput(); this.unsubscribe(); }
}
