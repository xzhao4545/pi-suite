import { agentDisplayName } from '../agents/registry.ts';
import { sanitizeText } from './text.ts';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import type { WaitResult } from './wait.ts';

export const waitRenderers = toolRenderers<{ ids: string[] }, WaitResult>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Wait', summary: `${args.ids?.length ?? 0} objects` }),
  collapsed: data => {
    const failed = [...data.results, ...data.others].filter(item => item.state === 'failed').length;
    return { icon: failed ? '✘' : '', tone: failed ? 'error' : undefined, title: 'Wait',
      summary: `${data.results.filter(item => item.settled).length}/${data.results.length} settled`,
      meta: [...failed ? [{ text: `${failed} failed`, tone: 'error' as const }] : [],
        ...data.reason !== 'condition' ? [{ text: `returned early: ${data.reason}`, tone: 'warning' as const }] : []] };
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
    return [...[...data.results, ...data.others].map(item => ({ ...stateLine(item.state),
      title: agentDisplayName(item.id, item.runId), meta: [{ text: item.state, tone: stateLine(item.state).tone! }] })),
    ...[...data.results, ...data.others].filter(item => item.state === 'failed').map(item => ({ label: 'error', value: item.summary, tone: 'error' as const })), display];
  },
});
