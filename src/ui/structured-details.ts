import { getMarkdownTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Markdown, Text, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { detailPartText, divider, heading, type DetailPart } from './browser-chrome.ts';
import { sanitizeText } from '../runtime/text.ts';

/** A section names the block below it (metadata, input, output) so long free text is never
 * mistaken for a field value. It always starts a new group. */
export interface DetailSection { section: string }
export interface DetailOutput { output: string; markdown?: boolean }
export type DetailRow = string | readonly DetailPart[] | DetailSection | DetailOutput;
/** null marks a UI group break; undefined omits an optional row. */
export interface StructuredDetails { rows: readonly (DetailRow | null | undefined)[] }

export const part = (text: string | number | boolean, role?: DetailPart['role']): DetailPart => ({ text: String(text), role });
export const statePart = (text: string | boolean, state = String(text)): DetailPart => ({ text: String(text), state });
export const field = (label: string, value: DetailPart | string | number | boolean, ...suffix: DetailPart[]): DetailRow =>
  [part(`${label} `, 'label'), typeof value === 'object' ? value : part(value), ...suffix];
export const section = (title: string): DetailSection => ({ section: title });
export const outputRow = (output: string, options?: Pick<DetailOutput, 'markdown'>): DetailOutput => ({ output, ...options });
const isSection = (row: DetailRow): row is DetailSection => typeof row === 'object' && 'section' in row;
const isOutput = (row: DetailRow): row is DetailOutput => typeof row === 'object' && 'output' in row;
const sectionText = (title: string, theme?: Theme) => `${divider('──', theme)} ${heading(sanitizeText(title), theme)} ${divider('──', theme)}`;

/** Non-TUI receipts keep the original text: expansion is local to the interactive reader. */
export function plainDetailLines({ rows }: StructuredDetails): string[] {
  return rows.flatMap(row => row == null ? [] : [typeof row === 'string' ? row : isSection(row) ? `── ${row.section} ──`
    : isOutput(row) ? row.output : row.map(({text}) => text).join('')]);
}

function detailLines({ rows }: StructuredDetails, theme?: Theme): (string | DetailOutput)[] {
  const lines: (string | DetailOutput)[] = [];
  let gap = false;
  for (const row of rows) {
    if (row === undefined) continue;
    if (row === null) { gap = true; continue; }
    if ((gap || isSection(row)) && lines.length) lines.push('');
    lines.push(isOutput(row) ? row : isSection(row) ? sectionText(row.section, theme)
      : (typeof row === 'string' ? [part(row)] : row).map(value => detailPartText(value, theme)).join(''));
    gap = false;
  }
  return lines;
}

const joinDetailLines = (lines: (string | DetailOutput)[]): string =>
  lines.map(line => typeof line === 'string' ? line : sanitizeText(line.output)).join('\n');

export function detailsText(details: StructuredDetails, theme?: Theme): string {
  return joinDetailLines(detailLines(details, theme));
}

export const detailsContent = (details: StructuredDetails, theme?: Theme): Text => new Text(detailsText(details, theme), 0, 0);

/** Output owns only its display state, not ToolRenderer's tool invocation and result templates. */
class DetailOutputView implements Component {
  expanded = false;
  private readonly summary: string;
  private body?: Component;

  constructor(private row: DetailOutput) {
    const count = row.output ? row.output.split('\n').length : 0;
    this.summary = `Output: ${count} ${count === 1 ? 'line' : 'lines'} · e expand`;
  }
  toggle(): void { this.expanded = !this.expanded; }
  invalidate(): void { this.body?.invalidate(); }
  render(width: number): readonly string[] {
    if (!this.expanded) return [truncateToWidth(this.summary, width)];
    // Defer Markdown construction until the user opens the result; keep its native render cache.
    if (!this.body) {
      const text = sanitizeText(this.row.output);
      this.body = this.row.markdown ? new Markdown(text, 0, 0, getMarkdownTheme()) : new Text(text, 0, 0);
    }
    return this.body.render(width);
  }
}

/** Only the dedicated detail reader binds a toggle; list previews still use static detailsContent. */
export function readingDetailsContent(details: StructuredDetails, theme?: Theme): { body: Component; output?: DetailOutputView } {
  const lines = detailLines(details, theme);
  const index = lines.findIndex(line => typeof line !== 'string');
  const row = lines[index];
  if (row === undefined || typeof row === 'string') return { body: new Text(joinDetailLines(lines), 0, 0) };
  const output = new DetailOutputView(row), body = new Container();
  body.addChild(new Text(joinDetailLines(lines.slice(0, index)), 0, 0));
  body.addChild(output);
  if (index + 1 < lines.length) body.addChild(new Text(joinDetailLines(lines.slice(index + 1)), 0, 0));
  return {body, output};
}
