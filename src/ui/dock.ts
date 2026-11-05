import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface DockRow { id: string; text: string; priority: number; suffix?: string; parentId?: string }
export function heightBudget(rows: number, maxRows = 6, statusRow = false): number {
  // Reserve the native footer status line inside the suite's 20% allowance.
  const cap = rows < 28 ? 3 : Math.min(6, Math.floor(rows * 0.2));
  return Math.max(0, Math.min(maxRows, cap) - Number(statusRow));
}

export class Dock implements Component {
  private sources = new Map<string, (compact: boolean) => DockRow[]>();
  private tui?: TUI;
  private maxRows = 6;
  private statusRow = false;
  private ask = false;
  private detail = false;

  bind(ctx: ExtensionContext, maxRows: number): void {
    this.maxRows = maxRows;
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("pi-suite:dock", tui => { this.tui = tui; return this; });
  }

  detach(ctx?: ExtensionContext): void {
    this.tui = undefined;
    ctx?.ui.setWidget("pi-suite:dock", undefined);
  }

  register(id: string, rows: (compact: boolean) => DockRow[]): void { this.sources.set(id, rows); this.invalidate(); }
  setStatusRow(value: boolean): void { this.statusRow = value; this.invalidate(); }
  setAsk(value: boolean): void { this.ask = value; this.invalidate(); }
  setDetail(value: boolean): void { this.detail = value; this.invalidate(); }
  budget(rows = this.tui?.terminal.rows ?? 24): number { return heightBudget(rows, this.maxRows, this.statusRow); }
  // An open form needs one usable answer line even if maxRows is consumed by the footer.
  askBudget(rows: number): number { return Math.max(1, this.budget(rows) - this.dockAllowance(rows)); }

  private dockAllowance(rows: number): number {
    return this.ask ? Number(this.budget(rows) > 1 && [...this.sources.values()].some(source => source(true).length)) : this.budget(rows);
  }

  render(width: number): string[] {
    if (this.detail) return [];
    const limit = this.dockAllowance(this.tui?.terminal.rows ?? 24);
    const rows = [...this.sources.values()].flatMap(source => source(this.ask)).sort((a, b) => b.priority - a.priority);
    // Reserve space for group summaries before expanding children; an orphan child
    // or a large active group must not consume another group's only progress line.
    const roots = rows.filter(row => !row.parentId).slice(0, limit), ids = new Set(roots.map(row => row.id));
    const children = rows.filter(row => row.parentId && ids.has(row.parentId)).slice(0, limit - roots.length);
    const shown = roots.flatMap(row => [row, ...children.filter(child => child.parentId === row.id)]);
    return shown.map((row, i) => {
      const hidden = i === shown.length - 1 && rows.length > limit ? ` · +${rows.length - limit}` : "";
      // Overflow counts and progress belong to the row contract, so long titles
      // cannot push either off a phone, including rows with no domain suffix.
      const suffix = truncateToWidth((row.suffix ?? '') + hidden, width);
      if (!suffix) return truncateToWidth(row.text, width);
      const titleWidth = Math.max(0, width - visibleWidth(suffix) - 1);
      return (titleWidth ? truncateToWidth(row.text, titleWidth, '') + ' ' : '') + suffix;
    });
  }

  invalidate(): void { this.tui?.requestRender(); }
}
