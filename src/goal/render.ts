import { truncateToWidth } from '@earendil-works/pi-tui';
import { toolRenderers } from '../ui/tool-render.ts';

export const completeRenderers = toolRenderers<unknown, { summary: string }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal complete' }),
  collapsed: data => ({ icon: '✔', tone: 'success', title: 'Goal complete', summary: truncateToWidth(data.summary, 60) }),
});
export const blockedRenderers = toolRenderers<unknown, { reason: string; evidence: string; repeatedTurns: number }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal blocked' }),
  collapsed: data => ({ icon: '⚠', tone: 'warning', title: 'Goal blocked', summary: truncateToWidth(data.reason, 60) }),
  expanded: data => [{ label: 'reason', value: data.reason, tone: 'warning' }, { label: 'evidence', value: data.evidence },
    { label: 'repeatedTurns', value: String(data.repeatedTurns), tone: 'dim' }],
});
export const waitRenderers = toolRenderers<unknown, { reason: string; waiting: boolean; settled: string[]; waitFor?: string[]; resumeAfterMs?: number }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal wait' }),
  collapsed: data => ({ icon: data.waiting ? '⧗' : '✔', tone: data.waiting ? 'dim' : 'success',
    title: data.waiting ? 'Goal waiting' : 'Goal not waiting', summary: data.waiting ? truncateToWidth(data.reason, 60) : 'all settled' }),
  expanded: (data, _args, text) => [text, ...data.waitFor ? [{ label: 'waitFor', value: data.waitFor.join(', ') }] : [],
    ...data.resumeAfterMs ? [{ label: 'resumeAfterMs', value: String(data.resumeAfterMs) }] : [],
    ...data.settled.length ? [{ label: 'settled', value: data.settled.join(', '), tone: 'dim' as const }] : []],
});
