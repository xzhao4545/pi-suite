// normalizeVisibleText is adapted from pi-interactive-shell 0.18.0 output-selection-runtime.ts
// normalizeSelectorVisibleText (MIT, third-party/licenses/pi-interactive-shell.txt).
import { stripVTControlCharacters } from 'node:util';

/** Terminal transport removed; CR overwrites cells on the current physical line like a terminal. */
export function normalizeVisibleText(raw: string): string {
  const output: string[] = [];
  let cells: string[] = [];
  let cursor = 0;
  for (const character of stripVTControlCharacters(raw)) {
    if (character === '\n') { output.push(cells.join(''), '\n'); cells = []; cursor = 0; continue; }
    if (character === '\r') { cursor = 0; continue; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(character)) continue;
    if (cursor < cells.length) cells[cursor] = character;
    else cells.push(character);
    cursor += 1;
  }
  output.push(cells.join(''));
  // Progress redraws often emit the same final line many times; keep one with a count.
  return output.join('').replace(/^(.*)(?:\n\1$){2,}/gm, (block, line: string) => `${line}  [×${block.split('\n').length}]`);
}

/** Pipe output: drop terminal control sequences but keep text layout characters. */
export function sanitizeText(raw: string): string {
  return stripVTControlCharacters(raw).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
