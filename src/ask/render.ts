import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AskForm, Draft } from "./form.ts";
import type { Option, Question, Response } from "./schema.ts";
import { sanitizeText } from "../runtime/text.ts";

const oneLine = (text: string) => sanitizeText(text).replace(/\s*\n\s*/g, " ");
export const answerText = (response?: Response) => response?.kind === "freeform" ? response.text : response?.selections.join(", ");

/** Shared markers keep the full list and the one-line phone layout consistent. */
export function optionRow(theme: Theme, question: Question, draft: Pick<Draft, 'selected' | 'text'>, option: Option | undefined, focused: boolean): string {
  const selected = option ? draft.selected.has(option.id) : Boolean(draft.text.trim());
  const marker = option ? question.allowMultiple ? selected ? "☑" : "☐" : selected ? "◉" : "○" : "✎";
  const title = option?.title ?? `Type your own answer${draft.text.trim() ? `: ${draft.text}` : ""}`;
  return (focused ? theme.fg("accent", "❯ ") : "  ") + theme.fg(selected ? "success" : "dim", marker) + " " +
    (focused ? theme.fg("accent", oneLine(title)) : oneLine(title)) + (option?.recommended ? theme.fg("accent", " (Recommended)") : "");
}
export function questionType(form: AskForm): string {
  if (form.reviewing) return "Review";
  return !form.question.options.length ? "✎ Text" : form.question.allowMultiple
    ? `☐ Multiple choice · ${form.draft.selected.size} selected` : "○ Single choice";
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
export function reviewRows(form: AskForm, theme: Theme, width: number): string[] {
  return form.questions.map((question, index) => truncateToWidth(`${index + 1}. ${oneLine(question.question)}: ` +
    (answerText(form.response(index)) ? oneLine(answerText(form.response(index))!) : theme.fg("warning", "Unanswered")), width));
}
export function idleTime(deadline?: number): string {
  if (deadline === undefined) return "no timeout";
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `idle ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
