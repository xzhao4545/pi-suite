import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

export interface DockRow { id: string; text: string; priority: number; suffix?: string; parentId?: string }
export interface DockSource {
  title: string;
  rows: () => DockRow[];
  summary?: () => string;
  subtitle?: () => string;
  footer?: () => string;
  progress?: () => number;
}
export function heightBudget(rows: number, maxRows = 12, statusRow = false): number {
  // Native layout adds a blank widget row, a three-row editor and a 2–3 row footer.
  return Math.max(0, Math.min(maxRows, Math.floor(rows / 2) - 1 - 3 - 2 - Number(statusRow)));
}

export class Dock implements Component {
  private sources = new Map<string, DockSource>();
  private tui?: TUI;
  private theme?: Theme;
  private maxRows = 12;
  private statusRow = false;
  private ask = false;
  private detail = false;

  bind(ctx: ExtensionContext, maxRows: number): void {
    this.maxRows = maxRows;
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("pi-suite:dock", (tui, theme) => { this.tui = tui; this.theme = theme; return this; });
  }
  detach(ctx?: ExtensionContext): void { this.tui = undefined; ctx?.ui.setWidget("pi-suite:dock", undefined); }
  register(id: string, source: DockSource): void { this.sources.set(id, source); this.invalidate(); }
  setStatusRow(value: boolean): void { this.statusRow = value; this.invalidate(); }
  setAsk(value: boolean): void { this.ask = value; this.invalidate(); }
  setDetail(value: boolean): void { this.detail = value; this.invalidate(); }
  budget(rows = this.tui?.terminal.rows ?? 24): number { return heightBudget(rows, this.maxRows, this.statusRow); }
  askBudget(rows: number): number { return Math.max(1, Math.floor(rows * 0.7) - 1 - 2 - Number(this.statusRow)); }

  private color(kind: 'accent' | 'dim' | 'muted' | 'borderMuted', text: string): string { return this.theme?.fg(kind, text) ?? text; }
  private title(source: DockSource): string { return this.theme?.bold(this.color('accent', source.title)) ?? source.title; }
  private row(row: DockRow, width: number): string {
    const suffix = truncateToWidth(row.suffix ?? '', width);
    if (!suffix) return truncateToWidth(row.text, width);
    const titleWidth = Math.max(0, width - visibleWidth(suffix) - 1);
    const text = truncateToWidth(row.text, titleWidth, '…');
    return (titleWidth ? text + ' '.repeat(titleWidth - visibleWidth(text) + 1) : '') + suffix;
  }
  private summary(source: DockSource, rows: DockRow[], width: number): string {
    const first = [...rows].sort((a, b) => b.priority - a.priority)[0];
    const prefix = this.title(source) + ' · ';
    const space = Math.max(0, width - visibleWidth(prefix));
    return prefix + (source.summary ? truncateToWidth(source.summary(), space, '…') : this.row(first, space));
  }
  private section(source: DockSource, rows: DockRow[], limit: number, width: number): string[] {
    if (rows.length === 1 || limit <= 2) return [this.summary(source, rows, width)];
    const ids = new Set<string>(), byId = new Map(rows.map(row => [row.id, row]));
    const roots = rows.filter(row => !row.parentId), children = new Map<string, DockRow[]>();
    for (const row of rows) if (row.parentId) {
      const items = children.get(row.parentId) ?? []; items.push(row); children.set(row.parentId, items);
    }
    const selected = (): DockRow[] => {
      const result: DockRow[] = [];
      const append = (items: DockRow[], parentId?: string): void => {
        const hidden = items.filter(row => !ids.has(row.id));
        // An overflow row costs the same as one hidden item; show that item instead.
        const showLast = hidden.length === 1;
        for (const row of items) if (ids.has(row.id) || showLast) {
          result.push(row);
          if (!row.parentId) append(children.get(row.id) ?? [], row.id);
        }
        if (hidden.length > 1) result.push({ id: `overflow:${parentId ?? ''}`, parentId, priority: 0,
          text: this.color('muted', `… 还有 ${hidden.length} ${!parentId && source.title === 'Tasks' ? '组' : '项'}`) });
      };
      append(roots);
      return result;
    };
    // Priority chooses membership only; source order remains the reading order.
    for (const row of [...rows].sort((a, b) => b.priority - a.priority)) {
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      if (row.parentId && !parent) continue;
      const added = [parent, row].filter((item): item is DockRow => !!item && !ids.has(item.id));
      added.forEach(item => ids.add(item.id));
      const count = selected().length + 2;
      if (count > limit) added.forEach(item => ids.delete(item.id));
      else if (count === limit) break;
    }
    const shown = ids.size ? selected() : [{ id: 'summary', priority: 0,
      text: source.summary?.() ?? this.row([...rows].sort((a, b) => b.priority - a.priority)[0], width) }];
    const tree = width >= 40;
    const ratio = source.progress?.() ?? 0;
    const branch = (text: string, index: number): string => this.color(index < Math.round((shown.length + 1) * ratio) ? 'accent' : 'borderMuted', text);
    return [truncateToWidth(this.title(source) + (source.subtitle ? '  ' + this.color('dim', source.subtitle()) : ''), width),
      ...shown.map((row, index) => {
        const prefix = tree ? branch(row.parentId ? '│    ' : '├─ ', index) : '';
        return prefix + this.row(row, Math.max(0, width - visibleWidth(prefix)));
      }), truncateToWidth((tree ? branch('└─────', shown.length) : '') + (source.footer?.() ? ' ' + this.color('dim', source.footer!()) : ''), width)];
  }
  render(width: number): string[] {
    if (this.ask || this.detail) return [];
    const limit = this.budget();
    const sources = [...this.sources.values()].map(source => ({ source, rows: source.rows() }))
      .filter(item => item.rows.length).sort((a, b) => Math.max(...b.rows.map(row => row.priority)) - Math.max(...a.rows.map(row => row.priority)));
    const lines: string[] = [];
    for (const [index, {source, rows}] of sources.entries()) {
      const remaining = limit - lines.length;
      if (remaining <= 0) break;
      // Reserve one summary per lower-priority section while there is room.
      const allowance = Math.max(1, remaining - (sources.length - index - 1));
      lines.push(...this.section(source, rows, allowance, width));
    }
    return lines;
  }
  invalidate(): void { this.tui?.requestRender(); }
}
