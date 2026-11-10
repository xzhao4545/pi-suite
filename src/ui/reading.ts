import type { ExtensionContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, type Component, type OverlayHandle, type OverlayOptions, type TUI } from '@earendil-works/pi-tui';

type ReadingComponent = Component & { dispose?(): void };
export type ReadingFactory<T> = (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (value: T) => void) => ReadingComponent | Promise<ReadingComponent>;

// The context lease follows a reader through child pages; the TUI lease exists only
// while a real overlay is open. Native mode/footer instances are never replaced.
const fullScreens = new WeakMap<object, number>();
const screenCovers = new WeakMap<ExtensionContext, OverlayHandle>();
function fullScreenLease(owner: object): () => void {
  fullScreens.set(owner, (fullScreens.get(owner) ?? 0) + 1);
  return () => {
    const remaining = fullScreens.get(owner)! - 1;
    if (remaining) fullScreens.set(owner, remaining); else fullScreens.delete(owner);
  };
}
export async function withReadingScreen<T>(ctx: ExtensionContext, action: () => Promise<T>): Promise<T> {
  const release = fullScreenLease(ctx);
  try { return await action(); }
  finally {
    release();
    if (!fullScreens.has(ctx)) { screenCovers.get(ctx)?.hide(); screenCovers.delete(ctx); }
  }
}
export const isReadingScreen = (ctx: ExtensionContext): boolean => fullScreens.has(ctx);
const fullScreen = (tui: TUI) => tui.mode === 'fullscreen' || fullScreens.has(tui);

/** One ceiling for both the overlay and its reader prevents Pi from clipping the footer after rendering. */
export const readingRows = (tui: TUI): number => fullScreen(tui) ? tui.terminal.rows : Math.max(1, Math.floor(tui.terminal.rows * 0.7));
export function readingOverlayOptions(tui: TUI): OverlayOptions {
  return fullScreen(tui)
    ? {anchor: 'top-left', width: '100%', maxHeight: '100%', margin: 0}
    // Pi evaluates the custom-view options factory only on opening. Percentage values
    // are resolved by TUI on every render, keeping the ceiling aligned after resize.
    : {anchor: 'center', width: '90%', maxHeight: '70%', margin: 0};
}

/** Shared explicit window budget: short views must still occupy the whole cover. */
export function readingWindow(lines: string[], height: number): string[] {
  const rows = Math.max(0, Math.floor(height));
  return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill('')];
}

export function readingText(render: (width: number) => string[]): Component {
  return {render: width => render(width).map(line => truncateToWidth(line, width)), invalidate() {}};
}

/** Use Pi's focused overlay lifecycle; done() restores the previous focus and transcript viewport. */
export async function openReading<T>(ctx: ExtensionContext, factory: ReadingFactory<T>): Promise<T> {
  let terminal: TUI, release: (() => void) | undefined;
  try {
    return await ctx.ui.custom<T>(async (tui, theme, keys, done) => {
      terminal = tui;
      if (fullScreens.has(ctx)) {
        release = fullScreenLease(tui);
        // Keep the main footer and editor covered while asynchronous child pages open.
        // A native capturing backdrop also prevents typing into an invisible main editor.
        if (!screenCovers.has(ctx)) screenCovers.set(ctx, tui.showOverlay({
          render: () => readingWindow([], tui.terminal.rows), invalidate() {},
          capturesViewportInput: true, handleInput() {},
        }, readingOverlayOptions(tui)));
      }
      const component = await factory(tui, theme, keys, done);
      // Stock overlay height follows rendered rows. Keep native input/components intact,
      // wrapping only the output budget instead of replacing the host's footer or mode.
      const render = component.render.bind(component);
      component.render = width => fullScreen(tui) ? readingWindow(render(width), readingRows(tui)) : render(width);
      return component;
    }, {overlay: true, overlayOptions: () => readingOverlayOptions(terminal)});
  } finally { release?.(); }
}
