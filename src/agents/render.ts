import { truncateToWidth } from '@earendil-works/pi-tui';
import { toolRenderers, stateLine, type ToolExpandedRow } from '../ui/tool-render.ts';
import { agentDisplayName } from './registry.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { ScheduledAgent } from './schedules/store.ts';
import type { agentSummary } from './index.ts';

type Summary = ReturnType<typeof agentSummary>;
type Details = { agent: Summary; backgrounded?: boolean; question?: unknown };
type Args = { id: string; runId?: string };
type StartArgs = { type?: string; name?: string; prompt: string; schedule?: string; background?: boolean };
function agentFields(agent: Summary, text: string): ToolExpandedRow[] {
  return [
    { label: 'state', value: agent.state, tone: stateLine(agent.state).tone },
    ...agent.model ? [{ label: 'model', value: agent.model }, { label: 'thinking', value: agent.thinking }] : [],
    ...agent.usage ? [{ code: JSON.stringify(agent.usage, null, 2), language: 'json' as const, label: 'usage' }] : [],
    ...agent.error ? [{ label: 'error', value: agent.error, tone: 'error' as const }] : [], text,
  ];
}
export const startRenderers = toolRenderers<StartArgs, Details | { schedule: ScheduledAgent }>({
  call: args => args.schedule
    ? { icon: '⏲', tone: 'accent', title: 'Agent schedule', summary: args.schedule }
    : { icon: '⟳', tone: 'accent', title: args.name ?? args.type ?? 'general-purpose',
      summary: truncateToWidth(args.prompt?.split('\n')[0] ?? '', 60), meta: args.name ? [args.type ?? 'general-purpose'] : [] },
  collapsed: (data, args) => 'schedule' in data
    ? { icon: '⏲', tone: 'accent', title: data.schedule.id, summary: data.schedule.request.type, meta: data.schedule.nextRun ? [`next ${new Date(data.schedule.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`] : [] }
    : { ...stateLine(data.agent.state), title: data.agent.name,
      meta: [...args.background === false && data.agent.elapsedMs !== undefined ? [`${(data.agent.elapsedMs / 1000).toFixed(1)}s`]
        : [{ text: data.agent.state, tone: stateLine(data.agent.state).tone! }], ...data.backgrounded ? ['continuing in background'] : []] },
  expanded: (data, args, text) => [{ label: 'prompt', value: args.prompt ?? '' }, ...'agent' in data ? agentFields(data.agent, text)
    : [{ code: JSON.stringify(data.schedule, null, 2), language: 'json', label: 'schedule' }, text]],
});
export const listRenderers = toolRenderers<{ agentId?: string; state?: string; scope?: string }, { agents: Summary[]; nextCursor?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agents', summary: args.agentId ? agentDisplayName(args.agentId) : undefined }),
  collapsed: (data, args) => ({ icon: '', title: 'Agents', summary: `${data.agents.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: data => [...data.agents.flatMap(agent => [
    { ...stateLine(agent.state), title: agent.name, meta: [{ text: agent.state, tone: stateLine(agent.state).tone! }, `${agent.id} · ${agent.runId}`] },
    ...agent.error ? [{ label: 'error', value: agent.error, tone: 'error' as const }] : [],
  ]), ...data.nextCursor ? [{ label: 'more', value: 'next page available', tone: 'warning' as const }] : []],
});
export const getRenderers = toolRenderers<Args, Details>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: data => ({ ...stateLine(data.question ? 'waiting(parent)' : data.agent.state), title: data.agent.name,
    meta: [{ text: data.question ? 'question pending' : data.agent.state, tone: stateLine(data.question ? 'waiting(parent)' : data.agent.state).tone! }] }),
  expanded: (data, _args, text) => [...agentFields(data.agent, text),
    ...data.question ? [{ code: JSON.stringify(data.question, null, 2), language: 'json' as const, label: 'question' }] : []],
});
export const readRenderers = toolRenderers<Args & { stream?: string }, Details & { stream: string; offset: number; nextOffset: number; totalBytes: number }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent read', summary: agentDisplayName(args.id, args.runId), meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: `read · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B` }),
  expanded: (_data, _args, text) => [text], // Arbitrary transcript/log output is literal, not Markdown or inferred code.
});
export const sendRenderers = toolRenderers<Args & { message: string }, Details & { action: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent send', summary: agentDisplayName(args.id) }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: data.action }),
  expanded: (_data, args, text) => [{ label: 'message', value: args.message ?? '' }, text],
});
export const stopRenderers = toolRenderers<Args, StopOutcome & { name?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent stop', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: (data, args) => ({ ...stateLine(data.state), title: data.name ?? agentDisplayName(args.id, args.runId),
    meta: [{ text: data.state, tone: stateLine(data.state).tone! }, { text: `cleanup ${data.cleanup}`,
      tone: ['pending', 'unconfirmed'].includes(data.cleanup) ? 'warning' : 'dim' },
      ...data.affected.length > 1 ? [`+${data.affected.length - 1} affected`] : []] }),
  expanded: (data, _args, text) => [{ label: 'cleanup', value: data.cleanup,
    tone: ['pending', 'unconfirmed'].includes(data.cleanup) ? 'warning' : 'dim' },
  { code: JSON.stringify(data.affected, null, 2), language: 'json', label: 'affected' }, text],
});
