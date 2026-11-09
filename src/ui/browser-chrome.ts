import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { sanitizeText } from '../runtime/text.ts';
import { truncateToWidth, visibleWidth, type KeyId, type SelectItem } from '@earendil-works/pi-tui';

/** A choice applies as soon as it is picked; there is no cursor that differs from the applied value. */
export interface BrowseChoice { items: () => SelectItem[]; selected: () => string; select: (value: string, done: (value?: string) => void) => void }
/** Item descriptions (e.g. counts) appear in the control row; the status line names only the label. */
export interface BrowseControl extends BrowseChoice { key: KeyId; label: string }
export interface BrowseSelection { name: string; id?: string }
/** Explicit fields prevent a state word in an object's name from acquiring status color. */
export interface DisplayField { text: string; state?: string; tone?: ThemeColor }
export type DisplayText = string | readonly DisplayField[];

const current = (choice: BrowseChoice) => choice.items().find(item => item.value === choice.selected());
const cell = (item: SelectItem) => item.description ? `${item.label} ${item.description}` : item.label;
const paint = (token: ThemeColor, text: string, theme?: Theme) => theme?.fg(token, text) ?? text;
const strong = (text: string, theme?: Theme) => theme?.bold(text) ?? text;
/** Browser and detail roles live here so pages provide data, never ANSI or palette choices. */
export const heading = (text: string, theme?: Theme) => paint('accent', strong(text, theme), theme);
/** Focus decorates chrome only; record states and highlighted reader content keep their own palette. */
export const focusLabel = (text: string, active: boolean, theme?: Theme) => active ? heading(`▸ ${text}`, theme) : paint('muted', `  ${text}`, theme);
const focusRule = (text: string, active: boolean, theme?: Theme) => paint(active ? 'accent' : 'borderMuted', text, theme);
const ruled = (text: string, width: number, active: boolean, theme?: Theme) => {
  const caption = truncateToWidth(text, width), room = width - visibleWidth(caption);
  return caption + (room > 1 ? focusRule(` ${'─'.repeat(room - 1)}`, active, theme) : ' '.repeat(room));
};
export const paneHeading = (text: string, width: number, active: boolean, theme?: Theme) => ruled(focusLabel(text, active, theme), width, active, theme);
export const feedback = (text: string, error: boolean, theme?: Theme) => paint(error ? 'error' : 'muted', text, theme);
export const newOutputHint = (theme?: Theme, compact = false) => compact ? `${paint('dim', '↓ ', theme)}${keyToken('End', theme)}`
  : `${paint('dim', '↓ new output · ', theme)}${keyHint('End', 'to follow', theme)}`;
/** The title names what is being read; on narrow screens the new-output hint shrinks before the title disappears. */
export function readerHeading(title: string, position: string, hasNewOutput: boolean, width: number, theme?: Theme, active?: boolean): string {
  const suffix = (compact: boolean) => `${paint('muted', ` · ${position}`, theme)}${hasNewOutput ? ` · ${newOutputHint(theme, compact)}` : ''}`;
  const tail = width - visibleWidth(suffix(false)) >= 16 ? suffix(false) : suffix(true);
  const shownTitle = truncateToWidth(title, Math.max(0, width - visibleWidth(tail) - (active === undefined ? 0 : 2)));
  const caption = (active === undefined ? heading(shownTitle, theme) : focusLabel(shownTitle, active, theme)) + tail;
  return active === undefined ? truncateToWidth(caption, width) : ruled(caption, width, active, theme);
}
export const selectedTab = (text: string, theme?: Theme) => theme?.bg('selectedBg', strong(text, theme)) ?? text;
export const keyToken = (key: string, theme?: Theme) => paint(key === 'x' ? 'error' : 'warning', strong(key, theme), theme);
export const keyHint = (key: string, action: string, theme?: Theme) => `${keyToken(key, theme)} ${paint('dim', action, theme)}`;
export const confirmation = (key: string, action: string, theme?: Theme) =>
  `${paint(key === 'x' ? 'error' : 'warning', `Press ${keyToken(key, theme)} again to ${action}`, theme)} · ${paint('dim', 'any other key cancels', theme)}`;
export const divider = (text: string, theme?: Theme) => paint('borderMuted', text, theme);
export const separator = (width: number, theme?: Theme) => divider('─'.repeat(width), theme);
export const selectedRow = (text: string, width: number, theme?: Theme, active = true) => {
  const marker = paint(active ? 'accent' : 'muted', text.slice(0, 2), theme);
  const row = `${marker}${text.slice(2)}${' '.repeat(Math.max(0, width - visibleWidth(text)))}`;
  // An inactive selection still identifies the record, but cannot compete with the focused pane.
  if (!active || !theme) return row;
  // TUI truncation emits SGR 0; restore only the selection background, never a row-wide foreground.
  return theme.bg('selectedBg', strong(row, theme).replace(/\x1b\[0m/g, '\x1b[0m' + theme.getBgAnsi('selectedBg')));
};
const stateTones: Record<string, ThemeColor> = { running: 'success', starting: 'success', waiting: 'warning', 'waiting(parent)': 'warning',
  'cleanup pending': 'warning', 'cleanup unconfirmed': 'warning', stopping: 'warning', queued: 'warning',
  failed: 'error', limited: 'error', timed_out: 'error', completed: 'dim', stopped: 'dim', doing: 'success', blocked: 'warning', done: 'dim',
  enabled: 'success', disabled: 'dim', paused: 'warning', todo: 'accent' };
export const stateTone = (state: string): ThemeColor | undefined => stateTones[state];
/** Structured fields are literal domain data; sanitize before adding trusted theme escapes. */
export function displayText(value: DisplayText, theme?: Theme, fallbackTone?: ThemeColor): string {
  if (typeof value === 'string') return fallbackTone && value ? paint(fallbackTone, value, theme) : value;
  return value.map(field => {
    const text = sanitizeText(field.text).replace(/[\r\n\t]/g, ' '), tone = field.state ? stateTone(field.state) : field.tone;
    const shown = field.state === 'done' ? theme?.strikethrough(text) ?? text : text;
    return tone || fallbackTone ? paint(tone ?? fallbackTone!, shown, theme) : shown;
  }).join('');
}
export function recordStyle(text: DisplayText, state: string | undefined, theme?: Theme): string {
  if (typeof text !== 'string') return displayText(text, theme);
  if (!state) return text;
  const tone = stateTone(state);
  if (!tone) return text;
  if (['todo', 'doing', 'blocked', 'done'].includes(state)) return paint(tone, state === 'done' ? theme?.strikethrough(text) ?? text : text, theme);
  if (state === 'enabled' || state === 'disabled') text = text.replace(state === 'enabled' ? '●' : '○', icon => paint(tone, icon, theme));
  // Only color a declared state at a field boundary, not a matching word in a record's name.
  const literal = state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^| · |(?:job_[a-f0-9]{8}|wf_[a-f0-9]{12}) )(${literal})(?= · |$)`), (_match, prefix: string, word: string) => prefix + paint(tone, word, theme));
}
const mark = (text: string, on: boolean, theme?: Theme) => on ? heading(text, theme) : paint('muted', text, theme);

/** Pressing a control key moves to the next choice and applies it immediately. */
export function cycle(choice: BrowseChoice, done: (value?: string) => void, step = 1): void {
  const items = choice.items(), index = items.findIndex(item => item.value === choice.selected());
  if (items.length) choice.select(items[(index + step + items.length) % items.length].value, done);
}

/** `<command> ▸ <page>` always leads; the tab bar degrades to bare digits, then disappears, before the page name is cut. */
export function titleRow(title: string, pages: BrowseChoice | undefined, width: number, theme?: Theme, page?: string): string {
  const head = heading(`${title} ▸ ${pages ? current(pages)?.label ?? pages.selected() : page ?? 'List'}`, theme);
  if (!pages) return truncateToWidth(head, width);
  const items = pages.items();
  for (const full of [true, false]) {
    const tabs = items.map((item, i) => {
      const selected = item.value === pages.selected();
      const tab = `${keyToken(String(i + 1), theme)}${full ? ` ${paint(selected ? 'text' : 'muted', item.label, theme)}` : ''}`;
      return selected ? selectedTab(tab, theme) : tab;
    }).join(full ? '  ' : ' ');
    const line = `${head}    ${tabs}`;
    if (visibleWidth(line) <= width) return line;
  }
  return truncateToWidth(head, width);
}

export function controlRows(controls: BrowseControl[], width: number, theme?: Theme): string[] {
  const label = (control: BrowseControl) => `${paint('muted', control.label, theme)} (${keyToken(control.key, theme)}): `;
  const rows = controls.map(control => `${label(control)}${control.items()
    .map(item => mark(cell(item), item.value === control.selected(), theme)).join(' · ')}`);
  if (rows.length && visibleWidth(rows.join('    ')) <= width) return [rows.join('    ')];
  return controls.map((control, i) => {
    if (visibleWidth(rows[i]) <= width) return rows[i];
    // Narrow rows keep only the applied value; its key still reaches the hidden choices.
    const item = current(control);
    return truncateToWidth(`${label(control)}${mark(item ? cell(item) : control.selected(), true, theme)} ›`, width);
  });
}

export function statusLabels(controls: BrowseControl[]): string[] { return controls.map(control => current(control)?.label ?? control.selected()); }

/** Existing controls already describe an empty list's escape route; no page-specific key prose. */
export function emptyRow(page: string, controls: BrowseControl[], query: string, pages?: BrowseChoice, theme?: Theme): string {
  const next = (message: string, key: string, action: string) => `${paint('dim', message, theme)} · ${paint('dim', 'press ', theme)}${keyHint(key, action, theme)}`;
  if (query) return next('No matches', 'Esc', 'to clear filter');
  const filter = controls.find(control => control.items().some(item => item.value === 'all') && control.selected() !== 'all');
  if (filter) {
    const all = filter.items().find(item => item.value === 'all')!;
    return next(`No ${current(filter)?.label.toLowerCase()} ${page.toLowerCase()}`, filter.key, `for ${all.label}${all.description ? ` (${all.description})` : ''}`);
  }
  const control = controls.find(control => control.items().length > 1);
  if (control) {
    const items = control.items(), index = items.findIndex(item => item.value === control.selected());
    return next(`No ${page.toLowerCase()}`, control.key, `for ${items[(index + 1) % items.length].label}`);
  }
  const pageIndex = pages?.items().findIndex(item => item.value !== pages.selected()) ?? -1;
  return pageIndex >= 0 ? next(`No ${page.toLowerCase()}`, String(pageIndex + 1), `for ${pages!.items()[pageIndex].label}`)
    : next(`No ${page.toLowerCase()}`, 'Esc', 'to close');
}

/**
 * Status line: page, filters, matches and the selected record. Below 80 columns the page and
 * selection move to the front. Both name and ID receive space, even for a long workflow ID.
 */
export function statusRow(width: number, page: string | undefined, filters: string[], selection?: BrowseSelection, theme?: Theme): string {
  const literal = (text: string) => sanitizeText(text).replace(/[\r\n\t]/g, ' ');
  const fit = (max: number) => {
    if (!selection) return '';
    const name = literal(selection.name), id = selection.id && literal(selection.id);
    if (!id) return paint('text', truncateToWidth(name, max), theme);
    // Names explain what is selected; IDs disambiguate it. Neither may consume the entire row.
    const nameRoom = Math.min(visibleWidth(name), Math.max(1, Math.floor((max - 3) / 2)));
    const shownId = truncateToWidth(id, Math.max(0, max - nameRoom - 3));
    return `${paint('text', truncateToWidth(name, max - visibleWidth(shownId) - 3), theme)} ${paint('muted', `(${shownId})`, theme)}`;
  };
  const join = ' · ', filterText = paint('muted', filters.join(join), theme);
  const head = [...page ? [paint('text', page, theme)] : [], ...filters.length ? [filterText] : []].join(paint('muted', join, theme));
  const room = width - visibleWidth(head) - 3;
  if (!selection) return truncateToWidth(head, width);
  if (width >= 80 && room >= 12) return `${head}${paint('muted', join, theme)}${fit(room)}`;
  const prefix = page ? `${paint('text', page, theme)}${paint('muted', join, theme)}` : '';
  return truncateToWidth([prefix + fit(width - visibleWidth(prefix)), ...filters.length ? [filterText] : []].join(paint('muted', join, theme)), width);
}
