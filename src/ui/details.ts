import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";
import { ActionBar, type DetailAction } from './actions.ts';
export type { DetailAction } from './actions.ts';

/** Shared detail frame: static Markdown and live log windows use the same reader and controls. */
export class DetailsView implements Component {
  readonly reader: ScrollView;
  private bar: ActionBar;
  private height = 1;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, done: () => void, actions?: DetailAction[], reader?: ScrollView, initialAction?: string) {
    this.reader = reader ?? new ScrollView(content);
    this.actions = [...actions ?? [
      { label: "Previous page", run: () => this.reader.scroll(-this.height) },
      { label: "Next page", run: () => this.reader.scroll(this.height) },
    ], { label: "Back", run: done }];
    this.bar = new ActionBar(() => this.actions, initialAction ?? 'Back', 'Back');
  }
  render(width: number): string[] {
    const actions = this.bar.available(), shortcuts = actions.filter(action => action.key);
    const hint = this.bar.hint ?? shortcuts.map(action => `${action.key} ${action.label}`).join(" · ");
    this.height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - 3 - (hint ? 1 : 0));
    const body = this.reader.viewport(width, this.height);
    return [truncateToWidth(`${this.title()} · ${this.reader.position}`, width), ...body,
      ...(this.reader.searching ? this.reader.search.render(width)
        : [...hint ? [truncateToWidth(hint, width)] : [], this.bar.render(width), truncateToWidth('←→ Enter · / search · Esc', width)])];
  }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) { return this.reader.handleMouse(event); }
  handleInput(data: string): void {
    // Search owns all text, including action shortcuts and confirmation keys.
    if (this.reader.searching) { this.bar.disarm(); this.reader.handleInput(data); }
    else if (matchesKey(data, Key.escape)) { this.bar.disarm(); this.actions.at(-1)!.run(); }
    else if (!this.bar.handleInput(data)) this.reader.handleInput(data);
    this.tui.requestRender();
  }
}

export async function showDetails(ctx: ExtensionContext, dock: Dock, title: string, text: string): Promise<void> {
  if (ctx.mode !== "tui") { ctx.ui.notify(`${title}\n${text}`); return; }
  dock.setDetail(true);
  try {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => new DetailsView(tui, () => title, new Markdown(text, 0, 0, getMarkdownTheme()), done));
  } finally { dock.setDetail(false); }
}
