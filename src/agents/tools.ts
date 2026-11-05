import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SuiteConfig } from '../runtime/config.ts';
import { ToolError } from '../runtime/errors.ts';
import { readBounded, textSource } from '../runtime/read.ts';
import { sanitizeText } from '../runtime/text.ts';
import { LIST_LIMITS, listFields, objectId, paginate, readFields, rejectContextWithoutSearch, rejectListWithId, textResult as text } from '../runtime/tools.ts';
import type { WaitRegistry } from '../runtime/wait.ts';
import { taskId } from '../tasks/types.ts';
import { thinkingSchema } from './catalog.ts';
import { AgentsModule, agentSummary, summaryLine } from './index.ts';
import { active, executing } from './types.ts';
import { transcript, transcriptText } from './records.ts';
import type { AgentScheduler } from './schedules/index.ts';

const id = objectId('agent', 'agent_3fa1c2d0'), runId = objectId('run', 'run_3fa1c2d0');
export function registerAgentTools(pi: ExtensionAPI, agents: AgentsModule, waits: WaitRegistry, config: () => SuiteConfig, scheduler?: AgentScheduler) {
  let scheduling = Boolean(scheduler && config().agents.scheduling);
  const startFields = { prompt: Type.String({ minLength: 1 }), type: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ maxLength: 80 })), background: Type.Optional(Type.Boolean()),
    model: Type.Optional(Type.String({ minLength: 1 })), thinking: Type.Optional(thinkingSchema),
    maxTurns: Type.Optional(Type.Integer({ minimum: 0 })), taskId: Type.Optional(taskId),
    inheritContext: Type.Optional(Type.Boolean()), isolated: Type.Optional(Type.Boolean()), schedule: Type.Optional(Type.String({ minLength: 1 })) };
  const buildStartSchema = () => {
    const fields = { ...startFields };
    if (!scheduling) Reflect.deleteProperty(fields, 'schedule');
    return Type.Object(fields, { additionalProperties: false });
  };
  const startSchema = buildStartSchema();
  const description = 'Start a same-process Pi child session. background=true (default) returns an ID immediately; false waits and returns early on any direct child question. ' +
    'Types: general-purpose, Explore, Plan or a configured agent markdown file. Read with agent_read, answer/steer/resume with agent_send, stop its subtree with agent_stop, wait with wait.';
  const scheduleDescription = ' schedule registers a future job instead of starting now: six-field cron, interval 5m/1h, or one-shot +10m/ISO. Do not combine with background:false or inheritContext. Manage via /agents schedules.';
  const startTool: ToolDefinition<typeof startSchema> = { name: 'agent_start', label: 'Start agent',
    description: description + (scheduling ? scheduleDescription : ''),
    parameters: startSchema,
    async execute(_id, params, signal, _update, ctx) {
      if (signal?.aborted) throw signal.reason;
      const { schedule, ...request } = params;
      if (schedule !== undefined) {
        if (!scheduler || !config().agents.scheduling) throw new ToolError('INVALID_ARGS', 'Scheduling is disabled');
        const job = await scheduler.add(request, schedule, ctx, signal);
        return text([`${job.id} ${job.scheduleType} · ${job.name}`, `next: ${job.nextRun}`, 'manage: /agents schedules'], { schedule: job });
      }
      const run = await agents.manager.start(request, agents.scope(ctx), config());
      // A mention clone has no real parent tool-call ID. Its transient result cannot
      // consume the child's answer, even when frontmatter selects a foreground run.
      if (!_id) { run.notifyResult = true; agents.manager.changed(); }
      if (run.record.background || !_id) return text([summaryLine(agents.manager.view(run)), `read: agent_read({"id":"${run.record.id}"})`], { agent: agentSummary(agents.manager.view(run)) });
      // Esc cancels only the active foreground call. Returning for a question removes this
      // listener, so answering the parent later can continue the same child in the background.
      const abort = () => { void agents.manager.stop(run.record.id, run.record.runId); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) { await agents.manager.stop(run.record.id, run.record.runId); throw signal.reason; }
        let waiting;
        do { waiting = await waits.wait([run.record.id], 'all', 3600000, signal); }
        while ((waiting.reason === 'other' || waiting.reason === 'event') && active(run.record.state));
        const record = agents.manager.view(run);
        if (!active(record.state)) agents.consume({ ...agents.settlement(record.id), runId: record.runId });
        else { run.notifyResult = true; agents.manager.changed(); }
        return text([summaryLine(record), record.result?.slice(0, 500), record.error, ...waiting.others.map(item => item.summary),
          waiting.results.find(item => item.question)?.summary, `read: agent_read({"id":"${record.id}"})`], { agent: agentSummary(record), wait: waiting });
      } finally { signal?.removeEventListener('abort', abort); }
    } };
  pi.registerTool(startTool);
  pi.registerTool({ name: 'agent_list', label: 'List agents',
    description: 'List child summaries, or give id for progress, model sources and runs. state=active (default), queued, finished or all. session scope shows direct children; workspace scope includes all loaded owner records.',
    parameters: Type.Object({ id: Type.Optional(id), ...listFields(['active', 'queued', 'finished', 'all'] as const) }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      rejectListWithId(params);
      if (params.id) {
        const { record, run } = agents.manager.get(params.id);
        const runs = agents.manager.records().filter(item => item.id === record.id).map(agentSummary);
        return text([summaryLine(record), `model: ${record.model} (${record.modelSource}) · thinking: ${record.thinking} (${record.thinkingSource})`,
          record.error, run?.question ? agents.settlement(record.id).summary : undefined,
          `read: agent_read({"id":"${record.id}"})`], { agent: agentSummary(record), runs, question: run?.question?.params, waitingFor: run?.question ? 'parent' : undefined });
      }
      const scope = agents.scope(ctx), state: string = params.state ?? 'active';
      const rows = agents.manager.records().filter(record => record.cwd === ctx.cwd && (params.scope === 'workspace' || agents.manager.visible(record, scope)))
        .filter(record => state === 'all' || state === 'active' && executing(record.state) || state === 'queued' && record.state === 'queued' || state === 'finished' && !active(record.state));
      const { page, nextCursor } = paginate(rows, record => ({ createdAt: record.createdAt, id: record.runId }), params.cursor, params.limit ?? LIST_LIMITS.defaultLimit);
      return text([`${page.length} ${state} agents (${params.scope ?? 'session'})`, ...page.map(summaryLine),
        nextCursor ? `more: agent_list({"state":"${state}","cursor":"${nextCursor}"})` : undefined], { agents: page.map(agentSummary), nextCursor });
    } });
  pi.registerTool({ name: 'agent_read', label: 'Read agent',
    description: 'Read result (default when settled) or transcript (default while active). runId selects a previous execution of the same agent. Byte paging and regex search follow job_read; reading never resumes a model.',
    parameters: Type.Object({ id, runId: Type.Optional(runId), stream: Type.Optional(Type.Union([Type.Literal('result'), Type.Literal('transcript')])), ...readFields }, { additionalProperties: false }),
    async execute(_id, params) {
      rejectContextWithoutSearch(params);
      const { record, run } = agents.manager.get(params.id, params.runId), stream = params.stream ?? (active(record.state) ? 'transcript' : 'result');
      const output = stream === 'transcript' ? transcriptText(transcript(record, run)) : [record.error, record.result].filter(Boolean).join('\n');
      const page = await readBounded(textSource(output), params, sanitizeText);
      if (!active(record.state)) agents.consume({ id: record.id, runId: record.runId, state: record.state, summary: summaryLine(record), settled: true });
      return text([`${summaryLine(record)} · ${stream} bytes ${page.offset}-${page.nextOffset} of ${page.totalBytes}`, page.text,
        page.endOfStream ? undefined : `more: agent_read({"id":"${record.id}","runId":"${record.runId}","stream":"${stream}","offset":${page.nextOffset}})`], { ...page, stream, agent: agentSummary(record) });
    } });
  pi.registerTool({ name: 'agent_send', label: 'Send to agent',
    description: 'Answer a waiting child, steer an active child, queue during creation or resume a settled session as a new run. Answers match option IDs/titles or use freeform; batch answers are a JSON array of strings. Only the direct parent may send.',
    parameters: Type.Object({ id, message: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = await agents.manager.send(params.id, params.message, agents.scope(ctx), config());
      return text([summaryLine(agents.manager.view(result.run)), `action: ${result.action}`], { agent: agentSummary(agents.manager.view(result.run)), action: result.action });
    } });
  pi.registerTool({ name: 'agent_stop', label: 'Stop agent',
    description: 'Stop the child, its nested sessions and every job they created. Without runId includes jobs left by earlier runs; runId limits the subtree. Join repeated stops, await real abort/cleanup and retain transcript.',
    parameters: Type.Object({ id, runId: Type.Optional(runId) }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      const { record } = agents.manager.get(params.id, params.runId);
      if (record.cwd !== ctx.cwd) throw new ToolError('NOT_FOUND', `No workspace agent ${params.id}`);
      const scope = agents.scope(ctx);
      if (scope.run && !agents.manager.visible(record, scope)) throw new ToolError('NOT_OWNER', `${params.id} is not a direct child of this run`);
      const outcome = await agents.manager.stop(params.id, params.runId);
      return text([`${params.id} ${outcome.state} · cleanup ${outcome.cleanup}`, ...outcome.affected.map(item => `${item.id} ${item.state}${item.cleanup ? ` · ${item.cleanup}` : ''}`)], outcome);
    } });
  return Object.assign(startTool, { refreshSchema() {
    const next = Boolean(scheduler && config().agents.scheduling);
    if (next === scheduling) return;
    scheduling = next; startTool.parameters = buildStartSchema();
    startTool.description = description + (scheduling ? scheduleDescription : '');
    // Late registration updates Pi's single tool registry after a new project's config loads.
    pi.registerTool(startTool);
  } });
}
