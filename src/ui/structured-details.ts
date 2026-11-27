import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { detailPartText, type DetailPart } from './browser-chrome.ts';

export type DetailRow = string | readonly DetailPart[];
/** null marks a UI group break; undefined omits an optional row. */
export interface StructuredDetails { rows: readonly (DetailRow | null | undefined)[] }

export const part = (text: string | number | boolean, role?: DetailPart['role']): DetailPart => ({ text: String(text), role });
export const statePart = (text: string | boolean, state = String(text)): DetailPart => ({ text: String(text), state });
export const field = (label: string, value: DetailPart | string | number | boolean, ...suffix: DetailPart[]): DetailRow =>
  [part(`${label} `, 'label'), typeof value === 'object' ? value : part(value), ...suffix];

/** Tool receipts use the original, unsanitized text without UI-only spacing. */
export function plainDetailLines({ rows }: StructuredDetails): string[] {
  return rows.flatMap(row => row == null ? [] : [typeof row === 'string' ? row : row.map(({text}) => text).join('')]);
}

export function detailsText({ rows }: StructuredDetails, theme?: Theme): string {
  const lines: string[] = [];
  let gap = false;
  for (const row of rows) {
    if (row === undefined) continue;
    if (row === null) { gap = true; continue; }
    const line = (typeof row === 'string' ? [part(row)] : row).map(value => detailPartText(value, theme)).join('');
    if (gap && lines.length) lines.push('');
    lines.push(line);
    gap = false;
  }
  return lines.join('\n');
}

export const detailsContent = (details: StructuredDetails, theme?: Theme): Text => new Text(detailsText(details, theme), 0, 0);
