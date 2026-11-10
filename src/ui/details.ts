import { getMarkdownTheme, type ExtensionContext, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Key, Markdown, Text, VStack, matchesKey, type Component, type TUI } from '@earendil-works/pi-tui';
import type { Dock } from './dock.ts';
import { ScrollView } from './scroll.ts';
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
export type { DetailAction } from './actions.ts';
import { readerHeading, keyHint, separator } from './browser-chrome.ts';
import { InlineInput } from './inline-input.ts';
import { commandFrame } from './frame.ts';
import { openReading, readingRows, readingText, readingWindow } from './reading.ts';
import { sanitizeText } from '../runtime/text.ts';
import { DoubleLeft, type ViewerNavigation } from './viewer/navigation.ts';

export interface DetailOptions {
  title?: boolean;
  bottom?: (width: number) => string[];
  navigation?: ViewerNavigation;
  keys?: KeybindingsManager;
}

/** A shared reading frame budgets native input, metadata and actions before laying out its body. */
export class DetailsView extends Container {
  focused = true;
  readonly capturesViewportInput = true;
  readonly reader: ScrollView;
  private bar: ActionBar;
  private composer: InlineInput;
  private doubleLeft = new DoubleLeft();
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, private done: () => void, actions: DetailAction[] = [], reader?: ScrollView, private theme?: Theme, private options: DetailOptions = {}) {
    super();
    this.reader = reader ?? new ScrollView(content);
    this.reader.onScroll = () => this.readingChanged();
    this.actions = actions;
    this.composer = new InlineInput(() => tui.requestRender(), theme, tui, options.keys);
    this.bar = new ActionBar(() => this.actions, request => this.composer.open(request));
  }
  override render(width: number): string[] {
    const total = readingRows(this.tui);
    this.composer.focused = this.focused;
    this.reader.search.focused = this.focused && !this.composer.active && this.reader.searching;
    const shortcuts = this.bar.render(this.theme);
    const help = this.bar.hint(this.theme) ?? [...this.options.navigation ? [keyHint('←←', 'close', this.theme)] : [],
      keyHint('Esc', 'back', this.theme), shortcuts, keyHint('↑↓ PgUp PgDn Home/End', 'scroll', this.theme),
      keyHint('/', 'search', this.theme), keyHint('n/N', 'next', this.theme)].filter(Boolean).join(' · ');
    const topRows = Number(this.options.title !== false), informationRows = this.options.bottom ? 3 : 0;
    const footerLimit = Math.max(1, total - 2 - topRows - informationRows - 2);
    const inline = this.composer.render(width);
    const footer = this.composer.active
      ? [...this.composer.renderRows(width, Math.max(1, footerLimit - 1)), this.composer.help()]
      : this.reader.searching ? this.reader.search.render(width) : keyHelp(inline ?? help, width).slice(0, footerLimit);
    const border = () => commandFrame(width, [], this.theme)[0];
    const bodyRows = Math.max(0, total - 3 - topRows - informationRows - footer.length);
    const body = this.reader.viewport(width, bodyRows, () => this.tui.requestRender());
    // Read position/metadata after the viewport has settled; native tools and Editor
    // keep their rendering identity while the shared frame owns its explicit budget.
    const top = [border(), ...topRows ? [readerHeading(this.title(), this.reader.position, this.reader.hasNewOutput, width, this.theme)] : []];
    const metadata = this.options.bottom ? readingWindow([separator(width, this.theme), ...this.options.bottom(width).slice(0, 2)], informationRows) : [];
    const frame = new VStack([readingText(() => top), readingText(() => body), readingText(() => metadata),
      readingText(() => [separator(width, this.theme), ...footer, border()])]);
    return readingWindow(frame.render(width), total);
  }
  get textInputActive(): boolean { return this.composer.active || this.reader.searching; }
  protected readingChanged(): void {}
  dispose(): void { this.doubleLeft.reset(); this.composer.dispose(); this.reader.onScroll = undefined; this.reader.dispose(); }
  override invalidate(): void { this.reader.invalidate(); }
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
