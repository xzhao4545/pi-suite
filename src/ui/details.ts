import { getMarkdownTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Dock } from "./dock.ts";
import { ScrollView } from "./scroll.ts";

export async function showDetails(ctx: ExtensionContext, dock: Dock, title: string, text: string): Promise<void> {
  if (ctx.mode !== "tui") { ctx.ui.notify(`${title}\n${text}`); return; }
  dock.setDetail(true);
  try {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const view = new ScrollView(new Markdown(text, 0, 0, getMarkdownTheme()));
      let action = 2, height = 1;
      return {
        render(width) {
          height = Math.max(1, Math.floor(tui.terminal.rows * 0.8) - 2);
          return [truncateToWidth(`${title} · ${view.position}`, width), ...view.viewport(width, height),
            ...(view.searching ? view.search.render(width) : [truncateToWidth(`[${["Previous page", "Next page", "Back"][action]}] ←→ Enter · / search · Esc`, width)])];
        },
        invalidate: () => view.invalidate(),
        handleMouse: event => view.handleMouse(event),
        handleInput(data) {
          if (view.searching) view.handleInput(data);
          else if (matchesKey(data, Key.escape)) done();
          else if (matchesKey(data, Key.left)) action = Math.max(0, action - 1);
          else if (matchesKey(data, Key.right)) action = Math.min(2, action + 1);
          else if (matchesKey(data, Key.enter)) { if (action === 2) done(); else view.scroll(action === 0 ? -height : height); }
          else view.handleInput(data);
          tui.requestRender();
        },
      };
    });
  } finally { dock.setDetail(false); }
}
