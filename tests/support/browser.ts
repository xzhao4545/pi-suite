import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import type { BrowserView } from '../../src/ui/browser.ts';

/** Exercise native focus and action keys without inspecting private view state. */
export function focusBrowser(view: BrowserView, region: string): void {
  for (let i = 0; i < 10; i++) {
    if (stripVTControlCharacters(view.render(120).at(-2)!).startsWith(`${region} ·`)) return;
    view.handleInput('\t');
  }
  assert.fail(`Missing browser region ${region}`);
}
export function chooseBrowserAction(view: BrowserView, label: string): void {
  focusBrowser(view, 'Actions');
  for (let i = 0; i < 20; i++) view.handleInput('\x1b[D');
  for (let i = 0; i < 20; i++) {
    if (view.render(400).some(line => stripVTControlCharacters(line).includes(`[${label}]`))) { view.handleInput('\r'); return; }
    view.handleInput('\x1b[C');
  }
  assert.fail(`Missing browser action ${label}`);
}
