import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, type Component, type KeyId, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";

export type DetailAction = { label: string; run: () => void; key?: KeyId; available?: () => boolean; confirm?: string };
/** Shared detail frame: static Markdown and live log windows use the same reader and controls. */
export class DetailsView implements Component {
  readonly reader: ScrollView;
  private action: DetailAction;
  private armed?: DetailAction;
  private height = 1;
  readonly actions: DetailAction[];
  constructor(private tui: TUI, private title: () => string, content: Component, done: () => void, actions?: DetailAction[], reader?: ScrollView, initialAction?: string) {
    this.reader = reader ?? new ScrollView(content);
    this.actions = [...actions ?? [
      { label: "Previous page", run: () => this.reader.scroll(-this.height) },
      { label: "Next page", run: () => this.reader.scroll(this.height) },
    ], { label: "Back", run: done }];
    this.action = this.actions.find(action => action.label === initialAction) ?? this.actions.at(-1)!;
  }
  private availableActions(): DetailAction[] {
    const actions = this.actions.filter(action => action.available?.() !== false);
    if (!actions.includes(this.action)) this.action = actions.at(-1)!;
    if (this.armed && !actions.includes(this.armed)) this.armed = undefined;
    return actions;
  }
  render(width: number): string[] {
    const actions = this.availableActions(), shortcuts = actions.filter(action => action.key);
    const hint = this.armed?.confirm ?? shortcuts.map(action => `${action.key} ${action.label}`).join(" · ");
    this.height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - 2 - (hint ? 1 : 0));
    const body = this.reader.viewport(width, this.height);
    return [truncateToWidth(`${this.title()} · ${this.reader.position}`, width), ...body,
      ...(this.reader.searching ? this.reader.search.render(width)
        : [...hint ? [truncateToWidth(hint, width)] : [], truncateToWidth(`[${this.action.label}] ←→ Enter · / search · Esc`, width)])];
  }
  invalidate(): void { this.reader.invalidate(); }
  handleMouse(event: TuiMouseEvent) { return this.reader.handleMouse(event); }
  handleInput(data: string): void {
    const actions = this.availableActions(), shortcut = actions.find(action => action.key && matchesKey(data, action.key));
    const confirmed = this.armed === shortcut;
    // The reader's search owns all text. Any other key also disarms a pending control.
    this.armed = undefined;
    if (this.reader.searching) this.reader.handleInput(data);
    else if (shortcut) {
      if (shortcut.confirm && !confirmed) this.armed = shortcut;
      else shortcut.run();
    }
    else if (matchesKey(data, Key.escape)) this.actions.at(-1)!.run();
    else if (matchesKey(data, Key.left)) this.action = actions[Math.max(0, actions.indexOf(this.action) - 1)];
    else if (matchesKey(data, Key.right)) this.action = actions[Math.min(actions.length - 1, actions.indexOf(this.action) + 1)];
    else if (matchesKey(data, Key.enter)) {
      if (this.action.confirm) this.armed = this.action;
      else this.action.run();
    }
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
