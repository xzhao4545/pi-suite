import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import { answerText, optionRow } from './render.ts';
import { normalize, type AskParams, type Question } from './schema.ts';
import type { AskDetails } from './result.ts';

// Compatibility is display-only: persisted context can be read here without
// widening the current schema/Question or normalizing it back into a live request.
type HistoricalQuestion = Question & { context?: string };
type Details = AskDetails & { context?: string; source?: 'parent' };
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
        meta: [...answers.some(answer => answer.response?.autoSelected) ? ['auto-selected'] : [],
          ...data.status === 'timed_out' || data.status === 'skipped' ? ['not consent'] : [],
          ...unanswered ? [`${unanswered} unanswered`] : [], ...data.source ? [`source: ${data.source}`] : []] };
    },
    expanded: (data, args, _text, theme) => {
      const questions: HistoricalQuestion[] = 'questions' in data ? data.questions : normalize({ ...args, question: data.question,
        options: data.options });
      const responses = 'answers' in data ? data.answers.map(answer => answer.response) : [data.response];
      return [{ label: 'state', value: data.status, tone: stateLine(data.status).tone },
        ...data.status === 'timed_out' || data.status === 'skipped' ? [{ label: 'consent', value: 'not consent', tone: 'warning' as const }] : [],
        ...data.source ? [{ label: 'source', value: data.source }] : [], ...'heading' in data && data.heading ? [{ icon: '', title: data.heading }] : [],
        ...questions.flatMap((question, index) => {
          const response = responses[index];
          // Use the live form's markers; the transcript has no editing focus.
          const selected = new Set(response?.kind === 'selection' ? response.optionIds : []);
          const draft = { selected, text: response?.text ?? '', customSelected: Boolean(response?.text) };
          const context = 'questions' in data ? question.context : data.context;
          return [{ icon: '?', tone: 'accent' as const, title: question.question }, ...context ? [{ label: 'context', value: context }] : [],
            ...question.options.flatMap(option => [new Text(optionRow(theme, question, draft, option, false), 0, 0),
              ...option.description ? [{ label: 'description', value: option.description }] : []]),
            ...response?.text ? [new Text(optionRow(theme, question, draft, undefined, false), 0, 0)] : [],
            ...response?.comment ? [{ label: 'comment', value: response.comment }] : [],
            ...response?.autoSelected ? [{ label: 'source', value: 'auto-selected · not consent', tone: 'warning' as const }] : [],
            ...response ? [] : [{ label: 'answer', value: 'unanswered', tone: 'warning' as const }]];
        })];
    },
  });
}
