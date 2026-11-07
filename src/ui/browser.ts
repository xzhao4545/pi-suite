import { getSelectListTheme, type ExtensionContext, type Theme } from '@earendil-works/pi-coding-agent';
import { Input, Key, SelectList, Text, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth,
  type SelectItem, type SelectListLayoutOptions, type TUI, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { ScrollView } from './scroll.ts';
import type { Dock } from './dock.ts';
import { ActionBar, type DetailAction } from './actions.ts';
import { commandFrame } from './frame.ts';

export interface BrowseItem extends SelectItem { search?: string; details?: () => string | Component; pinned?: boolean }
type BrowseFocus = 'filter' | 'list' | 'details' | 'actions' | `control:${number}`;
export interface BrowseState { query: string; selected?: string; readers: Map<string, ScrollView>; focus?: BrowseFocus; action?: string }
export const browseState = (): BrowseState => ({ query: '', readers: new Map() });
export interface BrowseControl {
  label: string; items: () => SelectItem[]; selected: () => string;
  select: (value: string, done: (value?: string) => void) => void;
}
export interface BrowsePage { state: BrowseState; navigation: BrowseControl }
export interface BrowseOptions {
  title: string | (() => string); items: () => BrowseItem[]; state: BrowseState;
  subscribe?: (refresh: () => void) => () => void;
  ticking?: () => boolean;
  controls?: BrowseControl[];
  actions?: (item: BrowseItem, done: (value?: string) => void) => DetailAction[];
  layout?: SelectListLayoutOptions;
}

/** A shared native list owns selection identities; details never become another data source. */
export class BrowserView implements Component {
  focused = true;
  private input = new Input({ prompt: 'Filter: ' });
  private list!: SelectList;
  private items: BrowseItem[] = [];
  private fingerprint = '';
  private visibleRows = 8;
  private focus: BrowseFocus;
  private controlValues = new Map<number, string>();
  private bar: ActionBar;
  private actionOwner?: string;
  private reader?: ScrollView;
  private leftWidth = 0;
  private wide = false;
  private detailsTop = 0;
  private matches = 0;
  private bodyTop = 2;
  private renderedRows = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(private tui: TUI, private options: BrowseOptions, private done: (value?: string) => void, private theme?: Theme) {
    this.focus = options.state.focus ?? 'filter';
    this.bar = new ActionBar(() => this.actions(), options.state.action);
    this.input.setValue(options.state.query);
    this.input.onSubmit = () => this.select();
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
  private actions(): DetailAction[] {
    const item = this.items.find(item => item.value === this.list?.getSelectedItem()?.value);
    return item ? this.options.actions?.(item, this.done) ?? [] : [];
  }
  private update(reset = false): void {
    const oldIndex = this.items.findIndex(item => item.value === this.list?.getSelectedItem()?.value);
    const all = this.options.items().map(item => ({ ...item, label: sanitizeText(item.label).replace(/[\r\n\t]/g, ' '),
      description: item.description === undefined ? undefined : sanitizeText(item.description).replace(/[\r\n\t]/g, ' ') }));
    const filtered = fuzzyFilter(all.filter(item => !item.pinned), this.options.state.query,
      item => item.search ?? `${item.label} ${item.description ?? ''}`);
    this.matches = filtered.length;
    this.items = [...filtered, ...all.filter(item => item.pinned)];
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
    if (this.focus === 'details' && !this.reader || this.focus === 'actions' && !this.bar.available().length) this.focus = 'filter';
  }
  private changed(): void {
    const value = this.list.getSelectedItem()?.value;
    this.options.state.selected = value;
    // A confirmation belongs to one record. Moving selection cannot stop the next one.
    if (value !== this.actionOwner) { this.bar.reset(this.options.state.action); this.actionOwner = value; }
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
  private controlIndex(): number { return Number(this.focus.slice('control:'.length)); }
  private controlRow(index: number, width: number): string {
    const control = this.options.controls![index], items = control.items();
    const current = control.selected();
    const cursor = this.controlValues.get(index) ?? current;
    const selected = items.findIndex(item => item.value === cursor);
    const label = `${this.focus === `control:${index}` ? '› ' : ''}${control.label ? `${control.label}: ` : ''}`;
    const cells = items.map(item => item.value === current ? `[${item.label}]` : item.label);
    const line = label + cells.map((cell, i) => this.focus === `control:${index}` && i === selected ? `>${cell}<` : cell).join(' · ');
    if (visibleWidth(line) <= width) return line;
    // Narrow terminals keep the selected chip and expose its adjacent choices with arrows.
    const item = items[Math.max(0, selected)];
    return truncateToWidth(`${label}‹ ${item?.label ?? ''} ›${cursor === current ? ' ✓' : ' · Enter'}`, width);
  }
  render(width: number): string[] {
    this.update();
    this.input.focused = this.focus === 'filter';
    const title = typeof this.options.title === 'function' ? this.options.title() : this.options.title;
    const header = [truncateToWidth(title, width), ...this.options.controls?.map((_control, i) => this.controlRow(i, width)) ?? [], ...this.input.render(width),
      ...!this.matches && this.items.length ? [truncateToWidth('No matching records', width)] : []];
    this.bodyTop = header.length;
    const actions = this.bar.available(), hint = this.bar.hint;
    const height = Math.max(2, Math.floor(this.tui.terminal.rows * 0.8) - header.length - 3 - (actions.length ? 1 : 0) - (hint ? 1 : 0));
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
      body = [...list.slice(0, count), ...(this.reader ? [truncateToWidth(`Details · ${this.reader.position}`, width),
        ...this.reader.viewport(width, Math.max(1, height - count - 1))] : [])];
    }
    this.options.state.action = this.bar.selected;
    this.options.state.focus = this.focus;
    const control = this.focus.startsWith('control:');
    const focusName = control ? this.options.controls![this.controlIndex()].label || 'Pages' : `${this.focus[0].toUpperCase()}${this.focus.slice(1)}`;
    const lines = commandFrame(width, [...header, ...body.slice(0, height), ...(this.reader?.searching ? this.reader.search.render(width)
      : [...hint ? [truncateToWidth(hint, width)] : [], ...actions.length ? [this.bar.render(width)] : [],
        truncateToWidth(`${focusName} · Tab focus · ${control || this.focus === 'actions' ? '←→ Enter' : this.focus === 'details' ? '↑↓ / search' : '↑↓ Enter'} · Esc`, width)])], this.theme);
    this.renderedRows = lines.length;
    return lines;
  }
  handleInput(data: string): void {
    this.update();
    if (this.reader?.searching && this.focus === 'details') this.reader.handleInput(data);
    else if (matchesKey(data, Key.escape)) {
      this.bar.disarm();
      if (this.focus === 'details') this.focus = 'filter';
      else if (this.options.state.query) { this.input.setValue(''); this.options.state.query = ''; this.update(); }
      else this.done();
    } else if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift('tab'))) {
      this.bar.disarm();
      const focuses: BrowseFocus[] = [...this.options.controls?.map((_control, i) => `control:${i}` as const) ?? [], 'filter', 'list', ...this.reader ? ['details' as const] : [], ...this.bar.available().length ? ['actions' as const] : []];
      const direction = matchesKey(data, Key.tab) ? 1 : -1;
      this.focus = focuses[(focuses.indexOf(this.focus) + direction + focuses.length) % focuses.length];
    } else if (this.focus.startsWith('control:')) {
      const index = this.controlIndex(), control = this.options.controls![index], items = control.items();
      const cursor = this.controlValues.get(index) ?? control.selected();
      const position = Math.max(0, items.findIndex(item => item.value === cursor));
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        const step = matchesKey(data, Key.left) ? -1 : 1;
        this.controlValues.set(index, items[(position + step + items.length) % items.length].value);
      } else if (matchesKey(data, Key.enter)) control.select(cursor, this.done);
    } else if (this.focus === 'actions') this.bar.handleInput(data);
    else if (matchesKey(data, Key.enter)) this.select();
    else if (this.focus === 'details') this.reader?.handleInput(data);
    else if ([Key.up, Key.down, Key.pageUp, Key.pageDown].some(key => matchesKey(data, key))) this.list.handleInput(data);
    else {
      this.focus = 'filter'; this.input.handleInput(data);
      this.options.state.query = this.input.getValue(); this.update(true);
    }
    this.options.state.focus = this.focus;
    this.tui.requestRender();
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
