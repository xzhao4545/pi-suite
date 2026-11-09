import { getMarkdownTheme, type ExtensionContext, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { Key, Markdown, Text, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import type { Dock } from './dock.ts';
import { ScrollView } from './scroll.ts';
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
export type { DetailAction } from './actions.ts';
import { readerHeading, keyHint, separator } from './browser-chrome.ts';
import { InlineInput } from './inline-input.ts';
import { commandFrame } from './frame.ts';
import { openReading, readingRows } from './reading.ts';
import { sanitizeText } from '../runtime/text.ts';
import { DoubleLeft, type ViewerNavigation } from './viewer/navigation.ts';

export interface DetailOptions {
  title?: boolean;
  bottom?: (width: number) => string[];
  navigation?: ViewerNavigation;
  keys?: KeybindingsManager;
}

/** A shared reading frame budgets native input, metadata and actions before laying out its body. */
export class DetailsView implements Component {
  focused = true;
  readonly capturesViewportInput = true;
  readonly reader: ScrollView;
  private bar: ActionBar;
  private composer: InlineInput;
  private doubleLeft = new DoubleLeft();
  private bodyRows = 0;
  private bodyStart = 0;
  private footerStart = 0;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, private done: () => void, actions: DetailAction[] = [], reader?: ScrollView, private theme?: Theme, private options: DetailOptions = {}) {
    this.reader = reader ?? new ScrollView(content);
    this.actions = actions;
    this.composer = new InlineInput(() => tui.requestRender(), theme, tui, options.keys);
    this.bar = new ActionBar(() => this.actions, request => this.composer.open(request));
  }
  render(width: number): string[] {
    this.composer.focused = this.focused;
    this.reader.search.focused = this.focused && !this.composer.active && this.reader.searching;
    const shortcuts = this.bar.render(this.theme);
    const help = this.bar.hint(this.theme) ?? [...this.options.navigation ? [keyHint('←←', 'close', this.theme)] : [],
      keyHint('Esc', 'back', this.theme), shortcuts, keyHint('↑↓ PgUp PgDn Home/End', 'scroll', this.theme),
      keyHint('/', 'search', this.theme), keyHint('n/N', 'next', this.theme)].filter(Boolean).join(' · ');
    const total = readingRows(this.tui), topRows = Number(this.options.title !== false);
    // Two reserved metadata rows keep changing usage/position widths from moving the transcript.
    const informationRows = this.options.bottom ? 3 : 0;
    const footerLimit = Math.max(1, total - 2 - topRows - informationRows - 1 - 1);
    const inline = this.composer.render(width);
    const footer = this.composer.active
      ? [...this.composer.renderRows(width, Math.max(1, footerLimit - 1)), truncateToWidth(this.composer.help(), width)]
      : this.reader.searching ? this.reader.search.render(width)
        : keyHelp(inline ?? help, width).slice(0, footerLimit);
    const height = Math.max(1, total - 2 - topRows - informationRows - 1 - footer.length);
    const body = this.reader.viewport(width, height);
    this.bodyRows = height; this.bodyStart = 1 + topRows;
    const viewport = Array.from({length: height}, (_, index) => body[index] ?? '');
    const info = this.options.bottom ? [separator(width, this.theme), ...this.options.bottom(width).slice(0, 2)] : [];
    this.footerStart = this.bodyStart + height + info.length + 1;
    return commandFrame(width, [...topRows ? [readerHeading(this.title(), this.reader.position, this.reader.hasNewOutput, width, this.theme)] : [],
      ...viewport, ...info, separator(width, this.theme), ...footer], this.theme).map(line => truncateToWidth(line, width));
  }
  dispose(): void { this.doubleLeft.reset(); this.composer.dispose(); }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) {
    this.doubleLeft.reset();
    if (this.composer.active) {
      if (event.y >= this.footerStart) this.composer.handleMouse({...event, y: event.y - this.footerStart});
      return {handled: true};
    }
    if (event.y < this.bodyStart || event.y >= this.bodyRows + this.bodyStart) return;
    return this.reader.handleMouse({...event, y: event.y - this.bodyStart});
  }
  handleInput(data: string): void {
    // Text and search own all direction keys, including both Left presses.
    if (this.composer.active) this.doubleLeft.reset();
    if (this.composer.handleInput(data)) { this.bar.disarm(); return; }
    if (this.reader.searching) { this.doubleLeft.reset(); this.bar.disarm(); this.reader.handleInput(data); }
    else if (this.options.navigation && this.doubleLeft.handle(data)) {
      this.options.navigation.close(); this.bar.disarm(); this.done();
    } else if (matchesKey(data, Key.escape)) { this.bar.disarm(); this.done(); }
    else if (!this.bar.handleInput(data)) this.reader.handleInput(data);
    this.tui.requestRender();
  }
}

export async function showDetails(ctx: ExtensionContext, dock: Dock, title: string, text: string, format: 'markdown' | 'text' = 'markdown', navigation?: ViewerNavigation): Promise<void> {
  if (ctx.mode !== 'tui') { ctx.ui.notify(`${title}\n${text}`); return; }
  dock.setDetail(true);
  try {
    await openReading<void>(ctx, (tui, theme, keys, done) => new DetailsView(tui, () => title,
      format === 'text' ? new Text(sanitizeText(text), 0, 0) : new Markdown(text, 0, 0, getMarkdownTheme()), done, [], undefined, theme, {navigation, keys}));
  } finally { dock.setDetail(false); }
}
