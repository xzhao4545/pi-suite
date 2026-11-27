import type { DockRow } from '../dock.ts';

/** Gaps stay at their actual sibling positions, including gaps before a selected tail. */
function withGaps(rows: DockRow[], ids: Set<string>, rootUnit: string): DockRow[] {
  const children = new Map<string, DockRow[]>();
  for (const row of rows) if (row.parentId) {
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row); children.set(row.parentId, siblings);
  }
  const result: DockRow[] = [];
  const append = (siblings: DockRow[], parentId?: string): void => {
    if (!siblings.some(row => ids.has(row.id))) return;
    let gap: DockRow[] = [], start = 0;
    const flush = (end: number): void => {
      if (gap.length === 1) result.push(gap[0]); // Showing one object costs the same row as an overflow hint.
      else if (gap.length) result.push({id: `overflow:${parentId ?? ''}:${start}`, parentId, priority: 0, selectable: false,
        text: `${start === 0 ? '↑' : end === siblings.length ? '↓' : '↕'} … ${gap.length} more ${parentId ? 'items' : rootUnit}`});
      gap = [];
    };
    siblings.forEach((row, index) => {
      if (!ids.has(row.id)) { if (!gap.length) start = index; gap.push(row); return; }
      flush(index); result.push(row);
      append(children.get(row.id) ?? [], row.id);
    });
    flush(siblings.length);
  };
  append(rows.filter(row => !row.parentId));
  return result;
}

export interface DockWindow { rows: DockRow[]; compactHint?: string }
/** Priority selects idle membership; active navigation retains neighbours around the stable selected ID. */
export function dockWindow(rows: DockRow[], capacity: number, selectedId?: string, rootUnit = 'items', gapHints = true): DockWindow {
  const byId = new Map(rows.map(row => [row.id, row]));
  const focusIndex = rows.findIndex(row => row.id === selectedId), focus = rows[focusIndex];
  const ids = new Set<string>();
  const visible = () => gapHints ? withGaps(rows, ids, rootUnit) : rows.filter(row => ids.has(row.id));
  const add = (row: DockRow): string[] => {
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (row.parentId && !parent) return [];
    const added = [parent, row].filter((item): item is DockRow => !!item && !ids.has(item.id)).map(item => item.id);
    added.forEach(id => ids.add(id)); return added;
  };
  if (focus) {
    add(focus);
    if (visible().length > capacity) {
      // Tiny viewports cannot fit ancestry plus both gaps. Keep the real selected object,
      // and put exact omitted-row counts in the header rather than hiding it or lying about direction.
      const hint = [focusIndex ? `↑${focusIndex}` : '', rows.length - focusIndex - 1 ? `↓${rows.length - focusIndex - 1}` : ''].filter(Boolean).join(' ');
      return {rows: [focus], compactHint: hint};
    }
  }
  const ranked = rows.map((row, index) => ({row, index})).sort((a, b) => focus
    ? Math.abs(a.index - focusIndex) - Math.abs(b.index - focusIndex) || a.index - b.index
    : b.row.priority - a.row.priority);
  for (const {row} of ranked) {
    const added = add(row);
    const count = visible().length;
    if (count > capacity) added.forEach(id => ids.delete(id));
    else if (count === capacity) break;
  }
  return {rows: visible()};
}
