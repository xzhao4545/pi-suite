import { getSelectListTheme, type ExtensionContext, type KeybindingsManager, type Theme } from '@earendil-works/pi-coding-agent';
import { Input, Key, SelectList, Text, VStack, HStack, renderLayout, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth,
  type SelectItem, type KeyId, type SelectListLayoutOptions, type TUI, type Component, type TuiMouseEvent, type TuiMouseEventResult } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { ScrollView } from './scroll.ts';
import type { Dock } from './dock.ts';
import { InlineInput } from './inline-input.ts';
import { ActionBar, type DetailAction } from './actions.ts';
import { commandFrame } from './frame.ts';
import { openReading, readingRows, readingText } from './reading.ts';
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
export class BrowserView extends VStack {
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
  private footerTop = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(private tui: TUI, private options: BrowseOptions, private done: (value?: string) => void, private theme?: Theme, keys?: KeybindingsManager) {
    super();
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
  dispose(): void {
    this.doubleLeft.reset(); this.composer.dispose(); this.unsubscribe?.(); clearTimeout(this.refreshTimer); clearInterval(this.clock);
    for (const reader of this.options.state.readers.values()) reader.dispose();
  }
  override invalidate(): void { this.list.invalidate(); this.reader?.invalidate(); }
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
  override render(width: number): string[] { return renderLayout(this, width, readingRows(this.tui), () => this.tui.requestRender()).lines; }
  prepareLayout(width: number, total: number): void {
    this.clear();
    this.update();
    this.composer.focused = this.focused;
    this.input.focused = this.active('filter');
    if (this.reader) this.reader.search.focused = this.focused && !this.composer.active && this.focus === 'details' && this.reader.searching;
    const fixed = (component: Component, rows: number) => this.addChild(component, {basis: rows, shrink: 0});
    const border = () => commandFrame(width, [], this.theme)[0];
    fixed(readingText(() => [border()]), 1);
    const header = [titleRow(this.options.title, this.options.pages, width, this.theme, this.options.page), ...controlRows(this.options.controls ?? [], width, this.theme)];
    fixed(readingText(() => header), header.length);
    const filter = this.focus === 'filter' || this.options.state.query;
    if (filter) fixed(this.textInput('Filter:', this.input, 'filter'), 1);
    fixed(readingText(room => [this.status(room)], true), 1);
    const headerRows = 2 + header.length + Number(Boolean(filter));
    const composerRows = this.composer.active && this.composer.multiline
      ? this.composer.renderRows(width, Math.max(1, total - headerRows - 5)) : [];
    const footerRows = composerRows.length || 1;
    const height = Math.max(1, total - headerRows - footerRows - 3);
    const wide = width >= 80;
    this.leftWidth = wide ? Math.min(52, Math.floor(width * 0.45)) : width;
    const listHeight = wide ? height : this.reader ? (this.focus === 'details' ? 2 : Math.max(2, Math.floor(height / 2))) : height;
    this.visibleRows = Math.max(1, listHeight - 1);
    this.update();
    const pane = (focus: 'list' | 'details', children: ConstructorParameters<typeof VStack>[0]) => Object.assign(new VStack(children), {
      handleMouseCapture: (event: TuiMouseEvent): TuiMouseEventResult | undefined => {
        if (event.type === 'wheel' || event.button === 'left' && (event.type === 'press' || event.type === 'click')) {
          this.setFocus(focus); this.tui.requestRender();
          if (event.y === 0 && event.type !== 'wheel') return {handled: true, focus: true};
        }
        return undefined;
      },
    });
    const list = pane('list', [
      {component: readingText(room => [paneHeading('List', room, this.active('list'), this.theme)], true), basis: 1, shrink: 0},
      {component: this.items.length ? this.list : readingText(room => [truncateToWidth(this.empty(), room)]), basis: 0, grow: 1},
    ]);
    const details = pane('details', [
      {component: readingText(room => [this.reader ? readerHeading('Details', this.reader.position, this.reader.hasNewOutput, room, this.theme, this.active('details'))
        : paneHeading('Details', room, false, this.theme)], true), basis: 1, shrink: 0},
      ...this.reader ? [{component: this.reader, basis: 0, grow: 1}] : [],
    ]);
    const body = wide ? new HStack([
      {component: list, basis: this.leftWidth, shrink: 0},
      {component: readingText(() => Array.from({length: height}, () => divider(' │ ', this.theme))), basis: 3, shrink: 0},
      {component: details, basis: 0, grow: 1},
    ]) : new VStack([
      {component: list, basis: listHeight, shrink: 0},
      ...this.reader ? [{component: details, basis: 0, grow: 1}] : [],
    ]);
    this.addChild(body, {basis: 0, grow: 1, minSize: 1});
    fixed(readingText(room => [separator(room, this.theme)]), 1);
    this.footerTop = total - footerRows - 2;
    const navigation = this.composer.active ? readingText(room => composerRows.length ? composerRows : [this.inputRow('Input', room, this.focused, space => this.composer.render(space) ?? '')])
      : this.reader?.searching && this.focus === 'details' ? this.textInput('Search', this.reader.search, 'details') : readingText(() => [this.navigation()]);
    fixed(navigation, footerRows);
    fixed(readingText(room => [this.composer.active ? this.composer.help() : this.composer.render(room) ?? this.help()]), 1);
    fixed(readingText(() => [border()]), 1);
    this.options.state.focus = this.focus;
  }
  /** Native layout supplies row coordinates; only the textual prefix needs a column transform. */
  private textInput(label: string, input: Input, focus: BrowseFocus): Component {
    return {...readingText(room => [this.inputRow(label, room, Boolean(input.focused), width => input.focused ? input.render(width)[0] ?? '' : truncateToWidth(input.getValue(), width))]),
      handleMouse: event => {
        if (event.type !== 'press' && event.type !== 'click' || event.button !== 'left') return undefined;
        this.setFocus(focus);
        const prefix = visibleWidth(`${focusLabel(label, true, this.theme)} `);
        const result = input.handleMouse({...event, x: event.x - prefix + (label === 'Filter:' ? 2 : 0)});
        this.tui.requestRender(); return result;
      }};
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
  handleMouseCapture(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.doubleLeft.reset();
    if (!this.composer.active) return undefined;
    if (event.y >= this.footerTop) this.composer.handleMouse({...event, y: event.y - this.footerTop,
      x: event.x - (this.composer.multiline ? 0 : visibleWidth(`${focusLabel('Input', this.focused, this.theme)} `))});
    return {handled: true};
  }
}

export async function browse(ctx: ExtensionContext, dock: Dock, options: BrowseOptions): Promise<string | undefined> {
  dock.setDetail(true);
  try { return await openReading<string | undefined>(ctx, (tui, theme, keys, done) => new BrowserView(tui, options, done, theme, keys)); }
  finally { dock.setDetail(false); }
}
