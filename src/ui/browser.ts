import { getSelectListTheme, type ExtensionContext, type Theme } from '@earendil-works/pi-coding-agent';
import { Input, Key, SelectList, Text, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth,
  type SelectItem, type KeyId, type SelectListLayoutOptions, type TUI, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { ScrollView } from './scroll.ts';
import type { Dock } from './dock.ts';
import { ActionBar, keyHelp, type DetailAction } from './actions.ts';
import { commandFrame } from './frame.ts';
import { controlRows, cycle, statusLabels, statusRow, titleRow, type BrowseChoice, type BrowseControl, type BrowseSelection } from './browser-chrome.ts';
export type { BrowseChoice, BrowseControl, BrowseSelection } from './browser-chrome.ts';

export interface BrowseItem extends SelectItem { search?: string; details?: () => string | Component }
/** The list owns every command key; details is a reading mode and filter a text mode, both left with Esc. */
type BrowseFocus = 'list' | 'details' | 'filter';
export interface BrowseState { query: string; selected?: string; readers: Map<string, ScrollView>; focus?: BrowseFocus }
export const browseState = (): BrowseState => ({ query: '', readers: new Map() });
/** One page of a multi-page command: its own list state plus the shared page switcher. */
export interface BrowsePage { state: BrowseState; pages: BrowseChoice }
export interface BrowseOptions {
  title: string; items: () => BrowseItem[]; state: BrowseState;
  /** Page tabs live in the title row and switch with 1–9 or [ ]; they are not a focus stop. */
  pages?: BrowseChoice;
  page?: string;
  /** Fixed scope for views such as the selected run's Jobs subtree. */
  scope?: string;
  /** Total before domain filters, when the page exposes a larger scope than items(). */
  total?: () => number;
  controls?: BrowseControl[];
  subscribe?: (refresh: () => void) => () => void;
  ticking?: () => boolean;
  actions?: (item: BrowseItem, done: (value?: string) => void) => DetailAction[];
  /** Enter always resolves the selected value; pages only name what that opens. */
  open?: string;
  selection?: (item: BrowseItem) => BrowseSelection;
  layout?: SelectListLayoutOptions;
}

/** A shared native list owns selection identities; details never become another data source. */
export class BrowserView implements Component {
  focused = true;
  readonly capturesViewportInput = true;
  private input = new Input({ prompt: 'Filter: ' });
  private list!: SelectList;
  private items: BrowseItem[] = [];
  private total = 0;
  private fingerprint = '';
  private visibleRows = 8;
  private focus: BrowseFocus;
  private bar: ActionBar;
  private actionOwner?: string;
  private reader?: ScrollView;
  private leftWidth = 0;
  private wide = false;
  private detailsTop = 0;
  private bodyTop = 1;
  private renderedRows = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(private tui: TUI, private options: BrowseOptions, private done: (value?: string) => void, private theme?: Theme) {
    this.focus = options.state.focus ?? 'list';
    this.bar = new ActionBar(() => this.actions());
    this.input.setValue(options.state.query);
    this.update();
    // Streaming events share one render request; elapsed-time ticks only read live snapshots.
    this.unsubscribe = options.subscribe?.(() => {
      this.refreshTimer ??= setTimeout(() => { this.refreshTimer = undefined; tui.requestRender(); }, 40);
    });
    if (options.ticking) {
      this.clock = setInterval(() => { if (options.ticking!()) tui.requestRender(); }, 1000);
      this.clock.unref();
    }
  }
  dispose(): void { this.unsubscribe?.(); clearTimeout(this.refreshTimer); clearInterval(this.clock); }
  invalidate(): void { this.list.invalidate(); this.reader?.invalidate(); }
  getSelectedItem(): SelectItem | null { return this.list.getSelectedItem(); }
  private selectedItem(): BrowseItem | undefined { return this.items.find(item => item.value === this.list?.getSelectedItem()?.value); }
  private actions(): DetailAction[] {
    const item = this.selectedItem();
    return item ? this.options.actions?.(item, this.done) ?? [] : [];
  }
  private update(reset = false): void {
    const oldIndex = this.items.findIndex(item => item.value === this.list?.getSelectedItem()?.value);
    const all = this.options.items().map(item => ({ ...item, label: sanitizeText(item.label).replace(/[\r\n\t]/g, ' '),
      description: item.description === undefined ? undefined : sanitizeText(item.description).replace(/[\r\n\t]/g, ' ') }));
    this.total = this.options.total?.() ?? all.length;
    this.items = fuzzyFilter(all, this.options.state.query, item => item.search ?? `${item.label} ${item.description ?? ''}`);
    const fingerprint = JSON.stringify([this.visibleRows, this.items.map(item => [item.value, item.label, item.description])]);
    if (reset || fingerprint !== this.fingerprint || !this.list) {
      const previous = reset ? undefined : this.list?.getSelectedItem()?.value ?? this.options.state.selected;
      const index = this.items.findIndex(item => item.value === previous);
      this.list = new SelectList(this.items, this.visibleRows, getSelectListTheme(), this.options.layout);
      this.list.setSelectedIndex(index >= 0 ? index : reset ? 0 : Math.max(0, Math.min(oldIndex, this.items.length - 1)));
      this.list.onSelectionChange = () => this.changed();
      this.list.onSelect = () => this.select();
      this.list.onCancel = () => this.done();
      this.fingerprint = fingerprint;
    }
    this.changed();
    if (this.focus === 'details' && !this.reader) this.focus = 'list';
  }
  private changed(): void {
    const value = this.list.getSelectedItem()?.value;
    this.options.state.selected = value;
    // A confirmation belongs to one record. Moving selection cannot stop the next one.
    if (value !== this.actionOwner) { this.bar.disarm(); this.actionOwner = value; }
    const item = this.items.find(item => item.value === value);
    if (!item?.details) { this.reader = undefined; return; }
    // Each identity retains its own search and scroll when another row or action is opened.
    const details = item.details();
    const content = typeof details === 'string' ? new Text(sanitizeText(details), 0, 0) : details;
    this.reader = this.options.state.readers.get(item.value);
    if (this.reader) this.reader.setContent(content);
    else { this.reader = new ScrollView(content); this.options.state.readers.set(item.value, this.reader); }
  }
  private select(): void { const value = this.list.getSelectedItem()?.value; if (value !== undefined) this.done(value); }
  private setQuery(query: string): void { this.input.setValue(query); this.options.state.query = query; this.update(true); }
  private status(width: number): string {
    const { pages, controls = [], state, selection } = this.options, item = this.selectedItem();
    const page = pages ? pages.items().find(page => page.value === pages.selected())?.label ?? pages.selected() : this.options.page ?? 'List';
    return statusRow(width, page, [...this.options.scope ? [this.options.scope] : [], ...statusLabels(controls), ...state.query ? [`/${state.query}`] : [], `${this.items.length}/${this.total}`],
      item && (selection?.(item) ?? { name: item.label }));
  }
  private help(): string {
    if (this.bar.hint) return this.bar.hint;
    if (this.focus === 'filter') return 'Type to filter · ↑↓ select · Enter keep · Esc clear';
    if (this.focus === 'details') return '↑↓ PgUp PgDn scroll · / search · n/N next · Tab/Esc list';
    const actions = this.bar.render();
    return [...this.items.length ? [`Enter ${this.options.open ?? 'Open'}`] : [], ...actions ? [actions] : [], '/ filter',
      ...this.reader ? ['Tab details'] : [], this.options.state.query ? 'Esc clear filter' : 'Esc close'].join(' · ');
  }
  render(width: number): string[] {
    this.update();
    this.input.focused = this.focus === 'filter';
    const header = [titleRow(this.options.title, this.options.pages, width, this.theme, this.options.page), ...controlRows(this.options.controls ?? [], width, this.theme),
      ...this.focus === 'filter' || this.options.state.query ? this.input.render(width) : []];
    this.bodyTop = header.length;
    const help = this.reader?.searching && this.focus === 'details' ? this.reader.search.render(width) : keyHelp(this.help(), width);
    const height = Math.max(2, Math.floor(this.tui.terminal.rows * 0.8) - header.length - help.length - 3);
    const wide = this.wide = width >= 80;
    this.visibleRows = wide ? Math.max(1, height - 1) : this.focus === 'details' ? 1 : Math.max(1, Math.floor(height / 2) - 1);
    this.update();
    this.leftWidth = wide ? Math.min(52, Math.floor(width * 0.45)) : width;
    const list = this.items.length ? this.list.render(this.leftWidth) : [truncateToWidth('No matching records', this.leftWidth)];
    let body: string[];
    if (wide) {
      const right = this.reader?.viewport(Math.max(1, width - this.leftWidth - 3), height) ?? [];
      body = Array.from({ length: Math.max(list.length, right.length) }, (_, index) => {
        const left = truncateToWidth(list[index] ?? '', this.leftWidth);
        return `${left}${' '.repeat(Math.max(0, this.leftWidth - visibleWidth(left)))} │ ${right[index] ?? ''}`;
      });
    } else {
      const count = this.focus === 'details' ? 1 : Math.max(1, Math.floor(height / 2));
      this.detailsTop = this.bodyTop + Math.min(list.length, count) + 1;
      const details = this.reader?.viewport(width, Math.max(1, height - count - 1));
      body = [...list.slice(0, count), ...(this.reader ? [truncateToWidth(`Details · ${this.reader.position}`, width), ...details!] : [])];
    }
    this.options.state.focus = this.focus;
    const lines = commandFrame(width, [...header, ...body.slice(0, height), this.status(width), ...help], this.theme);
    this.renderedRows = lines.length;
    return lines;
  }
  handleInput(data: string): void {
    this.update();
    const nav = [Key.up, Key.down, Key.pageUp, Key.pageDown].some(key => matchesKey(data, key));
    if (this.focus !== 'list') this.bar.disarm();
    if (this.focus === 'details') {
      if (this.reader?.searching) this.reader.handleInput(data);
      else if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab)) this.focus = 'list';
      else if (matchesKey(data, Key.enter)) this.select();
      else this.reader?.handleInput(data);
    } else if (this.focus === 'filter') {
      // Enter keeps the query and returns command keys to the list; Esc discards it.
      if (matchesKey(data, Key.escape)) { this.setQuery(''); this.focus = 'list'; }
      else if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) this.focus = 'list';
      else if (nav) this.list.handleInput(data);
      else { this.input.handleInput(data); this.options.state.query = this.input.getValue(); this.update(true); }
    } else this.listInput(data, nav);
    this.options.state.focus = this.focus;
    this.tui.requestRender();
  }
  /** Enter is owned by the frame, never by a record action. */
  private listInput(data: string, nav: boolean): void {
    const { pages, controls = [] } = this.options;
    if (matchesKey(data, Key.enter)) { this.bar.disarm(); this.select(); return; }
    // ActionBar clears a pending confirmation on any key it does not own.
    if (this.bar.handleInput(data)) return;
    if (matchesKey(data, Key.escape)) { if (this.options.state.query) this.setQuery(''); else this.done(); }
    else if (matchesKey(data, Key.tab)) { if (this.reader) this.focus = 'details'; }
    else if (matchesKey(data, '/')) this.focus = 'filter';
    else if (nav) this.list.handleInput(data);
    else if (pages && (matchesKey(data, '[') || matchesKey(data, ']'))) cycle(pages, this.done, matchesKey(data, '[') ? -1 : 1);
    else {
      const page = pages?.items().find((_page, index) => index < 9 && matchesKey(data, String(index + 1) as KeyId));
      const control = controls.find(control => matchesKey(data, control.key));
      if (page && page.value !== pages!.selected()) pages!.select(page.value, this.done);
      else if (control) cycle(control, this.done);
    }
  }
  handleMouse(event: TuiMouseEvent) {
    if (event.y <= 0 || event.y >= this.renderedRows - 1) return;
    event = { ...event, y: event.y - 1 };
    if (event.y < this.bodyTop) return;
    if (this.wide ? event.x > this.leftWidth : event.y >= this.detailsTop) {
      this.focus = this.options.state.focus = 'details'; return this.reader?.handleMouse(event);
    }
    this.focus = this.options.state.focus = 'list'; return this.list.handleMouse({ ...event, y: event.y - this.bodyTop });
  }
}

export async function browse(ctx: ExtensionContext, dock: Dock, options: BrowseOptions): Promise<string | undefined> {
  dock.setDetail(true);
  try { return await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => new BrowserView(tui, options, done, theme)); }
  finally { dock.setDetail(false); }
}
