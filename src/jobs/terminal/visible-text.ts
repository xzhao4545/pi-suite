// normalizeVisibleText is adapted from pi-interactive-shell 0.18.0 output-selection-runtime.ts
// normalizeSelectorVisibleText (MIT, third-party/licenses/pi-interactive-shell.txt).
import { stripVTControlCharacters } from 'node:util';
import { visibleWidth } from '@earendil-works/pi-tui';
import { READ_LIMITS } from '../../runtime/read.ts';

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

/** Terminal transport removed; CR overwrites cells on the current physical line like a terminal. */
export function normalizeVisibleText(raw: string): string {
  const output: string[] = [];
  let cells: string[] = [];
  let cursor = 0;
  const clearBoundary = (column: number) => {
    if (cells[column] === '' && column) { cells[column - 1] = ' '; cells[column] = ' '; }
  };
  // Interpret horizontal redraws before stripping ANSI: deleting CSI first loses
  // the cursor/erase semantics that make progress output readable.
  for (const token of raw.split(/(\x1b\[[0-?]*[ -/]*[@-~]|[\r\n\b])/)) {
    if (token === '\n') { output.push(cells.join(''), '\n'); cells = []; cursor = 0; continue; }
    if (token === '\r') { cursor = 0; continue; }
    if (token === '\b') { cursor = Math.max(0, cursor - 1); continue; }
    if (token.startsWith('\x1b[')) {
      // Transport cursor counts cannot allocate more padding than a log read can expose.
      const count = Math.min(READ_LIMITS.maxBytes, Number(token.slice(2, -1)) || 1), command = token.at(-1);
      if (command === 'G') cursor = count - 1;
      else if (command === 'C') cursor = Math.min(READ_LIMITS.maxBytes - 1, cursor + count);
      else if (command === 'D') cursor = Math.max(0, cursor - count);
      else if (command === 'K') {
        const mode = Number(token.slice(2, -1));
        if (mode === 0 || mode === 1) clearBoundary(mode === 0 ? cursor : cursor + 1);
        if (mode === 0) cells.length = Math.min(cells.length, cursor);
        else if (mode === 1) cells.fill(' ', 0, Math.min(cells.length, cursor + 1));
        else if (mode === 2) cells = [];
      }
      continue;
    }
    for (const {segment} of segmenter.segment(stripVTControlCharacters(token).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''))) {
      if (segment === '\t') { const next = cursor + 8 - cursor % 8; while (cursor < next) cells[cursor++] = ' '; continue; }
      const width = visibleWidth(segment);
      if (!width) { if (cursor) cells[cursor - 1] = (cells[cursor - 1] ?? '') + segment; continue; }
      // A wide glyph owns all its terminal cells; overwriting either half clears it.
      clearBoundary(cursor); clearBoundary(cursor + width);
      while (cells.length < cursor) cells.push(' ');
      cells[cursor] = segment;
      for (let cell = 1; cell < width; cell++) cells[cursor + cell] = '';
      cursor += width;
    }
  }
  output.push(cells.join(''));
  // Progress redraws often emit the same final line many times; keep one with a count.
  return output.join('').replace(/^(.*)(?:\n\1$)+/gm, (block, line: string) => `${line}  [×${block.split('\n').length}]`);
}
