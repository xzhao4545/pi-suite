import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { sanitizeText } from '../runtime/text.ts';
import { GOAL_RESUME, type ResumeDetails } from './presentation.ts';
import { toolRenderers } from '../ui/tool-render.ts';

export const completeRenderers = toolRenderers<unknown, { summary: string }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal complete' }),
  collapsed: data => ({ icon: '✔', tone: 'success', title: 'Goal complete', summary: truncateToWidth(data.summary, 60) }),
  expanded: data => [data.summary],
});
export const blockedRenderers = toolRenderers<unknown, { reason: string; evidence: string; repeatedTurns: number }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal pause' }),
  collapsed: data => ({ icon: '⚠', tone: 'warning', title: 'Goal paused', summary: truncateToWidth(data.reason, 60) }),
  expanded: data => [{ label: 'reason', value: data.reason, tone: 'warning' }, { label: 'evidence', value: data.evidence },
    { label: 'repeatedTurns', value: String(data.repeatedTurns), tone: 'dim' }],
});
export const waitRenderers = toolRenderers<unknown, { reason: string; waiting: boolean; settled: string[]; waitFor?: string[]; resumeAfterMs?: number }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Goal wait' }),
  collapsed: data => ({ icon: data.waiting ? '⧗' : '✔', tone: data.waiting ? 'dim' : 'success',
    title: data.waiting ? 'Goal waiting' : 'Goal not waiting', summary: data.waiting ? truncateToWidth(data.reason, 60) : 'all settled' }),
  expanded: data => [{ label: 'reason', value: data.reason }, ...data.waitFor ? [{ label: 'waitFor', value: data.waitFor.join(', ') }] : [],
    ...data.resumeAfterMs ? [{ label: 'resumeAfterMs', value: String(data.resumeAfterMs) }] : [],
    ...data.settled.length ? [{ label: 'settled', value: data.settled.join(', '), tone: 'dim' as const }] : []],
});

/** Factory-safe definitions: no owner, model request, UI reader or resource loader imports. */
export function registerGoalMessageRenderers(pi: ExtensionAPI): void {
  const receipt = (summary: string, details: ResumeDetails | undefined, expanded: boolean, pad: number) =>
    new Text(sanitizeText(expanded && details?.resumeVersion === 1 ? `${summary}\n\n${details.text}` : summary), pad, 0);
  pi.registerEntryRenderer<ResumeDetails & { summary: string }>(GOAL_RESUME, (entry, options) =>
    receipt(entry.data?.summary ?? 'Goal resumed', entry.data, options.expanded, 1));
  // Persisted message receipts still need their factory renderer when replaying history.
  pi.registerMessageRenderer<ResumeDetails>(GOAL_RESUME, (message, options) =>
    receipt(typeof message.content === 'string' ? message.content : 'Goal resumed', message.details, options.expanded, options.outputPad));
}
