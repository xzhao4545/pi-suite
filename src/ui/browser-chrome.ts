import type { Theme } from '@earendil-works/pi-coding-agent';
import { sanitizeText } from '../runtime/text.ts';
import { truncateToWidth, visibleWidth, type KeyId, type SelectItem } from '@earendil-works/pi-tui';

/** A choice applies as soon as it is picked; there is no cursor that differs from the applied value. */
export interface BrowseChoice { items: () => SelectItem[]; selected: () => string; select: (value: string, done: (value?: string) => void) => void }
/** Item descriptions (e.g. counts) appear in the control row; the status line names only the label. */
export interface BrowseControl extends BrowseChoice { key: KeyId; label: string }
export interface BrowseSelection { name: string; id?: string }

const current = (choice: BrowseChoice) => choice.items().find(item => item.value === choice.selected());
const cell = (item: SelectItem) => item.description ? `${item.label} ${item.description}` : item.label;
const mark = (text: string, on: boolean, theme?: Theme) => on ? theme?.fg('accent', theme.bold(`[${text}]`)) ?? `[${text}]` : theme?.fg('dim', text) ?? text;

/** Pressing a control key moves to the next choice and applies it immediately. */
export function cycle(choice: BrowseChoice, done: (value?: string) => void, step = 1): void {
  const items = choice.items(), index = items.findIndex(item => item.value === choice.selected());
  if (items.length) choice.select(items[(index + step + items.length) % items.length].value, done);
}

/** `<command> ▸ <page>` always leads; the tab bar degrades to bare digits, then disappears, before the page name is cut. */
export function titleRow(title: string, pages: BrowseChoice | undefined, width: number, theme?: Theme, page?: string): string {
  const head = `${title} ▸ ${pages ? current(pages)?.label ?? pages.selected() : page ?? 'List'}`;
  if (!pages) return truncateToWidth(head, width);
  const items = pages.items();
  for (const full of [true, false]) {
    const tabs = items.map((item, i) => mark(full ? `${i + 1} ${item.label}` : `${i + 1}`, item.value === pages.selected(), theme)).join(full ? '  ' : ' ');
    const line = `${head}    ${tabs}`;
    if (visibleWidth(line) <= width) return line;
  }
  return truncateToWidth(head, width);
}

export function controlRows(controls: BrowseControl[], width: number, theme?: Theme): string[] {
  const rows = controls.map(control => `${control.label} (${control.key}): ${control.items()
    .map(item => mark(cell(item), item.value === control.selected(), theme)).join(' · ')}`);
  if (rows.length && visibleWidth(rows.join('    ')) <= width) return [rows.join('    ')];
  return controls.map((control, i) => {
    if (visibleWidth(rows[i]) <= width) return rows[i];
    // Narrow rows keep only the applied value; its key still reaches the hidden choices.
    const item = current(control);
    return truncateToWidth(`${control.label} (${control.key}): ${item ? cell(item) : control.selected()} ›`, width);
  });
}

export function statusLabels(controls: BrowseControl[]): string[] { return controls.map(control => current(control)?.label ?? control.selected()); }

/**
 * Status line: page, filters, matches and the selected record. Below 80 columns the page and
 * selection move to the front. Both name and ID receive space, even for a long workflow ID.
 */
export function statusRow(width: number, page: string | undefined, filters: string[], selection?: BrowseSelection): string {
  const literal = (text: string) => sanitizeText(text).replace(/[\r\n\t]/g, ' ');
  const fit = (max: number) => {
    if (!selection) return '';
    const name = literal(selection.name), id = selection.id && literal(selection.id);
    if (!id) return truncateToWidth(name, max);
    // Names explain what is selected; IDs disambiguate it. Neither may consume the entire row.
    const nameRoom = Math.min(visibleWidth(name), Math.max(1, Math.floor((max - 3) / 2)));
    const shownId = truncateToWidth(id, Math.max(0, max - nameRoom - 3));
    return `${truncateToWidth(name, max - visibleWidth(shownId) - 3)} (${shownId})`;
  };
  const head = [...page ? [page] : [], ...filters].join(' · ');
  const room = width - visibleWidth(head) - 3;
  if (!selection) return truncateToWidth(head, width);
  if (width >= 80 && room >= 12) return `${head} · ${fit(room)}`;
  const prefix = page ? `${page} · ` : '';
  return truncateToWidth([prefix + fit(width - visibleWidth(prefix)), ...filters].join(' · '), width);
}
