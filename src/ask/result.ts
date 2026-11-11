import type { AskParams, AskResult, Question, Response } from './schema.ts';
import { textResult } from '../runtime/tools.ts';

export function askDetails(params: AskParams, questions: Question[], result: AskResult) {
  // A skipped form retains partial user answers; cancellation carries no answers.
  const common = { status: result.status, cancelled: result.status === "skipped" || result.status === "cancelled" };
  return params.questions ? {
    ...common, kind: "batch", heading: params.question, questions,
    answers: result.status === 'cancelled' ? [] : questions.map((_, index) => {
      const response = result.responses[index];
      return response ? { status: "answered", response } : { status: "unanswered" };
    }),
  } : { ...common, question: params.question, options: questions[0].options, response: result.responses[0] ?? null };
}
export type AskDetails = ReturnType<typeof askDetails>;

const QUESTION_WIDTH = 24;
const clip = (text: string) => {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > QUESTION_WIDTH ? chars.slice(0, QUESTION_WIDTH - 1).join('') + '…' : chars.join('');
};
function selection(question: Question, response: Extract<Response, { kind: 'selection' }>): string {
  const counts = new Map<string, number>();
  const positions = new Map(question.options.map((option, index) => [option.id, index + 1]));
  for (const option of question.options) counts.set(option.title, (counts.get(option.title) ?? 0) + 1);
  // A title alone is enough unless another offered option has the same title.
  // Number by the original list, never the selected subset; IDs remain in details.
  const titles = response.selections.map((title, index) => counts.get(title)! > 1
    ? `#${positions.get(response.optionIds[index])} ${title}` : title);
  return titles.join(', ') + (response.text ? ` + custom: ${response.text}` : '');
}
const answer = (question: Question, response?: Response) => !response ? 'unanswered'
  : (response.kind === 'selection' ? selection(question, response) : `custom: ${response.text}`) +
    (response.autoSelected ? ' (auto-selected)' : '');
const comment = (response: Response | undefined, indent = '') => response?.comment ? [`${indent}comment: ${response.comment}`] : [];

/**
 * Model-facing ask result. The model already holds its own questions and options, so the
 * text carries only status and answers; details keeps the full record for rendering and
 * history. Answers attached to timed_out/skipped are labelled "not consent" because the
 * model must not treat them as authorization (see the ask_user prompt guidelines).
 */
export function askToolResult(params: AskParams, questions: Question[], result: AskResult, source?: 'parent') {
  const record = askDetails(params, questions, result);
  const details = source ? { ...record, source } : record;
  const responses = result.responses;
  const head = result.status + (result.status === 'timed_out' || result.status === 'skipped' ? ' (not consent)' : '');
  const lines = result.status === 'cancelled' ? ['cancelled'] : [
    head,
    // Both shapes keep question positions. Mark automation per answer so mixed
    // drafts and parent timeouts cannot imply that every slot was auto-selected.
    ...questions.flatMap((question, index) => [`${index + 1}. ${clip(question.question)} → ${answer(question, responses[index])}`,
      ...comment(responses[index], '   ')]),
  ];
  return textResult([...lines, source && `source: ${source}`], details);
}
