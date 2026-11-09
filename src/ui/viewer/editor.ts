import { CURSOR_MARKER, Editor } from '@earendil-works/pi-tui';

/** Pi Editor has a terminal-wide line ceiling, not a per-view ceiling. Keep its editing
 * state and borders, while a small reading overlay shows a cursor-centred native-row viewport. */
export class ViewerEditor extends Editor {
  private rowStart = 0;
  renderWithin(width: number, rows: number): string[] {
    const lines = super.render(width);
    this.rowStart = 0;
    if (lines.length <= rows) return lines;
    const cursor = Math.max(1, lines.findIndex(line => line.includes(CURSOR_MARKER)));
    if (rows < 3) { this.rowStart = cursor; return lines.slice(cursor, cursor + 1); }
    const body = lines.slice(1, -1), height = rows - 2;
    this.rowStart = Math.min(Math.max(0, cursor - height), Math.max(0, body.length - height));
    return [lines[0], ...body.slice(this.rowStart, this.rowStart + height), lines.at(-1)!];
  }
  get viewportStart(): number { return this.rowStart; }
}
