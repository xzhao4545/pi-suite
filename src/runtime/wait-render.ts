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
});
