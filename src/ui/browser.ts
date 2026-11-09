import { getSelectListTheme, type ExtensionContext, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { Input, Key, SelectList, Text, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth,
  type SelectItem, type KeyId, type SelectListLayoutOptions, type TUI, type Component, type TuiMouseEvent, type TuiMouseEventResult } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { ScrollView } from './scroll.ts';
import type { Dock } from './dock.ts';
import { InlineInput } from './inline-input.ts';
import { ActionBar, type DetailAction } from './actions.ts';
import { commandFrame } from './frame.ts';
import { DoubleLeft, type ViewerNavigation } from './viewer/navigation.ts';
import { controlRows, cycle, divider, displayText, emptyRow, focusLabel, keyHint, paneHeading, readerHeading, recordStyle, selectedRow, separator, statusLabels, statusRow, titleRow, type BrowseChoice, type BrowseControl, type BrowseSelection, type DisplayText } from './browser-chrome.ts';
export type { BrowseChoice, BrowseControl, BrowseSelection } from './browser-chrome.ts';

export interface BrowseItem extends SelectItem { search?: string; status?: string; display?: DisplayText; details?: () => string | Component }
export type BrowseLayout = Omit<SelectListLayoutOptions, 'truncatePrimary'> & {
  truncatePrimary?: (context: Parameters<NonNullable<SelectListLayoutOptions['truncatePrimary']>>[0] & {theme?: Theme}) => string;
};
/** Browsing is not tool pagination: active execution stays above even newly finished history. */
export function compareActivity<T extends { createdAt: string; startedAt?: string; lastUpdateAt?: string; endedAt?: string }>(a: T, b: T, active: (item: T) => boolean): number {
  const time = (item: T) => (!active(item) && item.endedAt) || item.lastUpdateAt || item.startedAt || item.createdAt;
  return Number(active(b)) - Number(active(a)) || time(b).localeCompare(time(a));
}
/** The list owns every command key; details is a reading mode and filter a text mode, both left with Esc. */
type BrowseFocus = 'list' | 'details' | 'filter';
export interface BrowseState { query: string; selected?: string; readers: Map<string, ScrollView>; focus?: BrowseFocus }
export const browseState = (): BrowseState => ({ query: '', readers: new Map() });
/** One page of a multi-page command: its own list state plus the shared page switcher. */
export interface BrowsePage { state: BrowseState; pages: BrowseChoice; navigation?: ViewerNavigation }
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
  navigation?: ViewerNavigation;
  layout?: BrowseLayout;
}

/** A shared native list owns selection identities; details never become another data source. */
export class BrowserView implements Component {
  focused = true;
  readonly capturesViewportInput = true;
  private input = new Input({ prompt: '' });
  private list!: SelectList;
  private items: BrowseItem[] = [];
  private total = 0;
  private fingerprint = '';
  private visibleRows = 8;
  private focus: BrowseFocus;
  private bar: ActionBar;
  private composer: InlineInput;
  private doubleLeft = new DoubleLeft();
  private actionOwner?: string;
  private reader?: ScrollView;
  private leftWidth = 0;
  private wide = false;
  private detailsTop = 0;
  private filterTop = -1;
  private bodyTop = 1;
  private bodyBottom = 1;
  private renderedRows = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(private tui: TUI, private options: BrowseOptions, private done: (value?: string) => void, private theme?: Theme, keys?: KeybindingsManager) {
    this.focus = options.state.focus ?? 'list';
    this.composer = new InlineInput(() => tui.requestRender(), theme, tui, keys);
    this.bar = new ActionBar(() => this.actions(), request => this.composer.open(request));
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
  dispose(): void { this.doubleLeft.reset(); this.composer.dispose(); this.unsubscribe?.(); clearTimeout(this.refreshTimer); clearInterval(this.clock); }
  invalidate(): void { this.list.invalidate(); this.reader?.invalidate(); }
  getSelectedItem(): SelectItem | null { return this.list.getSelectedItem(); }
  private selectedItem(): BrowseItem | undefined { return this.items.find(item => item.value === this.list?.getSelectedItem()?.value); }
  private actions(): DetailAction[] {
    const item = this.selectedItem();
    return item ? this.options.actions?.(item, this.done) ?? [] : [];
  }
  private update(reset = false): void {
    const oldIndex = this.items.findIndex(item => item.value === this.list?.getSelectedItem()?.value);
    const all = this.options.items().map(item => ({ ...item, label: item.display ? displayText(item.display, this.theme) : sanitizeText(item.label).replace(/[\r\n\t]/g, ' '),
      description: item.description === undefined ? undefined : sanitizeText(item.description).replace(/[\r\n\t]/g, ' ') }));
    this.total = this.options.total?.() ?? all.length;
    this.items = fuzzyFilter(all, this.options.state.query, item => item.search ?? `${item.label} ${item.description ?? ''}`);
    const fingerprint = JSON.stringify([this.visibleRows, this.items.map(item => [item.value, item.label, item.description, item.status])]);
    if (reset || fingerprint !== this.fingerprint || !this.list) {
      const previous = reset ? undefined : this.list?.getSelectedItem()?.value ?? this.options.state.selected;
      const index = this.items.findIndex(item => item.value === previous);
      // Native SelectList still owns selection and scrolling. Its selectedText callback receives
      // the complete visible row, so background and marker do not require a parallel renderer.
      this.list = new SelectList(this.items, this.visibleRows, { ...getSelectListTheme(),
        selectedText: text => selectedRow(text, this.leftWidth, this.theme, this.active('list')) }, {
        ...this.options.layout, truncatePrimary: context => {
          const text = this.options.layout?.truncatePrimary?.({...context, theme: this.theme}) ?? truncateToWidth(context.text, context.maxWidth, '');
          return (context.item as BrowseItem).display ? text : recordStyle(text, (context.item as BrowseItem).status, this.theme);
        },
      });
      this.list.setSelectedIndex(index >= 0 ? index : reset ? 0 : Math.max(0, Math.min(oldIndex, this.items.length - 1)));
      this.list.onSelectionChange = () => this.changed();
      this.list.onSelect = () => this.select();
      this.list.onCancel = () => this.done();
      this.fingerprint = fingerprint;
    }
    this.changed();
    this.setFocus(this.focus);
  }
  private setFocus(focus: BrowseFocus): void {
    this.focus = this.options.state.focus = focus === 'details' && !this.reader ? 'list' : focus;
    if (this.focus !== 'list') this.bar.disarm();
  }
  private active(focus: BrowseFocus): boolean {
    return this.focused && !this.composer.active && this.focus === focus && !(focus === 'details' && this.reader?.searching);
  }
  /** Native inputs own their cursor; the prefix consumes columns, never another layout row. */
  private inputRow(label: string, width: number, active: boolean, render: (width: number) => string): string {
    const prefix = `${focusLabel(label, active, this.theme)} `;
    return truncateToWidth(prefix + render(Math.max(1, width - visibleWidth(prefix))), width);
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
    // The new-output hint belongs to the Details heading; the status row keeps its width for page and selection.
    return statusRow(width, page, [...this.options.scope ? [this.options.scope] : [], ...statusLabels(controls), ...state.query ? [`/${state.query}`] : [], `${this.items.length}/${this.total}`],
      item && (selection?.(item) ?? { name: item.label }), this.theme);
  }
  private page(): string {
    return this.options.pages ? this.options.pages.items().find(page => page.value === this.options.pages!.selected())?.label ?? this.options.pages.selected()
      : this.options.page ?? this.options.title;
  }
  private empty(): string { return emptyRow(this.page(), this.options.controls ?? [], this.options.state.query, this.options.pages, this.theme); }
  private navigation(): string {
    const hint = (key: string, action: string) => keyHint(key, action, this.theme);
    if (this.focus === 'filter') return `Type to filter · ${hint('↑↓', 'select')} · ${hint('Enter', 'keep')} · ${hint('Esc', 'clear')}`;
    if (this.focus === 'details') return [...this.options.navigation ? [hint('←←', 'close')] : [],
      hint('Tab/Esc', 'list'), hint('↑↓ PgUp PgDn', 'scroll'), hint('/', 'search'), hint('n/N', 'next')].join(' · ');
    const { pages, controls = [] } = this.options;
    return [...this.options.navigation ? [hint('←←', 'close')] : [], hint('Esc', this.options.state.query ? 'clear filter' : this.options.navigation ? 'back' : 'close'),
      ...pages ? [hint(`1-${Math.min(9, pages.items().length)} / [ ]`, 'page')] : [],
      ...controls.map(control => hint(control.key, control.label.toLowerCase())), hint('/', 'filter'), hint('Tab', 'details')].join(' · ');
  }
  private help(): string {
    const confirmation = this.bar.hint(this.theme);
    if (confirmation) return confirmation;
    if (!this.items.length) return this.empty();
    // Reading and text modes do not own record shortcuts; advertise only keys they can execute.
    if (this.focus === 'filter') return [keyHint('Enter', 'keep filter', this.theme), keyHint('Esc', 'clear filter', this.theme)].join(' · ');
    return [keyHint('Enter', (this.options.open ?? 'open').toLowerCase(), this.theme),
      ...this.focus === 'list' ? [this.bar.render(this.theme)] : []].filter(Boolean).join(' · ');
  }
  render(width: number): string[] {
    this.update();
    this.composer.focused = this.focused;
    this.input.focused = this.active('filter');
    if (this.reader) this.reader.search.focused = this.focused && !this.composer.active && this.focus === 'details' && this.reader.searching;
    const header = [titleRow(this.options.title, this.options.pages, width, this.theme, this.options.page), ...controlRows(this.options.controls ?? [], width, this.theme)];
    this.filterTop = this.focus === 'filter' || this.options.state.query ? header.length : -1;
    if (this.filterTop >= 0) header.push(this.inputRow('Filter:', width, this.active('filter'), room => this.input.focused
      ? this.input.render(room)[0] ?? '' : truncateToWidth(this.options.state.query, room)));
    header.push(this.status(width), separator(width, this.theme));
    this.bodyTop = header.length;
    // Native multiline input replaces the usual two-row navigation/action footer.
    // Budget it before body layout, keeping its cursor and footer inside the frame.
    const composerRows = this.composer.active && this.composer.multiline
      ? this.composer.renderRows(width, Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - header.length - 5)) : [];
    const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8) - header.length - 5 - Math.max(0, composerRows.length - 1));
    const wide = this.wide = width >= 80;
    this.visibleRows = wide ? Math.max(1, height - 1) : this.focus === 'details' ? 1 : Math.max(1, Math.floor(height / 2) - 1);
    this.update();
    this.leftWidth = wide ? Math.min(52, Math.floor(width * 0.45)) : width;
    const listHeading = paneHeading('List', this.leftWidth, this.active('list'), this.theme);
    header[header.length - 1] = listHeading;
    const list = this.items.length ? this.list.render(this.leftWidth) : [truncateToWidth(this.empty(), this.leftWidth)];
    let body: string[];
    if (wide) {
      const right = this.reader?.viewport(Math.max(1, width - this.leftWidth - 3), height) ?? [];
      body = Array.from({ length: Math.max(list.length, right.length) }, (_, index) => {
        const left = truncateToWidth(list[index] ?? '', this.leftWidth);
        return `${left}${' '.repeat(Math.max(0, this.leftWidth - visibleWidth(left)))}${divider(' │ ', this.theme)}${right[index] ?? ''}`;
      });
    } else {
      const count = this.focus === 'details' ? 1 : Math.max(1, Math.floor(height / 2));
      this.detailsTop = this.bodyTop + Math.min(list.length, count) + 1;
      const details = this.reader?.viewport(width, Math.max(1, height - count - 1));
      body = [...list.slice(0, count), ...(this.reader ? [readerHeading('Details', this.reader.position, this.reader.hasNewOutput, width, this.theme, this.active('details')), ...details!] : [])];
    }
    this.options.state.focus = this.focus;
    const viewport = Array.from({ length: height }, (_, index) => body[index] ?? '');
    this.bodyBottom = this.bodyTop + height;
    header[header.length - 2] = this.status(width);
    // Refresh reader position/new-output after viewport layout, including the wide pane heading.
    if (wide) header[header.length - 1] = `${listHeading}${divider(' │ ', this.theme)}${this.reader
      ? readerHeading('Details', this.reader.position, this.reader.hasNewOutput, width - this.leftWidth - 3, this.theme, this.active('details'))
      : paneHeading('Details', width - this.leftWidth - 3, false, this.theme)}`;
    const navigation = this.composer.active ? this.inputRow('Input', width, this.focused, room => this.composer.render(room) ?? '')
      : this.reader?.searching && this.focus === 'details' ? this.inputRow('Search', width, this.reader.search.focused, room => this.reader!.search.render(room)[0] ?? '') : this.navigation();
    const inline = this.composer.active ? undefined : this.composer.render(width);
    const lines = commandFrame(width, [...header, ...viewport, separator(width, this.theme),
      ...composerRows.length ? composerRows : [truncateToWidth(navigation, width)], truncateToWidth(this.composer.active ? this.composer.help() : inline ?? this.help(), width)], this.theme);
    this.renderedRows = lines.length;
    return lines;
  }
  handleInput(data: string): void {
    if (this.composer.active || this.focus === 'filter' || this.reader?.searching) this.doubleLeft.reset();
    if (this.composer.handleInput(data)) { this.bar.disarm(); return; }
    if (this.focus !== 'filter' && !this.reader?.searching && this.options.navigation && this.doubleLeft.handle(data)) {
      this.options.navigation.close(); this.bar.disarm(); this.done(); return;
    }
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
    this.setFocus(this.focus);
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
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.doubleLeft.reset();
    if (this.composer.active) {
      if (event.y >= this.bodyBottom + 2) this.composer.handleMouse({...event, y: event.y - this.bodyBottom - 2,
        x: event.x - (this.composer.multiline ? 0 : visibleWidth(`${focusLabel('Input:', this.focused, this.theme)} `))});
      return {handled: true};
    }
    // Hover/release must not steal keyboard focus or cancel an armed action.
    if (event.type !== 'wheel' && !(event.button === 'left' && (event.type === 'press' || event.type === 'click'))) return;
    if (event.y <= 0 || event.y >= this.renderedRows - 1) return;
    event = { ...event, y: event.y - 1 };
    if (event.y === this.filterTop && event.type !== 'wheel') {
      this.setFocus('filter');
      // Input's native mouse positioning assumes a two-column prompt; ours is separate chrome.
      const prefixWidth = visibleWidth(`${focusLabel('Filter:', true, this.theme)} `);
      this.input.handleMouse({ ...event, x: event.x - prefixWidth + 2, y: 0 });
    } else if (event.y === this.bodyBottom + 1 && this.reader?.searching && this.focus === 'details' && event.type !== 'wheel') {
      const prefixWidth = visibleWidth(`${focusLabel('Search', true, this.theme)} `);
      this.reader.search.handleMouse({ ...event, x: event.x - prefixWidth, y: 0 });
    } else if (event.y >= this.bodyTop - 1 && event.y < this.bodyBottom) {
      const details = this.wide ? event.x >= this.leftWidth : event.y >= this.detailsTop - 1;
      if (details) {
        if (!this.reader) return;
        this.setFocus('details'); this.reader.handleMouse(event);
      } else {
        this.setFocus('list');
        if (event.y >= this.bodyTop) this.list.handleMouse({ ...event, y: event.y - this.bodyTop });
      }
    } else return;
    this.tui.requestRender();
    return {handled: true, focus: true, render: true};
  }
}

export async function browse(ctx: ExtensionContext, dock: Dock, options: BrowseOptions): Promise<string | undefined> {
  dock.setDetail(true);
  try { return await ctx.ui.custom<string | undefined>((tui, theme, keys, done) => new BrowserView(tui, options, done, theme, keys)); }
  finally { dock.setDetail(false); }
}
