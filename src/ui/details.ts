import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
export type { DetailAction } from './actions.ts';
import { commandFrame } from './frame.ts';
import { openReading, readingRows } from './reading.ts';

/** Shared detail frame: static Markdown and live log windows use the same reader and key-driven actions. */
export class DetailsView implements Component {
  readonly capturesViewportInput = true;
  readonly reader: ScrollView;
  private bar: ActionBar;
  private bodyRows = 0;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, private done: () => void, actions: DetailAction[] = [], reader?: ScrollView, private theme?: Theme) {
    this.reader = reader ?? new ScrollView(content);
    this.actions = actions;
    this.bar = new ActionBar(() => this.actions);
  }
  render(width: number): string[] {
    const shortcuts = this.bar.render();
    // The reader owns ↑↓/PgUp/PgDn, Home/End and / n N; actions only take the remaining keys.
    const help = this.bar.hint ?? `${shortcuts ? `${shortcuts} · ` : ''}↑↓ PgUp PgDn Home/End · / search · n/N next · Esc back`;
    const footer = this.reader.searching ? this.reader.search.render(width) : keyHelp(help, width);
    const height = Math.max(1, readingRows(this.tui) - footer.length - 3);
    const body = this.reader.viewport(width, height);
    this.bodyRows = height;
    // A full-window overlay must also cover unused rows, or the parent's transcript leaks through.
    const viewport = Array.from({length: height}, (_, index) => body[index] ?? '');
    return commandFrame(width, [truncateToWidth(`${this.title()} · ${this.reader.position}`, width), ...viewport, ...footer], this.theme);
  }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) {
    if (event.y < 2 || event.y >= this.bodyRows + 2) return;
    return this.reader.handleMouse({ ...event, y: event.y - 2 });
  }
  handleInput(data: string): void {
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
