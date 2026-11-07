import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import type { BrowserView } from '../../src/ui/browser.ts';

/** Only the list, detail reader and filter are focus regions; use the public interaction contract. */
export function focusBrowser(view: BrowserView, region: 'List' | 'Details' | 'Filter'): void {
  const text = stripVTControlCharacters(view.render(400).join('\n'));
  if (text.includes('Type to filter')) view.handleInput('\r');
  else if (text.includes('Tab/Esc list')) view.handleInput('\t');
  if (region === 'Filter') view.handleInput('/');
  else if (region === 'Details') view.handleInput('\t');
}

/** Read the advertised key instead of simulating a cursor on an action bar. */
export function chooseBrowserAction(view: BrowserView, label: string): void {
  focusBrowser(view, 'List');
  const help = stripVTControlCharacters(view.render(600).join('\n')).split(' · ');
  const cell = help.find(cell => cell.trim().endsWith(` ${label}`));
  assert.ok(cell, `Missing browser action ${label}`);
  const key = cell.trim().split(' ')[0];
  view.handleInput(key === 'Enter' ? '\r' : key);
}
