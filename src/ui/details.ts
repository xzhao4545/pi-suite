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
import { plainDetailLines, readingDetailsContent, type StructuredDetails } from './structured-details.ts';

export interface DetailOptions {
  title?: boolean;
  /** One/two information rows; the shared frame supplies the separator and settles position. */
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
  private readonly scrollChanged = () => this.readingChanged();
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, private done: () => void, actions: DetailAction[] = [], reader?: ScrollView, private theme?: Theme, private options: DetailOptions = {}) {
    super();
    this.reader = reader ?? new ScrollView(content);
    this.reader.onScroll = this.scrollChanged;
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
    const topRows = Number(this.options.title !== false);
    // Measure the native document once. Metadata includes position, so it must be
    // re-read after updateLayout has applied follow-end/clamp to this same document.
    const lines = this.reader.render(width);
    let information = this.options.bottom?.(width).slice(0, 2) ?? [];
    let footer: string[] = [], bodyRows = 0;
    const inline = this.composer.render(width);
    for (let pass = 0; pass < 2; pass++) {
      const informationRows = this.options.bottom ? 1 + information.length : 0;
      const footerLimit = Math.max(1, total - 2 - topRows - informationRows - 2);
      footer = this.composer.active
        ? [...this.composer.renderRows(width, Math.max(1, footerLimit - 1)), this.composer.help()]
        : this.reader.searching ? this.reader.search.render(width) : keyHelp(inline ?? help, width).slice(0, footerLimit);
      bodyRows = Math.max(0, total - 3 - topRows - informationRows - footer.length);
      this.reader.updateLayout(lines.length, bodyRows, () => this.tui.requestRender());
      const settled = this.options.bottom?.(width).slice(0, 2) ?? [];
      const sameRows = settled.length === information.length;
      information = settled;
      // One/two-line position metadata needs at most one correction: reclaiming a
      // row can only shorten its clamped/following position, reserving one lengthens it.
      if (sameRows) break;
    }
    const border = () => commandFrame(width, [], this.theme)[0];
    const body = readingWindow(lines.slice(this.reader.offset, this.reader.offset + bodyRows), bodyRows);
    const top = [border(), ...topRows ? [readerHeading(this.title(), this.reader.position, this.reader.hasNewOutput, width, this.theme)] : []];
    const metadata = this.options.bottom ? [separator(width, this.theme), ...information] : [];
    const frame = new VStack([readingText(() => top), readingText(() => body), readingText(() => metadata),
      readingText(() => [separator(width, this.theme), ...footer, border()])]);
    return readingWindow(frame.render(width), total);
  }
  get textInputActive(): boolean { return this.composer.active || this.reader.searching; }
  protected readingChanged(): void {}
  dispose(): void {
    this.doubleLeft.reset(); this.composer.dispose();
    // A replacement view can already own the retained reader when an old factory
    // completes. Only its current owner may detach scroll/layout callbacks.
    if (this.reader.onScroll === this.scrollChanged) this.reader.dispose();
  }
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

export async function showDetails(ctx: ExtensionContext, dock: Dock, title: string, content: string | StructuredDetails, format: 'markdown' | 'text' = 'markdown', navigation?: ViewerNavigation): Promise<void> {
  if (ctx.mode !== 'tui') {
    ctx.ui.notify(`${title}\n${typeof content === 'string' ? content : plainDetailLines(content).join('\n')}`); return;
  }
  dock.setDetail(true);
  try {
    await openReading<void>(ctx, (tui, theme, keys, done) => {
      const {body, output} = typeof content !== 'string' ? readingDetailsContent(content, theme) : {
        body: format === 'text' ? new Text(sanitizeText(content), 0, 0) : new Markdown(content, 0, 0, getMarkdownTheme()),
      };
      const view = new DetailsView(tui, () => title, body, done, [], undefined, theme, {navigation, keys});
      if (output) view.actions.push({key: 'e',
        get label() { return output.expanded ? 'Collapse output' : 'Expand output'; },
        run: () => {
          // End follows the document tail. Stay at the summary instead of jumping to the end of the expanded result.
          view.reader.pause();
          output.toggle();
        },
      });
      return view;
    });
  } finally { dock.setDetail(false); }
}
