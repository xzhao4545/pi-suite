import { normalize, type AskParams, type AskResult, type Question } from '../ask/schema.ts';
import { ToolError } from '../runtime/errors.ts';
import type { Execution } from './types.ts';

export function questionText(run: Execution): string {
  return [`${run.record.id} ${run.record.name} waiting(parent)`,
    ...run.question!.questions.flatMap(question => [question.question, question.context ?? '', ...question.options.map(option => `${option.id}: ${option.title}`)]),
    `answer: agent_send({"id":"${run.record.id}","message":"…"})`].filter(Boolean).join('\n');
}
export async function askParent(run: Execution, params: AskParams, timeoutMs: number, changed: () => void, signal?: AbortSignal) {
  const questions = normalize(params), done = Promise.withResolvers<AskResult>();
  if (run.controller.signal.aborted || signal?.aborted) return { result: { status: 'cancelled' as const, responses: [] }, questions };
  const previous = run.record.state;
  const question = { params, questions, seen: false, finish: (result: AskResult) => {
    if (run.question !== question) return;
    run.question = undefined; done.resolve(result);
  } };
  run.question = question; run.record.state = 'waiting';
  const cancel = () => question.finish({ status: 'cancelled', responses: [] });
  run.controller.signal.addEventListener('abort', cancel, { once: true });
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = params.timeoutMs ?? timeoutMs;
  const timer = timeout ? setTimeout(() => question.finish({ status: 'timed_out', responses: [] }), timeout) : undefined;
  try {
    changed();
    const result = await done.promise;
    // Pi's tool terminate contract ends a turn without setting agent_settled.aborted. Preserve
    // the unanswered status so the manager cannot present an expired question as success.
    if (result.status !== 'answered') run.terminated = true;
    return { result, questions };
  }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel); run.controller.signal.removeEventListener('abort', cancel);
    if (run.question === question) run.question = undefined;
    if (run.record.state === 'waiting') run.record.state = previous;
    changed();
  }
}
function answer(question: Question, text: string | string[]): AskResult['responses'][number] {
  if (Array.isArray(text) && !question.allowMultiple) throw new ToolError('INVALID_ANSWER', 'This question accepts a single selection');
  const inputs = Array.isArray(text) ? text : [text];
  const selected = inputs.map(input => question.options.filter(option => option.id === input || option.title === input));
  if (selected.every(matches => matches.length === 1) && inputs.length) {
    const options = selected.map(matches => matches[0]);
    return { kind: 'selection', selections: options.map(option => option.title), optionIds: [...new Set(options.map(option => option.id))] };
  }
  if (Array.isArray(text)) throw new ToolError('INVALID_ANSWER', 'Every selection must match an option ID or title');
  if (!question.allowFreeform) throw new ToolError('INVALID_ANSWER', 'Answer must match an option ID or title');
  return { kind: 'freeform', text };
}
export function answerParent(run: Execution, message: string): void {
  const questions = run.question!.questions;
  const inputs: unknown = questions.length > 1 ? JSON.parse(message)
    : [questions[0].allowMultiple && message.trim().startsWith('[') ? JSON.parse(message) : message];
  if (!Array.isArray(inputs) || inputs.length !== questions.length || inputs.some(input => typeof input !== 'string'
    && (!Array.isArray(input) || input.some(item => typeof item !== 'string')))) {
    throw new ToolError('INVALID_ANSWER', 'A batch answer needs one string or selection array per question');
  }
  run.question!.finish({ status: 'answered', responses: questions.map((question, index) => answer(question, inputs[index])) });
}
