import type { Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import type { AskForm, Draft } from './form.ts';
import type { Option, Question } from './schema.ts';
import { answerText, optionRow } from './render.ts';

const wrap = (text: string, width: number) => sanitizeText(text).split('\n').flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
export function fold(lines: string[], width: number, cap: number, hint = ''): string[] {
  if (lines.length <= cap) return lines;
  if (cap < 1) return [];
  return [...lines.slice(0, cap - 1), truncateToWidth(lines[cap - 1], Math.max(0, width - visibleWidth(`… ${hint}`)), '') + `… ${hint}`];
}
export function questionLines(question: Question, theme: Theme, width: number, cap: number, expanded: boolean): string[] {
  const lines = [...wrap(question.question, width), ...question.context ? wrap(question.context, width).map(line => theme.fg('muted', line)) : []];
  return fold(lines, width, cap, expanded ? 'd 全文' : 'e 展开');
}
export function choiceLines(theme: Theme, question: Question, draft: Draft, option: Option | undefined, focused: boolean,
  width: number, expanded: boolean, preview: boolean): string[] {
  const title = optionRow(theme, question, draft, option, focused);
  const lines = expanded ? wrapTextWithAnsi(title, Math.max(1, width)) : [truncateToWidth(title, width, '…')];
  if (option?.description && !preview) {
    const desc = wrap(option.description, width - 6);
    lines.push(...(expanded ? desc : fold(desc, width - 6, 2)).map(line => '      ' + theme.fg('muted', line)));
  }
  return lines;
}
export function reviewLines(form: AskForm, theme: Theme, width: number, expanded: boolean): string[][] {
  return form.questions.map((question, index) => {
    const text = `${index + 1}. ${question.question}: ${answerText(form.response(index)) ?? theme.fg('warning', 'Unanswered')}`;
    return expanded ? wrap(text, width) : [truncateToWidth(text.replace(/\s*\n\s*/g, ' '), width, '…')];
  });
}
export interface Frame { width: number; inset: number; bordered: boolean; separators: boolean }
export function frame(width: number, limit: number): Frame {
  const bordered = limit >= 5, inset = bordered && width >= 50 ? 3 : 0;
  return { width: Math.max(1, width - inset * 2), inset, bordered, separators: limit >= 12 };
}
export function topBorder(theme: Theme, width: number, requester: string, heading: string | undefined, page: string, time: string): string {
  const right = ` ${page} · ${time} `;
  const room = Math.max(0, width - visibleWidth(right) - 4);
  let request = sanitizeText(requester).replace(/\s+/g, ' ');
  const headingRoom = Math.max(0, room - visibleWidth(`Ask · ${request} · `));
  const title = heading ? truncateToWidth(sanitizeText(heading).replace(/\s+/g, ' '), headingRoom, '…') : '';
  request = truncateToWidth(request, Math.max(0, room - visibleWidth('Ask · ') - (title ? visibleWidth(title) + 3 : 0)), '…');
  const left = truncateToWidth(`Ask${request ? ` · ${request}` : ''}${title ? ` · ${title}` : ''}`, room);
  const fill = '─'.repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right) - 4));
  return theme.fg('border', '╭─ ') + theme.bold(theme.fg('accent', left)) + theme.fg('border', fill + right + '╮');
}
export function frameLines(theme: Theme, geometry: Frame, width: number, top: string, content: string[], markers: Map<number, string>): string[] {
  if (!geometry.bordered) return content;
  const edge = (left: string, right: string) => theme.fg('border', left + '─'.repeat(Math.max(0, width - 2)) + right);
  return [top, ...content.map((line, index) => {
    if (line === '\0separator') return edge('├', '┤');
    if (!geometry.inset) return truncateToWidth(line, width);
    const text = truncateToWidth(line, geometry.width);
    return theme.fg('border', '│') + '  ' + text + ' '.repeat(Math.max(0, geometry.width - visibleWidth(text))) + '  ' + theme.fg('border', markers.get(index) ?? '│');
  }), edge('╰', '╯')];
}

export interface ListPosition { offset: number; cursor: number; lengths?: number[] }
/** Scroll physical rows, but keep option identity for clicks and keyboard movement. */
export function listWindow(blocks: string[][], cursor: number, height: number, position: ListPosition): { lines: string[]; indices: number[]; total: number } {
  const lines = blocks.flat(), indices = blocks.flatMap((block, index) => block.map(() => index));
  const start = indices.indexOf(cursor);
  // A resize changes physical line counts. Retain the same item and its local
  // reading row rather than applying an old line number to unrelated content.
  if (position.lengths && position.lengths.some((length, index) => length !== blocks[index]?.length)) {
    let item = 0, local = position.offset;
    while (item < position.lengths.length - 1 && local >= position.lengths[item]) local -= position.lengths[item++];
    position.offset = blocks.slice(0, item).reduce((sum, block) => sum + block.length, 0) + Math.min(local, Math.max(0, (blocks[item]?.length ?? 1) - 1));
  }
  position.lengths = blocks.map(block => block.length);
  if (position.cursor !== cursor) position.offset = Math.max(0, start - Math.max(0, height - (blocks[cursor]?.length ?? 0)));
  position.cursor = cursor;
  position.offset = Math.max(0, Math.min(position.offset, lines.length - height));
  return { lines: lines.slice(position.offset, position.offset + height), indices: indices.slice(position.offset, position.offset + height), total: lines.length };
}
