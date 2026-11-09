import type { Component, TUI } from "@earendil-works/pi-tui";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { dockWindow } from './dock/rows.ts';

const sourceOrder = ['goal', 'tasks', 'agents', 'jobs', 'workflows'];

export interface DockRow {
  id: string; text: string; priority: number; suffix?: string; parentId?: string; selectable?: boolean;
  /** Less detailed suffixes, in domain-defined omission order; never change the object's identity. */
  compactSuffixes?: string[];
}
export interface DockSource {
  title: string;
  rows: () => DockRow[];
  summary?: () => string;
  subtitle?: () => string;
  aside?: () => string;
  footer?: () => string;
  progress?: () => number;
  open?: (rowId: string, ctx: ExtensionContext) => void | Promise<void>;
  /** Read-only viewers participate in navigation without admitting mutation actions. */
  readOnly?: boolean;
}
type Section = { id: string; source: DockSource; rows: DockRow[] };
type Choice = { section: Section; row: DockRow };
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
  private context?: ExtensionContext;
  private unsubscribe?: () => void;
  private active = false;
  private selection?: { sourceId: string; rowId: string; index: number };

  bind(ctx: ExtensionContext, maxRows: number): void {
    this.detach();
    this.maxRows = maxRows;
    if (ctx.mode !== "tui") return;
    this.context = ctx;
    ctx.ui.setWidget("pi-suite:dock", (tui, theme) => { this.tui = tui; this.theme = theme; return this; });
    this.unsubscribe = ctx.ui.onTerminalInput(data => this.handleKey(data, ctx));
  }
  detach(ctx = this.context): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.context = undefined; this.tui = undefined; this.theme = undefined;
    this.active = false; this.selection = undefined;
    ctx?.ui.setWidget("pi-suite:dock", undefined);
  }
  register(id: string, source: DockSource): void { this.sources.set(id, source); this.invalidate(); }
  setOpen(id: string, open: NonNullable<DockSource['open']>): void { this.sources.get(id)!.open = open; this.invalidate(); }
  setStatusRow(value: boolean): void { this.statusRow = value; this.invalidate(); }
  setAsk(value: boolean): void { this.ask = value; if (value) this.active = false; this.invalidate(); }
  setDetail(value: boolean): void { this.detail = value; if (value) this.active = false; this.invalidate(); }
  budget(rows = this.tui?.terminal.rows ?? 24): number { return heightBudget(rows, this.maxRows, this.statusRow); }
  askBudget(rows: number): number { return Math.max(1, Math.floor(rows * 0.7) - 1 - 2 - Number(this.statusRow)); }

  private sections(): Section[] {
    return [...this.sources].map(([id, source]) => ({ id, source, rows: source.rows() })).filter(item => item.rows.length)
      .sort((a, b) => (sourceOrder.indexOf(a.id) < 0 ? sourceOrder.length : sourceOrder.indexOf(a.id))
        - (sourceOrder.indexOf(b.id) < 0 ? sourceOrder.length : sourceOrder.indexOf(b.id)));
  }
  private choices(sections: Section[]): Choice[] {
    return sections.flatMap(section => section.source.open ? section.rows.filter(row => row.selectable !== false)
      .map(row => ({ section, row })) : []);
  }
  private reconcile(choices: Choice[]): Choice | undefined {
    if (!choices.length) { this.active = false; return; }
    const found = choices.findIndex(item => item.section.id === this.selection?.sourceId && item.row.id === this.selection?.rowId);
    const index = found < 0 ? Math.min(this.selection?.index ?? 0, choices.length - 1) : found;
    const choice = choices[index];
    // Keep identity through reordering; if it disappears, its next neighbour takes the slot.
    this.selection = { sourceId: choice.section.id, rowId: choice.row.id, index };
    return choice;
  }
  private deactivate(): void { if (this.active) { this.active = false; this.invalidate(); } }
  private editorHasFocus(): boolean {
    // Pi's pluggable editor need not inherit Editor. focusedComponent has no public
    // accessor, so use the upstream structural contract rather than an instanceof check.
    const focused = (this.tui as unknown as { focusedComponent?: { getText?: unknown; setText?: unknown; capturesViewportInput?: boolean } })?.focusedComponent;
    // The native editor exposes this flag while autocomplete owns its navigation.
    return focused == null || typeof focused.getText === 'function' && typeof focused.setText === 'function' && !focused.capturesViewportInput;
  }
  private handleKey(data: string, ctx: ExtensionContext): { consume: true } | undefined {
    if (this.context !== ctx) return;
    if (this.ask || this.detail || !this.editorHasFocus() || ctx.ui.getEditorText() !== '' || this.budget() === 0) {
      this.deactivate(); return;
    }
    // Kitty releases also match matchesKey; held-key repeats remain useful navigation.
    if (isKeyRelease(data)) return;
    if (!this.active && !matchesKey(data, 'left')) return;
    const choices = this.choices(this.sections()), choice = this.reconcile(choices);
    if (!choice) return;
    if (!this.active) { this.active = true; this.invalidate(); return { consume: true }; }
    if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
      const index = Math.max(0, Math.min(choices.length - 1, this.selection!.index + (matchesKey(data, 'up') ? -1 : 1)));
      const next = choices[index]; this.selection = { sourceId: next.section.id, rowId: next.row.id, index };
      this.invalidate(); return { consume: true };
    }
    if (matchesKey(data, '[') || matchesKey(data, ']')) {
      const sections = [...new Set(choices.map(item => item.section.id))];
      const sectionId = sections[(sections.indexOf(choice.section.id) + (matchesKey(data, '[') ? -1 : 1) + sections.length) % sections.length];
      const index = choices.findIndex(item => item.section.id === sectionId), next = choices[index];
      this.selection = {sourceId: sectionId, rowId: next.row.id, index};
      this.invalidate(); return {consume: true};
    }
    if (matchesKey(data, 'enter')) {
      this.deactivate();
      // Input listeners cannot await a reader. Report failures at this user boundary,
      // and fence late imports/readers against a replaced SessionBinding context.
      void Promise.resolve().then(() => this.context === ctx ? choice.section.source.open!(choice.row.id, ctx) : undefined)
        .catch(error => { if (this.context === ctx) ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); });
      return { consume: true };
    }
    const back = matchesKey(data, 'escape') || matchesKey(data, 'right');
    this.deactivate();
    return back ? { consume: true } : undefined;
  }
  private highlight(text: string): string { return this.theme?.bold(this.color('accent', text)) ?? text; }
  private header(source: DockSource, width: number, selecting = false, compactHint = ''): string {
    const aside = [compactHint, source.aside?.()].filter(Boolean).join(' · '), space = Math.max(0, width - visibleWidth(aside) - Number(!!aside));
    const fullHint = `↑↓ select · [ ] section · Enter ${source.readOnly ? 'view' : 'open'} · Esc back`;
    const label = this.title(source) + (selecting && source.readOnly ? this.color('dim', ' · read only') : '');
    const hint = selecting ? (visibleWidth(label) + 2 + visibleWidth(fullHint) <= space ? fullHint : '[ ] Enter Esc') : '';
    const title = hint ? truncateToWidth(label, Math.max(0, space - visibleWidth(hint) - 2), '…') : label;
    return this.row({id: 'header', priority: 0, text: title + (hint ? '  ' + this.color('dim', hint)
      : source.subtitle ? '  ' + this.color('dim', source.subtitle()) : ''), suffix: aside ? this.color('dim', aside) : undefined}, width);
  }
  private color(kind: 'accent' | 'dim' | 'muted' | 'borderMuted', text: string): string { return this.theme?.fg(kind, text) ?? text; }
  private title(source: DockSource): string { return this.theme?.bold(this.color('accent', source.title)) ?? source.title; }
  private row(row: DockRow, width: number): string {
    const suffixes = [row.suffix ?? '', ...row.compactSuffixes ?? []];
    // Keep a recognizable name before dropping lower-value metrics. The domain
    // supplies the omission order, while Dock owns the terminal-width decision.
    const nameSpace = row.compactSuffixes ? Math.min(8, visibleWidth(row.text)) + 1 : 0;
    const suffix = truncateToWidth(suffixes.find(text => visibleWidth(text) <= width - nameSpace) ?? suffixes.at(-1)!, width);
    if (!suffix) return truncateToWidth(row.text, width);
    const titleWidth = Math.max(0, width - visibleWidth(suffix) - 1);
    const text = truncateToWidth(row.text, titleWidth, '…');
    return (titleWidth ? text + ' '.repeat(titleWidth - visibleWidth(text) + 1) : '') + suffix;
  }
  private summary(source: DockSource, rows: DockRow[], width: number): string {
    const first = [...rows].sort((a, b) => b.priority - a.priority)[0];
    const prefix = this.title(source) + ' · ';
    const aside = source.aside?.() ?? '';
    const space = Math.max(0, width - visibleWidth(prefix) - (aside ? visibleWidth(aside) + 1 : 0));
    const text = prefix + (source.summary ? truncateToWidth(source.summary(), space, '…') : this.row(first, space));
    return aside ? this.row({id: 'summary', text, priority: 0, suffix: this.color('dim', aside)}, width) : text;
  }
  private section(source: DockSource, rows: DockRow[], limit: number, width: number, selectedId?: string): string[] {
    const focus = rows.find(row => row.id === selectedId);
    if (focus && limit === 1) {
      const index = rows.indexOf(focus);
      const counts = [index ? `↑${index}` : '', rows.length - index - 1 ? `↓${rows.length - index - 1}` : ''].filter(Boolean).join(' ');
      const title = this.title(source);
      const full = title + ` [ ] Enter/Esc${counts ? ` ${counts}` : ''} · > `;
      const prefix = visibleWidth(full) <= width - Math.min(8, visibleWidth(focus.text)) ? full
        : truncateToWidth(title, Math.max(0, width - visibleWidth(` [ ] ${counts} > `) - 8)) + ` [ ] ${counts} > `;
      return [truncateToWidth(this.highlight(prefix + this.row(focus, Math.max(0, width - visibleWidth(prefix)))), width)];
    }
    if (!focus && rows.length === 1 && source.aside?.() && limit >= 2) return [this.header(source, width), this.row(rows[0], width)];
    if (!focus && (rows.length === 1 || limit <= 3)) return [this.summary(source, rows, width)];
    const tail = limit >= 4 ? 1 : 0;
    const window = dockWindow(rows, limit - 1 - tail, selectedId, source.title === 'Tasks' ? 'groups' : 'items');
    const shown = window.rows.length ? window.rows : [{id: 'summary', priority: 0, text: source.summary?.() ?? this.row(rows[0], width)}];
    const tree = width >= 40, ratio = source.progress?.() ?? 0;
    const branch = (text: string, index: number): string => this.color(index < Math.round((shown.length + 1) * ratio) ? 'accent' : 'borderMuted', text);
    return [this.header(source, width, !!focus, window.compactHint),
      ...shown.map((row, index) => {
        const selected = row.id === selectedId;
        const prefix = selected ? '> ' : tree ? branch(row.parentId ? '│    ' : '├─ ', index) : '';
        const text = row.id.startsWith('overflow:') ? this.color('muted', this.row(row, Math.max(0, width - visibleWidth(prefix))))
          : this.row(row, Math.max(0, width - visibleWidth(prefix)));
        return selected ? this.highlight(prefix + text) : prefix + text;
      }), ...tail ? [truncateToWidth((tree ? branch('└─────', shown.length) : '')
        + (source.footer?.() ? ' ' + this.color('dim', source.footer!()) : ''), width)] : []];
  }
  render(width: number): string[] {
    if (this.ask || this.detail) return [];
    const limit = this.budget();
    if (!limit) return [];
    const sources = this.sections();
    const choice = this.active ? this.reconcile(this.choices(sources)) : undefined;
    // Priority decides scarce membership and extra rows, never source position. Active
    // selection wins admission so Enter cannot open an object cropped out of the Dock.
    const ranked = [...sources].sort((a, b) => Number(b.id === choice?.section.id) - Number(a.id === choice?.section.id)
      || Math.max(...b.rows.map(row => row.priority)) - Math.max(...a.rows.map(row => row.priority)));
    const allowances = new Map(ranked.slice(0, limit).map(section => [section.id, 1]));
    const recipient = ranked[0]?.id;
    if (recipient) allowances.set(recipient, allowances.get(recipient)! + Math.max(0, limit - allowances.size));
    return sources.flatMap(({id, source, rows}) => allowances.has(id) ? this.section(source, rows, allowances.get(id)!, width,
      choice?.section.id === id ? choice.row.id : undefined) : []);
  }
  invalidate(): void { this.tui?.requestRender(); }
}
