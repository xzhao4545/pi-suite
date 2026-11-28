import { truncateToWidth } from '@earendil-works/pi-tui';
import { toolRenderers, stateLine, type ToolExpandedRow } from '../ui/tool-render.ts';
import { readPageFields } from '../ui/rendering/read-page.ts';
import { agentDisplayName } from './registry.ts';
import type { ReadPage } from '../runtime/read.ts';
import type { StopOutcome } from '../runtime/tools.ts';
import type { JobSummary } from '../jobs/types.ts';
import type { ScheduledAgent } from './schedules/store.ts';
import type { AskParams } from '../ask/schema.ts';
import { usageText, type agentSummary } from './index.ts';

type Summary = ReturnType<typeof agentSummary>;
type Details = { agent: Summary; backgrounded?: boolean; question?: AskParams };
type Args = { id: string; runId?: string };
type StartArgs = { type?: string; name?: string; prompt: string; schedule?: string; background?: boolean };
function agentFields(agent: Summary): ToolExpandedRow[] {
  const usage = usageText(agent, '');
  return [
    { label: 'id', value: agent.id }, { label: 'runId', value: agent.runId },
    { label: 'state', value: agent.state, tone: stateLine(agent.state).tone },
    ...agent.model ? [{ label: 'model', value: agent.model }, { label: 'thinking', value: agent.thinking }] : [],
    ...agent.turns !== undefined ? [{ label: 'turns', value: String(agent.turns) }] : [],
    ...agent.toolUses !== undefined ? [{ label: 'toolUses', value: String(agent.toolUses) }] : [],
    ...agent.taskId ? [{ label: 'taskId', value: agent.taskId }] : [],
    ...agent.taskGeneration ? [{ label: 'taskGeneration', value: agent.taskGeneration }] : [],
    ...agent.activity ? [{ label: 'activity', value: agent.activity }] : [],
    ...usage !== undefined ? [{ label: 'usage', value: usage }] : [],
    ...agent.error ? [{ label: 'error', value: agent.error, tone: 'error' as const }] : [],
  ];
}
function scheduleFields({ request, ...schedule }: ScheduledAgent): ToolExpandedRow[] {
  return [...Object.entries(schedule), ...Object.entries(request).map(([key, value]) => [`request.${key}`, value] as const)]
    .flatMap(([key, value]) => value === undefined ? [] : [{ label: key.toLowerCase(), value: String(value) }]);
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
  expanded: data => 'agent' in data ? [...agentFields(data.agent),
    { label: 'promptSummary', value: data.agent.promptSummary },
    ...data.agent.resultSummary !== undefined ? [{ label: 'resultSummary', value: data.agent.resultSummary }] : []]
    : scheduleFields(data.schedule),
});
export const listRenderers = toolRenderers<{ agentId?: string; state?: string; scope?: string }, { agents: Summary[]; nextCursor?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agents', summary: args.agentId ? agentDisplayName(args.agentId) : undefined }),
  collapsed: (data, args) => ({ icon: '', title: 'Agents', summary: `${data.agents.length} ${args.state ?? 'active'} (${args.scope ?? 'session'})`, meta: data.nextCursor ? ['more'] : [] }),
  expanded: data => [...data.agents.flatMap(agent => [
    { ...stateLine(agent.state), title: agent.name, meta: [{ text: agent.state, tone: stateLine(agent.state).tone! }, `${agent.id} · ${agent.runId}`] },
    ...agent.error ? [{ label: 'error', value: agent.error, tone: 'error' as const }] : [],
  ]), ...data.nextCursor ? [{ label: 'more', value: 'next page available', tone: 'warning' as const }] : []],
});
export const getRenderers = toolRenderers<Args & { detail?: boolean }, Details & { jobs?: JobSummary[]; jobsUnavailable?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: data => ({ ...stateLine(data.question ? 'waiting(parent)' : data.agent.state), title: data.agent.name,
    meta: [{ text: data.question ? 'question pending' : data.agent.state, tone: stateLine(data.question ? 'waiting(parent)' : data.agent.state).tone! }] }),
  expanded: ({ agent, question, jobs, jobsUnavailable }, args) => [...agentFields(agent),
    ...question ? (question.questions ?? [question]).flatMap(item => [
      ...item.question !== undefined ? [{ label: 'question', value: item.question }] : [],
      ...item.options ? [{ label: 'options', value: item.options.map(option => typeof option === 'string' ? option : option.title).join(', ') }] : [],
    ]) : [],
    ...args.detail ? [
      { label: 'modelSource', value: agent.modelSource }, { label: 'thinkingSource', value: agent.thinkingSource },
      ...agent.contextUsage ? [{ label: 'contextUsage', value: `${agent.contextUsage.tokens ?? 'unknown'}/${agent.contextUsage.contextWindow} tokens${agent.contextUsage.percent === null ? '' : ` · ${agent.contextUsage.percent.toFixed(1)}%`}` }] : [],
      ...agent.lastUpdateAt ? [{ label: 'lastUpdateAt', value: agent.lastUpdateAt }] : [],
    ] : [],
    ...jobsUnavailable ? [{ label: 'jobsUnavailable', value: jobsUnavailable, tone: 'warning' as const }] : [],
    ...jobs?.length ? [{ label: 'jobs', value: jobs.map(job => [job.id, job.state, job.cleanup.state, job.cleanup.error].filter(Boolean).join(' · ')).join('\n') }] : []],
});
export const readRenderers = toolRenderers<Args & { stream?: string }, Details & ReadPage & { stream: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent read', summary: agentDisplayName(args.id, args.runId), meta: args.stream ? [args.stream] : [] }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: `read · ${data.stream} ${data.offset}–${data.nextOffset} / ${data.totalBytes} B` }),
  expanded: data => [...readPageFields(data), data.text], // Transcript and log text are literal, never Markdown or inferred code.
});
export const sendRenderers = toolRenderers<Args, Details & { action: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent send', summary: agentDisplayName(args.id) }),
  collapsed: data => ({ icon: '', title: data.agent.name, summary: data.action }),
  expanded: data => [{ label: 'action', value: data.action }, ...agentFields(data.agent)],
});
export const stopRenderers = toolRenderers<Args, StopOutcome & { runId: string; name?: string }>({
  call: args => ({ icon: '⟳', tone: 'accent', title: 'Agent stop', summary: agentDisplayName(args.id, args.runId) }),
  collapsed: (data, args) => ({ ...stateLine(data.state), title: data.name ?? agentDisplayName(args.id, args.runId),
    meta: [{ text: data.state, tone: stateLine(data.state).tone! }, { text: `cleanup ${data.cleanup}`,
      tone: ['pending', 'unconfirmed'].includes(data.cleanup) ? 'warning' : 'dim' },
      ...data.affected.length > 1 ? [`+${data.affected.length - 1} affected`] : []] }),
  expanded: data => [{ label: 'runId', value: data.runId }, { label: 'requested', value: String(data.requested) },
    { label: 'cleanup', value: data.cleanup, tone: ['pending', 'unconfirmed'].includes(data.cleanup) ? 'warning' : 'dim' },
    { label: 'affected', value: data.affected.map(item => `${item.id}: ${item.state}${item.cleanup ? ` (cleanup ${item.cleanup})` : ''}`).join('\n') }],
});
