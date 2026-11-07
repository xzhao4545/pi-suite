import type { AskParams, AskResult, Question, Response } from './schema.ts';
import { textResult } from '../runtime/tools.ts';

export function askDetails(params: AskParams, questions: Question[], result: AskResult) {
  // A skipped form retains partial user answers; cancellation carries no answers.
  const common = { status: result.status, cancelled: result.status === "skipped" || result.status === "cancelled" };
  return params.questions ? {
    ...common, kind: "batch", heading: params.question, questions,
    answers: result.responses.map(response => response ? { status: "answered", response } : { status: "unanswered" }),
  } : { ...common, question: params.question, context: params.context, options: questions[0].options, response: result.responses[0] ?? null };
}
export type AskDetails = ReturnType<typeof askDetails>;

const QUESTION_WIDTH = 60;
const clip = (text: string) => {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > QUESTION_WIDTH ? chars.slice(0, QUESTION_WIDTH - 1).join('') + '…' : chars.join('');
};
const selection = (response: Extract<Response, { kind: 'selection' }>) =>
  `${response.selections.join(', ')} (${response.optionIds.join(', ')})${response.text ? ` + custom: ${response.text}` : ''}`;
const answer = (response?: Response) => !response ? 'unanswered'
  : response.kind === 'selection' ? selection(response) : `custom: ${response.text}`;
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
  const responses = result.responses, answered = responses.filter(Boolean).length;
  const flags: string[] = [];
  if (!params.questions && responses[0]?.kind === 'freeform') flags.push('custom');
  if (result.status === 'timed_out') {
    if (answered) flags.push('auto-selected');
    // Parent protocol timeouts have no answers; absence of a default is still not consent.
    flags.push('not consent');
  } else if (result.status === 'skipped' && (answered || params.questions)) flags.push('not consent');
  const head = result.status + (flags.length ? ` (${flags.join(', ')})` : '');
  let lines: string[];
  if (result.status === 'cancelled') lines = ['cancelled'];
  else if (params.questions) lines = [
    `${head} · ${answered}/${questions.length} answered`,
    // Timed-out and skipped batches keep empty slots, so indices stay aligned with questions.
    ...questions.flatMap((question, index) => [`${index + 1}. ${clip(question.question)} → ${answer(responses[index])}`,
      ...comment(responses[index], '   ')]),
  ];
  else lines = [`${head}: ${responses[0]?.kind === 'freeform' ? responses[0].text : answer(responses[0])}`, ...comment(responses[0])];
  return textResult([...lines, source && `source: ${source}`], details);
}
