import { agentDisplayName } from '../agents/runtime.ts';
import { sanitizeText } from './text.ts';
import { toolRenderers } from '../ui/tool-render.ts';
import type { WaitResult } from './wait.ts';

export const waitRenderers = toolRenderers<{ ids: string[] }, WaitResult>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Wait', summary: `${args.ids?.length ?? 0} objects` }),
  collapsed: data => {
    const failed = [...data.results, ...data.others].filter(item => item.state === 'failed').length;
    return { icon: failed ? '✘' : '', tone: failed ? 'error' : undefined, title: 'Wait',
      summary: `${data.results.filter(item => item.settled).length}/${data.results.length} settled`,
      meta: [...failed ? [`${failed} failed`] : [], ...data.reason !== 'condition' ? [`returned early: ${data.reason}`] : []] };
  },
  expanded: (data, _args, text) => {
    // Only rewrite the rendered identity; result bodies and read/send arguments keep their IDs.
    let display = text;
    for (const item of [...data.results, ...data.others]) {
      const name = agentDisplayName(item.id, item.runId);
      if (name === item.id) continue;
      const summary = sanitizeText(item.summary);
      display = display.replace(summary, () => summary.replace(item.id, () => sanitizeText(name)));
    }
    if (data.pending.length && data.reason !== 'condition') {
      display = display.replace(`pending: ${data.pending.join(', ')}`,
        () => `pending: ${data.pending.map(id => sanitizeText(agentDisplayName(id))).join(', ')}`);
    }
    return [display];
  },
});
