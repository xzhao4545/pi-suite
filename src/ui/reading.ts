import type { ExtensionContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import type { Component, OverlayOptions, TUI } from '@earendil-works/pi-tui';

type ReadingComponent = Component & { dispose?(): void };
type ReadingFactory<T> = (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (value: T) => void) => ReadingComponent | Promise<ReadingComponent>;

/** One ceiling for both the overlay and its reader prevents Pi from clipping the footer after rendering. */
export const readingRows = (tui: TUI): number => tui.mode === 'fullscreen' ? tui.terminal.rows : Math.max(1, Math.floor(tui.terminal.rows * 0.7));
export function readingOverlayOptions(tui: TUI): OverlayOptions {
  return tui.mode === 'fullscreen'
    ? {anchor: 'top-left', width: '100%', maxHeight: '100%', margin: 0}
    // Pi evaluates the custom-view options factory only on opening. Percentage values
    // are resolved by TUI on every render, keeping the ceiling aligned after resize.
    : {anchor: 'center', width: '90%', maxHeight: '70%', margin: 0};
}

/** Use Pi's focused overlay lifecycle; done() restores the previous focus and transcript viewport. */
export function openReading<T>(ctx: ExtensionContext, factory: ReadingFactory<T>): Promise<T> {
  let terminal: TUI;
  return ctx.ui.custom<T>((tui, theme, keys, done) => {
    terminal = tui;
    return factory(tui, theme, keys, done);
  }, {overlay: true, overlayOptions: () => readingOverlayOptions(terminal)});
}
