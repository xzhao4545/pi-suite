import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SuiteConfig } from '../runtime/config.ts';
import { ToolError } from '../runtime/errors.ts';
import { readBounded, readContinuation, textSource } from '../runtime/read.ts';
import { sanitizeText } from '../runtime/text.ts';
import { checkedArguments, LIST_LIMITS, listFields, objectId, paginate, readFields, registerBoundTool, rejectContextWithoutSearch, textResult as text } from '../runtime/tools.ts';
import type { WaitRegistry } from '../runtime/wait.ts';
import { childId, generationSchema } from '../tasks/types.ts';
import { thinkingSchema } from './schema.ts';
import { questionText } from './questions.ts';
import { AgentsModule, agentSummary, summaryLine, usageText } from './index.ts';
import { active, executing, recordWorkspace } from './types.ts';
import { transcript, transcriptText } from './records.ts';
import type { AgentScheduler } from './schedules/index.ts';
import type { JobsModule } from '../jobs/index.ts';
import type { JobSummary } from '../jobs/types.ts';
import { isActive as jobActive } from '../jobs/state.ts';

import { startRenderers, listRenderers, getRenderers, readRenderers, sendRenderers, stopRenderers } from './render.ts';

const id = objectId('agent', 'agent_3fa1c2d0'), runId = objectId('run', 'run_3fa1c2d0');
const listSchema = Type.Object({ agentId: Type.Optional(id), ...listFields(['active', 'queued', 'finished', 'all'] as const) }, { additionalProperties: false });
const getSchema = Type.Object({ id, runId: Type.Optional(runId), detail: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
const queryHint = 'List history: agent_list({"agentId":"agent_3fa1c2d0","state":"all"}); one run: agent_get({"id":"agent_3fa1c2d0"}).';
export function registerAgentTools(pi: ExtensionAPI, agents: AgentsModule, waits: WaitRegistry, config: () => SuiteConfig, scheduler?: AgentScheduler, jobs?: Pick<JobsModule, 'createdBy'>) {
  let scheduling = Boolean(scheduler && config().agents.scheduling);
  const startFields = { prompt: Type.String({ minLength: 1 }), type: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ maxLength: 80 })), background: Type.Optional(Type.Boolean()),
    model: Type.Optional(Type.String({ minLength: 1 })), thinking: Type.Optional(thinkingSchema),
    maxTurns: Type.Optional(Type.Integer({ minimum: 0 })), taskId: Type.Optional(childId), taskGeneration: Type.Optional(generationSchema),
    inheritContext: Type.Optional(Type.Boolean()), isolated: Type.Optional(Type.Boolean()), schedule: Type.Optional(Type.String({ minLength: 1 })) };
  const buildStartSchema = () => {
    const fields = { ...startFields };
    if (!scheduling) Reflect.deleteProperty(fields, 'schedule');
    return Type.Object(fields, { additionalProperties: false });
  };
  const startSchema = buildStartSchema();
  const description = 'Start a same-process Pi child session. background=true (default) returns an ID immediately; false waits and returns early on any direct child question. ' +
    'Types: general-purpose, Explore, Plan or a configured agent markdown file. Read with agent_read, answer/steer/resume with agent_send, stop its subtree with agent_stop, wait with wait. taskId requires taskGeneration from the source task_list; expired assignments cannot be resumed or rebound to reused IDs.';
  const scheduleDescription = ' schedule registers a future job instead of starting now: six-field cron, interval 5m/1h, or one-shot +10m/ISO. Do not combine with background:false or inheritContext. Manage via /subagents schedules.';
  const startTool: ToolDefinition<typeof startSchema> = { name: 'agent_start', ...startRenderers, label: 'Start agent',
    description: description + (scheduling ? scheduleDescription : ''),
    parameters: startSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (signal?.aborted) throw signal.reason;
      const { schedule, ...request } = params;
      if (schedule !== undefined) {
        if (!scheduler || !config().agents.scheduling) throw new ToolError('INVALID_ARGS', 'Scheduling is disabled');
        const job = await scheduler.add(request, schedule, ctx, signal);
        return text([`${job.id} ${job.scheduleType} · next ${job.nextRun}`], { schedule: job });
      }
      const run = await agents.manager.start(request, agents.scope(ctx), config());
      // A mention clone has no real parent tool-call ID. Its transient result cannot
      // consume the child's answer, even when frontmatter selects a foreground run.
      if (!_id) { run.notifyResult = true; agents.manager.changed(); }
      if (run.record.background || !_id) return text([summaryLine(agents.manager.view(run)), run.record.error], { agent: agentSummary(agents.manager.view(run)) });
      // Esc cancels only the active foreground call. Returning for a question removes this
      // listener, so answering the parent later can continue the same child in the background.
      const abort = () => { if (!run.record.background) void agents.manager.stop(run.record.id, run.record.runId); };
      const waiter = new AbortController();
      run.foreground = Promise.withResolvers<undefined>();
      const waitSignal = signal ? AbortSignal.any([signal, waiter.signal]) : waiter.signal;
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) { await agents.manager.stop(run.record.id, run.record.runId); throw signal.reason; }
        let waiting;
        do {
          waiting = await Promise.race([waits.wait([run.record.id], 'all', 3600000, waitSignal), run.foreground.promise]);
          if (!waiting) return text([summaryLine(agents.manager.view(run)), 'Continuing in background; the result will be notified.',
            `read: agent_read({"id":"${run.record.id}"})`], { agent: agentSummary(agents.manager.view(run)), backgrounded: true });
        }
        while ((waiting.reason === 'other' || waiting.reason === 'event') && active(run.record.state));
        const record = agents.manager.view(run);
        if (!active(record.state)) agents.consume({ ...agents.settlement(record.id), runId: record.runId });
        else { run.notifyResult = true; agents.manager.changed(); }
        return text([...waiting.reason !== 'condition' ? [`wait: ${waiting.reason}${waiting.pending.length ? ` · pending ${waiting.pending.join(', ')}` : ''}`] : [],
          ...waiting.results.map(item => item.summary), ...waiting.others.map(item => item.summary)], { agent: agentSummary(record), wait: waiting });
      } finally {
        run.foreground = undefined;
        waiter.abort(new Error('Foreground caller released its wait'));
        signal?.removeEventListener('abort', abort);
      }
    } };
  registerBoundTool(pi, startTool, 'initial');
  registerBoundTool(pi, { name: 'agent_list', ...listRenderers, label: 'List agents',
    description: 'List child runs. state=active (default), queued, finished or all; session scope shows direct children, workspace discovers saved records. agentId filters history and combines with all list fields. One run uses agent_get({id,runId?}).',
    parameters: listSchema, prepareArguments: checkedArguments(listSchema, queryHint),
    async execute(_id, params, signal, _update, ctx) {
      const scope = agents.scope(ctx);
      if (params.scope === 'workspace') await agents.manager.discover(scope, config(), signal);
      const state = params.state ?? 'active';
      const rows = agents.manager.records().filter(record => recordWorkspace(record) === (scope.run?.configCwd ?? ctx.cwd)
        && (scope.run || record.workflowId === undefined) && (params.scope === 'workspace' || agents.manager.visible(record, scope)))
        .filter(record => (!params.agentId || record.id === params.agentId) && (state === 'all' || state === 'active' && executing(record.state)
          || state === 'queued' && record.state === 'queued' || state === 'finished' && !active(record.state)));
      const label = (record: typeof rows[number]) => `${summaryLine(record)}${agents.manager.runs.get(record.runId)?.question ? ' · waiting(parent)' : ''}${record.error ? ` · error: ${record.error}` : ''}${!agents.manager.visible(record, scope) ? ' · read-only' : ''}`;
      const { page, nextCursor } = paginate(rows, record => ({ createdAt: record.createdAt, id: record.runId }), params.cursor, params.limit ?? LIST_LIMITS.defaultLimit,
        { budgetBytes: LIST_LIMITS.defaultBytes - 512, size: record => Buffer.byteLength(label(record)) + 1 });
      return text([`${page.length} ${state} agents (${params.scope ?? 'session'})`, ...page.map(label),
        nextCursor ? `more: agent_list(${JSON.stringify({ ...params, cursor: nextCursor })})` : undefined], { agents: page.map(agentSummary), nextCursor });
    } }, 'initial');
  registerBoundTool(pi, { name: 'agent_get', ...getRenderers, label: 'Agent',
    description: 'Get current or specified run status, progress, model/thinking and task reference. detail:true adds configuration sources, usage and owned active jobs. Discover previous runIds with agent_list({agentId,state:"all"}); results/transcript use agent_read.',
    parameters: getSchema, prepareArguments: checkedArguments(getSchema, queryHint),
    async execute(_id, params, signal, _update, ctx) {
      const scope = agents.scope(ctx), { record, run } = await agents.manager.lookup(params.id, scope, config(), params.runId, signal);
      const lines = [summaryLine(record) + (!agents.manager.visible(record, scope) ? ' · read-only' : ''),
        `model: ${record.model} · thinking: ${record.thinking} · turns ${record.turns ?? 0} · tools ${record.toolUses ?? 0}${record.taskId ? ` · task ${record.taskId} @ ${record.taskGeneration ?? 'unavailable (legacy link expired)'}` : ''}`,
        record.activity ? `activity: ${record.activity}` : undefined, record.error,
        run?.question ? questionText(run) : undefined];
      let created: JobSummary[] = [], jobsUnavailable: string | undefined;
      if (params.detail) {
        lines.push(`sources: model ${record.modelSource} · thinking ${record.thinkingSource}`, usageText(record),
          record.contextUsage ? `context: ${record.contextUsage.tokens ?? 'unknown'}/${record.contextUsage.contextWindow} tokens${record.contextUsage.percent === null ? '' : ` · ${record.contextUsage.percent.toFixed(1)}%`}` : undefined,
          record.lastUpdateAt ? `lastUpdateAt: ${record.lastUpdateAt}` : undefined);
        // Explicit runId scopes ownership to that execution; an agent-level detail
        // must also reveal jobs left by earlier executions of this same agent.
        const roots = params.runId ? [record.runId] : agents.manager.records().filter(item => item.id === record.id).map(item => item.runId);
        if (jobs) try { created = (await jobs.createdBy(roots)).filter(jobActive); }
        catch (error) { if (!(error instanceof ToolError) || error.code !== 'RUNTIME_UNAVAILABLE') throw error; jobsUnavailable = error.message; }
        else jobsUnavailable = 'Owned job query unavailable';
        lines.push(jobsUnavailable ? `jobs unavailable: ${jobsUnavailable}` : `jobs: ${created.length} active`,
          ...created.map(job => `${job.id} ${job.state} · cleanup ${job.cleanup.state}${job.cleanup.error ? ` · ${job.cleanup.error}` : ''}`));
      }
      return text(lines, { agent: agentSummary(record), jobs: created, jobsUnavailable, question: run?.question?.params,
        waitingFor: run?.question ? 'parent' : undefined });
    } }, 'initial');
  registerBoundTool(pi, { name: 'agent_read', ...readRenderers, label: 'Read agent',
    description: 'Read result (default when settled) or transcript (default while active). runId selects a previous execution of the same agent. Byte paging and regex search follow job_read; reading never resumes a model.',
    parameters: Type.Object({ id, runId: Type.Optional(runId), stream: Type.Optional(Type.Union([Type.Literal('result'), Type.Literal('transcript')])), ...readFields }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      rejectContextWithoutSearch(params);
      const { record, run } = await agents.manager.lookup(params.id, agents.scope(ctx), config(), params.runId, signal), stream = params.stream ?? (active(record.state) ? 'transcript' : 'result');
      const output = stream === 'transcript' ? transcriptText(transcript(record, run)) : [record.error, record.result].filter(Boolean).join('\n');
      const page = await readBounded(textSource(output), params, sanitizeText);
      if (!active(record.state)) agents.consume({ id: record.id, runId: record.runId, state: record.state, summary: summaryLine(record), settled: true });
      return text([`${summaryLine(record)} · ${stream} bytes ${page.offset}-${page.nextOffset} of ${page.totalBytes}`, page.text,
        page.truncated ? `full: agent_read(${JSON.stringify({ id: record.id, runId: record.runId, stream, ...readContinuation(params, 0) })})` : undefined,
        page.endOfStream ? undefined : `more: agent_read(${JSON.stringify({ id: record.id, runId: record.runId, stream, ...readContinuation(params, page.nextOffset) })})`], { ...page, stream, agent: agentSummary(record) });
    } }, 'initial');
  registerBoundTool(pi, { name: 'agent_send', ...sendRenderers, label: 'Send to agent',
    description: 'Answer a waiting child, steer an active child, queue during creation or resume a settled session as a new run. Answers match option IDs/titles or use freeform; batch answers are a JSON array of strings. Only the direct parent may send.',
    parameters: Type.Object({ id, message: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const scope = agents.scope(ctx);
      await agents.manager.lookup(params.id, scope, config(), undefined, signal);
      const result = await agents.manager.send(params.id, params.message, scope, config());
      return text([summaryLine(agents.manager.view(result.run)), `action: ${result.action}`], { agent: agentSummary(agents.manager.view(result.run)), action: result.action });
    } }, 'initial');
  registerBoundTool(pi, { name: 'agent_stop', ...stopRenderers, label: 'Stop agent',
    description: 'Stop the child, its nested sessions and every job they created. Without runId includes jobs left by earlier runs; runId limits the subtree. Join repeated stops, await real abort/cleanup and retain transcript.',
    parameters: Type.Object({ id, runId: Type.Optional(runId) }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const scope = agents.scope(ctx);
      const { record } = await agents.manager.lookup(params.id, scope, config(), params.runId, signal);
      if (scope.run && !agents.manager.visible(record, scope)) throw new ToolError('NOT_OWNER', `${params.id} is not a direct child of this run`);
      const outcome = await agents.manager.stop(params.id, params.runId);
      return text([`${params.id} ${outcome.state} · cleanup ${outcome.cleanup} · ${record.runId} · requested ${outcome.requested}`,
        ...outcome.affected.map(item => `${item.id} ${item.state}${item.cleanup ? ` · ${item.cleanup}` : ''}`)], { ...outcome, runId: record.runId, name: record.name });
    } }, 'initial');
  return Object.assign(startTool, { refreshSchema() {
    const next = Boolean(scheduler && config().agents.scheduling);
    if (next === scheduling) return;
    scheduling = next; startTool.parameters = buildStartSchema();
    startTool.description = description + (scheduling ? scheduleDescription : '');
    // Late registration updates Pi's single tool registry after a new project's config loads.
    registerBoundTool(pi, startTool);
  } });
}
