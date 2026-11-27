import type { ExtensionContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { CURSOR_MARKER, truncateToWidth, type Component, type OverlayHandle, type OverlayOptions, type TUI } from '@earendil-works/pi-tui';

type ReadingComponent = Component & { dispose?(): void };
export type ReadingFactory<T> = (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (value: T) => void) => ReadingComponent | Promise<ReadingComponent>;

type ReadingSession = { depth: number; frame?: OverlayHandle };
const sessions = new WeakMap<ExtensionContext, ReadingSession>();
const fullScreens = new WeakMap<object, number>();
function fullScreenLease(owner: object): () => void {
  fullScreens.set(owner, (fullScreens.get(owner) ?? 0) + 1);
  return () => {
    const remaining = fullScreens.get(owner)! - 1;
    if (remaining) fullScreens.set(owner, remaining); else fullScreens.delete(owner);
  };
}

/** A command owns the handoff scope, not its size: ordinary browser pages stay 90%/70%. */
export async function withReadingSession<T>(ctx: ExtensionContext, action: () => Promise<T>): Promise<T> {
  let session = sessions.get(ctx);
  if (!session) { session = {depth: 0}; sessions.set(ctx, session); }
  session.depth++;
  try { return await action(); }
  finally {
    if (--session.depth === 0) { session.frame?.hide(); sessions.delete(ctx); }
  }
}
export async function withReadingScreen<T>(ctx: ExtensionContext, action: () => Promise<T>): Promise<T> {
  const release = fullScreenLease(ctx);
  try { return await withReadingSession(ctx, action); }
  finally { release(); }
}
export const isReadingSession = (ctx: ExtensionContext): boolean => sessions.has(ctx);
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
export function readingWindow(lines: readonly string[], height: number): string[] {
  const rows = Math.max(0, Math.floor(height));
  return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill('')];
}

export function readingText(render: (width: number) => readonly string[]): Component {
  return {render: width => render(width).map(line => truncateToWidth(line, width)), invalidate() {}};
}

/** Stock custom owns each live page; only Suite's already-rendered frame survives between pages. */
export async function openReading<T>(ctx: ExtensionContext, factory: ReadingFactory<T>): Promise<T> {
  const session = sessions.get(ctx), previous = session?.frame;
  let terminal: TUI, release: (() => void) | undefined;
  try {
    return await ctx.ui.custom<T>(async (tui, theme, keys, done) => {
      terminal = tui;
      if (fullScreens.has(ctx)) release = fullScreenLease(tui);
      const options = readingOverlayOptions(tui), coversScreen = fullScreen(tui);
      let completed = false, frame: string[] | undefined;
      const complete = (value: T) => {
        if (completed) return;
        completed = true;
        if (session && frame) {
          const retained = frame.map(line => line.replaceAll(CURSOR_MARKER, ''));
          const old = session.frame;
          // Install the frozen, capturing frame BEFORE done: stock custom hides/disposes
          // immediately and its keyboard nextTick render can precede the next factory.
          // No component resources/callbacks survive here, only our own rendered lines.
          session.frame = tui.showOverlay({
            // Size belongs to the completed page, not the next page's lease. In
            // particular, a full-screen history still covers resize while loading a list.
            render: width => readingWindow(retained.map(line => truncateToWidth(line, width)),
              coversScreen ? tui.terminal.rows : Math.max(1, Math.floor(tui.terminal.rows * 0.7))),
            invalidate() {}, capturesViewportInput: true, handleInput() {},
          }, options);
          old?.hide();
        }
        done(value);
      };
      const component = await factory(tui, theme, keys, complete);
      // A factory may finish before returning its component. Stock custom cannot dispose
      // an instance it never mounted; release that instance here rather than leaking it.
      if (completed) { component.dispose?.(); return component; }
      const render = component.render.bind(component);
      component.render = width => {
        const lines = render(width);
        frame = (fullScreen(tui) ? readingWindow(lines, readingRows(tui)) : lines).slice();
        return frame;
      };
      return component;
    }, {overlay: true, overlayOptions: () => readingOverlayOptions(terminal), onHandle: () => {
      // onHandle runs only after the new page is constructed and mounted. Removing our
      // raw overlay now leaves the new capturing page in place, never the primary UI.
      previous?.hide();
      if (session?.frame === previous && session) session.frame = undefined;
    }});
  } finally { release?.(); }
}
