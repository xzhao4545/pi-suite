import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { detailPartText, divider, heading, type DetailPart } from './browser-chrome.ts';
import { sanitizeText } from '../runtime/text.ts';

/** A section names the block below it (metadata, input, output) so long free text is never
 * mistaken for a field value. It always starts a new group. */
export interface DetailSection { section: string }
export type DetailRow = string | readonly DetailPart[] | DetailSection;
/** null marks a UI group break; undefined omits an optional row. */
export interface StructuredDetails { rows: readonly (DetailRow | null | undefined)[] }

export const part = (text: string | number | boolean, role?: DetailPart['role']): DetailPart => ({ text: String(text), role });
export const statePart = (text: string | boolean, state = String(text)): DetailPart => ({ text: String(text), state });
export const field = (label: string, value: DetailPart | string | number | boolean, ...suffix: DetailPart[]): DetailRow =>
  [part(`${label} `, 'label'), typeof value === 'object' ? value : part(value), ...suffix];
export const section = (title: string): DetailSection => ({ section: title });
const isSection = (row: DetailRow): row is DetailSection => typeof row === 'object' && 'section' in row;
const sectionText = (title: string, theme?: Theme) => `${divider('──', theme)} ${heading(sanitizeText(title), theme)} ${divider('──', theme)}`;

/** Tool receipts use the original, unsanitized text without UI-only spacing. */
export function plainDetailLines({ rows }: StructuredDetails): string[] {
  return rows.flatMap(row => row == null ? [] : [typeof row === 'string' ? row : isSection(row) ? `── ${row.section} ──` : row.map(({text}) => text).join('')]);
}

export function detailsText({ rows }: StructuredDetails, theme?: Theme): string {
  const lines: string[] = [];
  let gap = false;
  for (const row of rows) {
    if (row === undefined) continue;
    if (row === null) { gap = true; continue; }
    const line = isSection(row) ? sectionText(row.section, theme)
      : (typeof row === 'string' ? [part(row)] : row).map(value => detailPartText(value, theme)).join('');
    if ((gap || isSection(row)) && lines.length) lines.push('');
    lines.push(line);
    gap = false;
  }
  return lines.join('\n');
}

export const detailsContent = (details: StructuredDetails, theme?: Theme): Text => new Text(detailsText(details, theme), 0, 0);
