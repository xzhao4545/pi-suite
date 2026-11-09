import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AskForm, Draft } from "./form.ts";
import type { Option, Question, Response } from "./schema.ts";
import { sanitizeText } from "../runtime/text.ts";

const oneLine = (text: string) => sanitizeText(text).replace(/\s*\n\s*/g, " ");
export const answerText = (response?: Response) => response ? [
  ...response.kind === 'selection' ? response.selections : [], ...response.text ? [`✎ ${response.text}`] : [],
].join(', ') : undefined;

/** Shared markers keep the full list and the one-line phone layout consistent. */
export function optionRow(theme: Theme, question: Question, draft: Pick<Draft, 'selected' | 'text' | 'customSelected'>, option: Option | undefined, focused: boolean): string {
  const selected = option ? draft.selected.has(option.id) : draft.customSelected && Boolean(draft.text.trim());
  const choice = question.allowMultiple ? selected ? "☑" : "☐" : selected ? "◉" : "○";
  const marker = option ? choice : `${question.options.length ? choice + ' ' : ''}✎`;
  const title = option?.title ?? (draft.text.trim() ? draft.text : 'Type your own answer');
  return (focused ? theme.fg("accent", "❯ ") : "  ") + theme.fg(selected ? "success" : "dim", marker) + " " +
    (focused ? theme.fg("accent", oneLine(title)) : oneLine(title)) + (option?.recommended ? theme.fg("accent", " (Recommended)") : "");
}
export interface TabRegion { start: number; end: number; page: number }
export function questionTabs(form: AskForm, theme: Theme, width: number): { line: string; regions: TabRegion[] } {
  const page = form.reviewing ? form.questions.length : form.index;
  const tabs = [...form.questions.map((question, index) => ({ page: index,
    title: truncateToWidth(oneLine(question.title ?? question.question).replace(/\s+/g, ' ').trim() || 'Question', 22, '…'),
    answered: form.answered(index),
  })), { page: form.questions.length, title: 'Review', answered: false }];
  // Budget every label before styling, rather than clipping the entire bar and leaving
  // invisible tabs with clickable regions. Very narrow screens retain the active page.
  const minimum = tabs.reduce((sum, tab) => sum + (tab.page === form.questions.length ? 6 : Math.min(3, visibleWidth(tab.title))) + Number(tab.answered), tabs.length - 1);
  const shown = minimum <= width ? tabs : [tabs[page],
    ...page !== form.questions.length && width >= Math.min(3, visibleWidth(tabs[page].title)) + Number(tabs[page].answered) + 7 ? [tabs.at(-1)!] : []];
  const sizes = shown.map(tab => visibleWidth(tab.title) + Number(tab.answered));
  let excess = sizes.reduce((sum, size) => sum + size, shown.length - 1) - width;
  while (excess > 0) {
    let widest = -1;
    for (let index = 0; index < shown.length; index++) {
      if (shown.length > 1 && shown[index].page === form.questions.length) continue;
      if (sizes[index] > 1 && (widest < 0 || sizes[index] > sizes[widest])) widest = index;
    }
    if (widest < 0) break;
    sizes[widest]--; excess--;
  }
  let line = '';
  const regions: TabRegion[] = [];
  shown.forEach((tab, index) => {
    const badge = tab.answered && sizes[index] > 1 ? theme.fg('success', '✓') : '';
    const title = truncateToWidth(tab.title, Math.max(0, sizes[index] - visibleWidth(badge)), '…');
    const label = (tab.page === page ? theme.fg('accent', title) : title) + badge;
    if (index) line += ' ';
    const start = visibleWidth(line);
    line += label;
    const end = visibleWidth(line);
    if (end > start && end <= width) regions.push({ start, end, page: tab.page });
  });
  return { line: truncateToWidth(line, width), regions };
}
export function idleTime(deadline?: number): string {
  if (deadline === undefined) return "no timeout";
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `idle ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
