import { getSelectListTheme, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Input, Key, SelectList, Text, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth,
  type SelectItem, type TUI, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { ScrollView } from './scroll.ts';
import type { Dock } from './dock.ts';

export interface BrowseItem extends SelectItem { search?: string; details?: () => string; pinned?: boolean }
export interface BrowseState { query: string; selected?: string; readers: Map<string, ScrollView> }
export const browseState = (): BrowseState => ({ query: '', readers: new Map() });
export interface BrowseOptions {
  title: string | (() => string); items: () => BrowseItem[]; state: BrowseState;
  subscribe?: (refresh: () => void) => () => void;
  ticking?: () => boolean;
}

/** A shared native list owns selection identities; details never become another data source. */
export class BrowserView implements Component {
  focused = true;
  private input = new Input({ prompt: 'Filter: ' });
  private list!: SelectList;
  private items: BrowseItem[] = [];
  private fingerprint = '';
  private visibleRows = 8;
  private focus: 'filter' | 'list' | 'details' = 'filter';
  private reader?: ScrollView;
  private leftWidth = 0;
  private wide = false;
  private detailsTop = 0;
  private matches = 0;
  private bodyTop = 2;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;

  constructor(private tui: TUI, private options: BrowseOptions, private done: (value?: string) => void) {
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
  private update(reset = false): void {
    const oldIndex = this.items.findIndex(item => item.value === this.list?.getSelectedItem()?.value);
    const all = this.options.items();
    const filtered = fuzzyFilter(all.filter(item => !item.pinned), this.options.state.query,
      item => item.search ?? `${item.label} ${item.description ?? ''}`);
    this.matches = filtered.length;
    this.items = [...filtered, ...all.filter(item => item.pinned)];
    const fingerprint = JSON.stringify([this.visibleRows, this.items.map(item => [item.value, item.label, item.description])]);
    if (reset || fingerprint !== this.fingerprint || !this.list) {
      const previous = reset ? undefined : this.list?.getSelectedItem()?.value ?? this.options.state.selected;
      const index = this.items.findIndex(item => item.value === previous);
      this.list = new SelectList(this.items, this.visibleRows, getSelectListTheme());
      this.list.setSelectedIndex(index >= 0 ? index : reset ? 0 : Math.max(0, Math.min(oldIndex, this.items.length - 1)));
      this.list.onSelectionChange = () => this.changed();
      this.list.onSelect = () => this.select();
      this.list.onCancel = () => this.done();
      this.fingerprint = fingerprint;
    }
    this.changed();
  }
  private changed(): void {
    const value = this.list.getSelectedItem()?.value;
    this.options.state.selected = value;
    const item = this.items.find(item => item.value === value);
    if (!item?.details) { this.reader = undefined; return; }
    // Each identity retains its own search and scroll when another row or action is opened.
    const content = new Text(sanitizeText(item.details()), 0, 0);
    this.reader = this.options.state.readers.get(item.value);
    if (this.reader) this.reader.setContent(content);
    else { this.reader = new ScrollView(content); this.options.state.readers.set(item.value, this.reader); }
  }
  private select(): void { const value = this.list.getSelectedItem()?.value; if (value !== undefined) this.done(value); }
  render(width: number): string[] {
    this.input.focused = this.focus === 'filter';
    const title = typeof this.options.title === 'function' ? this.options.title() : this.options.title;
    const header = [truncateToWidth(title, width), ...this.input.render(width)];
    this.bodyTop = header.length;
    const height = Math.max(2, Math.floor(this.tui.terminal.rows * 0.8) - header.length - 1);
    const wide = this.wide = width >= 80;
    this.visibleRows = wide ? Math.max(1, height - 1) : this.focus === 'details' ? 1 : Math.max(1, Math.floor(height / 2) - 1);
    this.update();
    this.leftWidth = wide ? Math.min(52, Math.floor(width * 0.45)) : width;
    const list = this.list.render(this.leftWidth);
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
    return [...header, ...body.slice(0, height), ...(this.reader?.searching ? this.reader.search.render(width)
      : [truncateToWidth(`${this.matches ? this.focus : 'No matching records'} · ↑↓ / PgUp PgDn · Tab focus · Enter open · Esc back`, width)])];
  }
  handleInput(data: string): void {
    if (this.reader?.searching && this.focus === 'details') this.reader.handleInput(data);
    else if (matchesKey(data, Key.escape)) {
      if (this.focus === 'details') this.focus = 'filter';
      else if (this.options.state.query) { this.input.setValue(''); this.options.state.query = ''; this.update(); }
      else this.done();
    } else if (matchesKey(data, Key.tab)) this.focus = this.focus === 'filter' ? 'list' : this.focus === 'list' && this.reader ? 'details' : 'filter';
    else if (matchesKey(data, Key.enter)) this.select();
    else if (this.focus === 'details') this.reader?.handleInput(data);
    else if ([Key.up, Key.down, Key.pageUp, Key.pageDown].some(key => matchesKey(data, key))) this.list.handleInput(data);
    else {
      this.focus = 'filter'; this.input.handleInput(data);
      this.options.state.query = this.input.getValue(); this.update(true);
    }
    this.tui.requestRender();
  }
  handleMouse(event: TuiMouseEvent) {
    if (event.y < this.bodyTop) return;
    if (this.wide ? event.x > this.leftWidth : event.y >= this.detailsTop) {
      this.focus = 'details'; return this.reader?.handleMouse(event);
    }
    this.focus = 'list'; return this.list.handleMouse({ ...event, y: event.y - this.bodyTop });
  }
}

export async function browse(ctx: ExtensionContext, dock: Dock, options: BrowseOptions): Promise<string | undefined> {
  dock.setDetail(true);
  try { return await ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => new BrowserView(tui, options, done)); }
  finally { dock.setDetail(false); }
}
