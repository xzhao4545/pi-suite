import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
export type { DetailAction } from './actions.ts';
import { readerHeading, keyHint } from './browser-chrome.ts';
import { InlineInput } from './inline-input.ts';
import { commandFrame } from './frame.ts';
import { openReading, readingRows } from './reading.ts';

/** Shared detail frame: static Markdown and live log windows use the same reader and key-driven actions. */
export class DetailsView implements Component {
  focused = true;
  readonly capturesViewportInput = true;
  readonly reader: ScrollView;
  private bar: ActionBar;
  private composer: InlineInput;
  private bodyRows = 0;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, private done: () => void, actions: DetailAction[] = [], reader?: ScrollView, private theme?: Theme) {
    this.reader = reader ?? new ScrollView(content);
    this.actions = actions;
    this.composer = new InlineInput(() => tui.requestRender(), theme);
    this.bar = new ActionBar(() => this.actions, request => this.composer.open(request));
  }
  render(width: number): string[] {
    const shortcuts = this.bar.render(this.theme);
    // The reader owns ↑↓/PgUp/PgDn, Home/End and / n N; actions only take the remaining keys.
    const help = this.bar.hint(this.theme) ?? [shortcuts, keyHint('↑↓ PgUp PgDn Home/End', 'scroll', this.theme),
      keyHint('/', 'search', this.theme), keyHint('n/N', 'next', this.theme), keyHint('Esc', 'back', this.theme)].filter(Boolean).join(' · ');
    const inline = this.composer.render(width);
    const footer = this.composer.active ? [inline!, this.composer.help()] : this.reader.searching ? this.reader.search.render(width) : keyHelp(inline ?? help, width);
    const height = Math.max(1, readingRows(this.tui) - footer.length - 3);
    const body = this.reader.viewport(width, height);
    this.bodyRows = height;
    // A full-window overlay must also cover unused rows, or the parent's transcript leaks through.
    const viewport = Array.from({length: height}, (_, index) => body[index] ?? '');
    return commandFrame(width, [readerHeading(this.title(), this.reader.position, this.reader.hasNewOutput, width, this.theme), ...viewport, ...footer], this.theme);
  }
  dispose(): void { this.composer.dispose(); }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) {
    if (this.composer.active) return {handled: true};
    if (event.y < 2 || event.y >= this.bodyRows + 2) return;
    return this.reader.handleMouse({ ...event, y: event.y - 2 });
  }
  handleInput(data: string): void {
    // Inline text takes priority over search, navigation and record shortcuts, including Esc.
    if (this.composer.handleInput(data)) { this.bar.disarm(); return; }
    // Search owns all text, including action shortcuts and confirmation keys.
    if (this.reader.searching) { this.bar.disarm(); this.reader.handleInput(data); }
    else if (matchesKey(data, Key.escape)) { this.bar.disarm(); this.done(); }
    else if (!this.bar.handleInput(data)) this.reader.handleInput(data);
    this.tui.requestRender();
  }
}

export async function showDetails(ctx: ExtensionContext, dock: Dock, title: string, text: string): Promise<void> {
  if (ctx.mode !== "tui") { ctx.ui.notify(`${title}\n${text}`); return; }
  dock.setDetail(true);
  try {
    await openReading<void>(ctx, (tui, theme, _keys, done) => new DetailsView(tui, () => title, new Markdown(text, 0, 0, getMarkdownTheme()), done, [], undefined, theme));
  } finally { dock.setDetail(false); }
}
