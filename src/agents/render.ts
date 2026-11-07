import { truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { ScheduledAgent } from './schedules/store.ts';
import type { agentSummary } from './index.ts';

type Summary = ReturnType<typeof agentSummary>;
type Details = { agent: Summary; backgrounded?: boolean; question?: unknown };
type Args = { id: string };
type StartArgs = { type?: string; name?: string; prompt: string; schedule?: string; background?: boolean };
export const startRenderers = toolRenderers<StartArgs, Details | { schedule: ScheduledAgent }>({
  call: args => ({ icon: args.schedule ? '⏲' : '⟳', tone: 'accent', title: args.schedule ? 'Agent schedule' : 'Agent',
    summary: args.schedule ?? `${args.type ?? 'general-purpose'} · ${truncateToWidth(args.name ?? args.prompt?.split('\n')[0] ?? '', 60)}` }),
  collapsed: (data, args) => 'schedule' in data
    ? { icon: '⏲', tone: 'accent', title: data.schedule.id, summary: data.schedule.request.type, meta: data.schedule.nextRun ? [`next ${new Date(data.schedule.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`] : [] }
    : { ...stateLine(data.agent.state), title: data.agent.id, summary: `${data.agent.name} · ${args.background === false && data.agent.elapsedMs !== undefined ? `${(data.agent.elapsedMs / 1000).toFixed(1)}s` : data.agent.state}`,
      meta: data.backgrounded ? ['continuing in background'] : [] },
  expanded: (data, args, text) => [`prompt: ${args.prompt}`, ...'agent' in data
    ? [`model: ${data.agent.model} · thinking: ${data.agent.thinking}`, ...data.agent.usage ? [`usage: ${JSON.stringify(data.agent.usage)}`] : []] : [], text].map(sanitizeText),
});
export const listRenderers = toolRenderers<{ state?: string; scope?: string }, { agents: Summary[]; nextCursor?: string }>({
  call: () => ({ icon: '⟳', tone: 'accent', title: 'Agents' }),
  collapsed: (data, args) => ({ icon: '', title: 'Agents', summary: `${data.agents.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: data => [...data.agents.map(agent => `${stateLine(agent.state).icon} ${agent.id} · ${agent.name} · ${agent.state}${agent.error ? ` · ${agent.error}` : ''}`), ...data.nextCursor ? ['More agents · next page available'] : []].map(sanitizeText),
});
export const getRenderers = toolRenderers<Args, Details>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent', summary: args.id }),
  collapsed: data => ({ ...stateLine(data.question ? 'waiting' : data.agent.state), title: data.agent.id,
    summary: data.question ? 'question pending' : `${data.agent.name} · ${data.agent.state}` }),
});
export const readRenderers = toolRenderers<Args & { stream?: string }, Details & { stream: string; offset: number; nextOffset: number; totalBytes: number }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent read', summary: args.id, meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: 'Agent read', summary: `${data.agent.id} · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B` }),
});
export const sendRenderers = toolRenderers<Args & { message: string }, Details & { action: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent send', summary: args.id }),
  collapsed: data => ({ icon: '', title: data.agent.id, summary: data.action }),
  expanded: (_data, args, text) => [`message: ${args.message}`, text].map(sanitizeText),
});
export const stopRenderers = toolRenderers<Args, StopOutcome>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent stop', summary: args.id }),
  collapsed: (data, args) => ({ ...stateLine(data.state), title: args.id, summary: `${data.state} · cleanup ${data.cleanup}`,
    meta: data.affected.length > 1 ? [`+${data.affected.length - 1} affected`] : [] }),
});
