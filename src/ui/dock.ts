import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface DockRow { id: string; text: string; priority: number }
export function heightBudget(rows: number, maxRows = 6, statusRow = false): number {
  // Reserve the native footer status line inside the suite's 20% allowance.
  const cap = rows < 28 ? 3 : Math.min(6, Math.floor(rows * 0.2));
  return Math.max(1, Math.min(maxRows, cap) - Number(statusRow));
}

export class Dock implements Component {
  private sources = new Map<string, () => DockRow[]>();
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

  register(id: string, rows: () => DockRow[]): void { this.sources.set(id, rows); this.invalidate(); }
  setStatusRow(value: boolean): void { this.statusRow = value; this.invalidate(); }
  setAsk(value: boolean): void { this.ask = value; this.invalidate(); }
  setDetail(value: boolean): void { this.detail = value; this.invalidate(); }
  budget(rows = this.tui?.terminal.rows ?? 24): number { return heightBudget(rows, this.maxRows, this.statusRow); }
  askBudget(rows: number): number { return this.budget(rows) - this.dockAllowance(rows); }

  private dockAllowance(rows: number): number {
    return this.ask ? Number(this.budget(rows) > 3 && [...this.sources.values()].some(source => source().length)) : this.budget(rows);
  }

  render(width: number): string[] {
    if (this.detail) return [];
    const limit = this.dockAllowance(this.tui?.terminal.rows ?? 24);
    const rows = [...this.sources.values()].flatMap(source => source()).sort((a, b) => b.priority - a.priority);
    const shown = rows.slice(0, limit);
    return shown.map((row, i) => truncateToWidth(
      row.text + (i === shown.length - 1 && rows.length > limit ? ` · +${rows.length - limit}` : ""), width));
  }

  invalidate(): void { this.tui?.requestRender(); }
}
