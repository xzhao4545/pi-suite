import { truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { toolRenderers, stateLine } from '../ui/tool-render.ts';
import { agentDisplayName } from './runtime.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { ScheduledAgent } from './schedules/store.ts';
import type { agentSummary } from './index.ts';

type Summary = ReturnType<typeof agentSummary>;
type Details = { agent: Summary; backgrounded?: boolean; question?: unknown };
type Args = { id: string; runId?: string };
type StartArgs = { type?: string; name?: string; prompt: string; schedule?: string; background?: boolean };
export const startRenderers = toolRenderers<StartArgs, Details | { schedule: ScheduledAgent }>({
  call: args => args.schedule
    ? { icon: '⏲', tone: 'accent', title: 'Agent schedule', summary: args.schedule }
    : { icon: '⟳', tone: 'accent', title: args.name ?? args.type ?? 'general-purpose',
      summary: truncateToWidth(args.prompt?.split('\n')[0] ?? '', 60), meta: args.name ? [args.type ?? 'general-purpose'] : [] },
  collapsed: (data, args) => 'schedule' in data
    ? { icon: '⏲', tone: 'accent', title: data.schedule.id, summary: data.schedule.request.type, meta: data.schedule.nextRun ? [`next ${new Date(data.schedule.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`] : [] }
    : { ...stateLine(data.agent.state), title: data.agent.name, summary: args.background === false && data.agent.elapsedMs !== undefined ? `${(data.agent.elapsedMs / 1000).toFixed(1)}s` : data.agent.state,
      meta: data.backgrounded ? ['continuing in background'] : [] },
  expanded: (data, args, text) => [...'agent' in data ? [data.agent.name] : [], `prompt: ${args.prompt}`, ...'agent' in data
    ? [`model: ${data.agent.model} · thinking: ${data.agent.thinking}`, ...data.agent.usage ? [`usage: ${JSON.stringify(data.agent.usage)}`] : []] : [], text].map(sanitizeText),
});
export const listRenderers = toolRenderers<{ agentId?: string; state?: string; scope?: string }, { agents: Summary[]; nextCursor?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agents', summary: args.agentId ? agentDisplayName(args.agentId) : undefined }),
  collapsed: (data, args) => ({ icon: '', title: 'Agents', summary: `${data.agents.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: (data, _args, _text, theme) => [...data.agents.map(agent => `${stateLine(agent.state).icon} ${sanitizeText(agent.name)} · ${agent.state}${agent.error ? ` · ${sanitizeText(agent.error)}` : ''} · ${theme.fg('dim', `${agent.id} · ${agent.runId}`)}`), ...data.nextCursor ? ['More agents · next page available'] : []],
});
export const getRenderers = toolRenderers<Args, Details>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: data => ({ ...stateLine(data.question ? 'waiting' : data.agent.state), title: data.agent.name,
    summary: data.question ? 'question pending' : data.agent.state }),
  expanded: (data, _args, text) => [data.agent.name, text].map(sanitizeText),
});
export const readRenderers = toolRenderers<Args & { stream?: string }, Details & { stream: string; offset: number; nextOffset: number; totalBytes: number }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent read', summary: agentDisplayName(args.id, args.runId), meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: `read · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B` }),
  expanded: (data, _args, text) => [data.agent.name, text].map(sanitizeText),
});
export const sendRenderers = toolRenderers<Args & { message: string }, Details & { action: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent send', summary: agentDisplayName(args.id) }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: data.action }),
  expanded: (data, args, text) => [data.agent.name, `message: ${args.message}`, text].map(sanitizeText),
});
export const stopRenderers = toolRenderers<Args, StopOutcome & { name?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent stop', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: (data, args) => ({ ...stateLine(data.state), title: data.name ?? agentDisplayName(args.id, args.runId), summary: `${data.state} · cleanup ${data.cleanup}`,
    meta: data.affected.length > 1 ? [`+${data.affected.length - 1} affected`] : [] }),
  expanded: (data, args, text) => [data.name ?? agentDisplayName(args.id, args.runId), text].map(sanitizeText),
});
