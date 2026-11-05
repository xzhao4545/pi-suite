import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";

export type DetailAction = { label: string; run: () => void };
/** Shared detail frame: static Markdown and live log windows use the same reader and controls. */
export class DetailsView implements Component {
  readonly reader: ScrollView;
  private action: number;
  private height = 1;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, done: () => void, actions?: DetailAction[]) {
    this.reader = new ScrollView(content);
    this.actions = [...actions ?? [
      { label: "Previous page", run: () => this.reader.scroll(-this.height) },
      { label: "Next page", run: () => this.reader.scroll(this.height) },
    ], { label: "Back", run: done }];
    this.action = this.actions.length - 1;
  }
  render(width: number): string[] {
    this.height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - 2);
    const body = this.reader.viewport(width, this.height);
    return [truncateToWidth(`${this.title()} · ${this.reader.position}`, width), ...body,
      ...(this.reader.searching ? this.reader.search.render(width)
        : [truncateToWidth(`[${this.actions[this.action].label}] ←→ Enter · / search · Esc`, width)])];
  }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) { return this.reader.handleMouse(event); }
  handleInput(data: string): void {
    if (this.reader.searching) this.reader.handleInput(data);
    else if (matchesKey(data, Key.escape)) this.actions.at(-1)!.run();
    else if (matchesKey(data, Key.left)) this.action = Math.max(0, this.action - 1);
    else if (matchesKey(data, Key.right)) this.action = Math.min(this.actions.length - 1, this.action + 1);
    else if (matchesKey(data, Key.enter)) this.actions[this.action].run();
    else this.reader.handleInput(data);
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
