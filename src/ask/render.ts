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
  let line = "";
  const regions = Array.from({ length: form.questions.length + 1 }, (_, index) => {
    const title = index === form.questions.length ? "Review" : `Q${index + 1}`;
    const answered = index < form.questions.length && form.answered(index);
    const label = index === page ? theme.fg("accent", title) : title;
    const start = visibleWidth(line);
    line += label + (answered ? theme.fg("success", "✓") : "");
    const end = visibleWidth(line);
    line += " ";
    return { start, end: Math.min(width, end), page: index };
  });
  return { line: truncateToWidth(line.trimEnd(), width), regions };
}
export function idleTime(deadline?: number): string {
  if (deadline === undefined) return "no timeout";
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `idle ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
