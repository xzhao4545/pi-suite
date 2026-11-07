import { truncateToWidth } from '@earendil-works/pi-tui';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import { answerText, optionRow } from './render.ts';
import { normalize, type AskParams } from './schema.ts';
import type { AskDetails } from './result.ts';
import { sanitizeText } from '../runtime/text.ts';

type Details = AskDetails;
export function askRenderers(title = 'Ask') {
  return toolRenderers<AskParams, Details>({
    call: args => ({ icon: '?', tone: 'warning', title,
      summary: args.questions ? `${args.questions.length} questions` : truncateToWidth(args.question ?? '', 60) }),
    collapsed: data => {
      const batch = 'answers' in data, answers = batch ? data.answers : [{ response: data.response }];
      const unanswered = answers.filter(answer => !answer.response).length;
      return { ...stateLine(data.status), title,
        summary: data.status === 'cancelled' ? data.status : data.status === 'skipped'
          ? `skipped · ${batch ? `${answers.length - unanswered} answered` : answerText(data.response ?? undefined) ?? 'unanswered'}` : batch
          ? `${answers.length - unanswered} answered` : `${truncateToWidth(data.question ?? '', 40)} → ${answerText(data.response ?? undefined) ?? 'unanswered'}`,
        meta: data.status === 'timed_out' ? ['auto-selected', ...unanswered ? [`${unanswered} unanswered`] : []] : [] };
    },
    expanded: (data, args, _text, theme) => {
      const questions = 'questions' in data ? data.questions : normalize({ ...args, question: data.question,
        context: data.context, options: data.options });
      const responses = 'answers' in data ? data.answers.map(answer => answer.response) : [data.response];
      return [data.status, ...'heading' in data && data.heading ? [sanitizeText(data.heading)] : [],
        ...questions.flatMap((question, index) => {
          const response = responses[index];
          // Use the live form's markers; the transcript has no editing focus.
          const selected = new Set(response?.kind === 'selection' ? response.optionIds : []);
          const draft = { selected, text: response?.text ?? '', customSelected: Boolean(response?.text) };
          return [sanitizeText(question.question), ...question.context ? [sanitizeText(question.context)] : [],
            ...question.options.flatMap(option => [optionRow(theme, question, draft, option, false),
              ...option.description ? [`    ${sanitizeText(option.description)}`] : []]),
            ...response?.text ? [optionRow(theme, question, draft, undefined, false)] : [],
            ...response?.comment ? [`comment: ${sanitizeText(response.comment)}`] : [],
            ...response?.autoSelected ? ['auto-selected'] : [], ...response ? [] : ['unanswered']];
        })];
    },
  });
}
