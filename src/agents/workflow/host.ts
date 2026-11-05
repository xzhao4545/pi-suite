// Adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/host.ts (MIT).
// Manager records are authoritative; gates share the public JobManager lifecycle.
import type { SuiteConfig } from '../../runtime/config.ts';
import { ToolError } from '../../runtime/errors.ts';
import type { JobManager } from '../../jobs/manager.ts';
import { readJobLog } from '../../jobs/query.ts';
import { resolvePiShell } from '../../jobs/terminal/shell.ts';
import type { AgentManager } from '../manager.ts';
import { captureParent } from '../parent.ts';
import type { AgentRecord, Execution, ParentScope, Thinking } from '../types.ts';
import { resolveWorkflowSource } from './saved.ts';
import type { WorkflowHost, WorkflowSpawnRequest, WorkflowSpawnResult } from './runtime/index.ts';

export const DEFAULT_GATE_TIMEOUT_MS = 10 * 60_000;
function toSpawnResult(record: AgentRecord): WorkflowSpawnResult {
  const common = {tokens: record.usage?.tokens.total ?? 0, outputTokens: record.usage?.tokens.output ?? 0,
    toolCalls: record.toolUses ?? 0, structuredRetried: record.structuredRetried};
  if (record.state === 'completed') return {...common, ok: true, text: record.structuredJson ?? record.result ?? ''};
  return {...common, ok: false, skipped: record.state === 'stopped', error: record.error ?? `Agent ${record.state}.`};
}
export function createWorkflowHost(deps: {
  scope: ParentScope; manager: AgentManager; jobs: () => JobManager; config: () => SuiteConfig;
  workflowId: string; signal: AbortSignal; gateTimeoutMs?: number;
}): WorkflowHost & {close(): Promise<void>} {
  const scope = captureParent(deps.scope), manager = deps.manager;
  const records = new Map<string, Execution>(), controllers = new Map<string, AbortController>();
  const executions = new Set<AgentRecord>(), pending = new Set<Promise<WorkflowSpawnResult>>();
  const retained = new Set<() => void>();
  const signalFor = (id: string) => {
    const controller = new AbortController(); controllers.set(id, controller);
    return AbortSignal.any([controller.signal, deps.signal]);
  };
  function report(run: Execution, callback: WorkflowSpawnRequest['onResolved']): void {
    const record = run.record;
    callback?.({recordId: record.id, modelName: run.session?.model?.name ?? run.model.name,
      modelId: record.model, thinking: record.thinking,
      requestedThinking: run.request.thinking !== undefined && run.request.thinking !== record.thinking ? run.request.thinking : undefined});
  }
  function track(work: () => Promise<WorkflowSpawnResult>): Promise<WorkflowSpawnResult> {
    // Startup rejection is this agent's business failure; callers see null with a visible error row.
    const operation = work().catch(error => ({ok: false, error: error instanceof Error ? error.message : String(error)}));
    pending.add(operation); void operation.then(() => pending.delete(operation)); return operation;
  }
  async function waitForRun(run: Execution, callback: WorkflowSpawnRequest['onResolved']): Promise<WorkflowSpawnResult> {
    executions.add(run.record);
    retained.add(manager.retain(run.record.runId));
    const off = manager.subscribeEvents((kind, current) => { if (kind === 'started' && current === run) report(run, callback); });
    try {
      if (run.session) report(run, callback);
      return toSpawnResult(await run.done.promise);
    } finally { off(); }
  }
  return {
    spawnAgent(request) {
      return track(async () => {
        const signal = signalFor(request.agentId);
        const run = await manager.start({prompt: request.prompt, type: request.agentType, name: request.label, background: true,
          model: request.model, thinking: request.effort as Thinking | undefined}, scope, deps.config(), undefined,
        {workflowId: deps.workflowId, signal, structuredOutput: request.schema,
          onSpawned: id => request.onResolved?.({recordId: id})});
        records.set(request.agentId, run);
        return waitForRun(run, request.onResolved);
      });
    },
    abortAgent(id) { controllers.get(id)?.abort(); },
    resumeAgent(id, prompt, onResolved) {
      return track(async () => {
        const prior = records.get(id);
        if (!prior) throw new ToolError('NOT_FOUND', `Cannot resume ${id}: it never started`);
        const run = await manager.resume(prior, prompt, signalFor(id), recordId => onResolved?.({recordId}));
        records.set(id, run); return waitForRun(run, onResolved);
      });
    },
    loadWorkflow(ref) {
      return resolveWorkflowSource(ref, scope.ctx.cwd, {trusted: scope.ctx.isProjectTrusted(), packageGate: deps.config().agents.packageWorkflows});
    },
    async runGate(command, options) {
      const jobs = deps.jobs(), signal = AbortSignal.any([deps.signal, controllers.get(options.agentId)!.signal]);
      const job = await jobs.start({command, name: `gate ${deps.workflowId}`, cwd: scope.ctx.cwd, mode: 'pipe', closeInput: true,
        timeoutMs: deps.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS, ...scope.owner!,
        creator: {workflowId: deps.workflowId, runId: deps.workflowId, ancestors: []}},
      resolvePiShell(scope.ctx.cwd, scope.ctx.isProjectTrusted()), signal);
      options.onStarted?.(job.id);
      // start's abort hook covers launch only. Keep the workflow signal attached through exit.
      const abort = () => { void jobs.stop(job.id, 'agent').catch(error => process.emitWarning(`Workflow gate stop failed: ${String(error)}`)); };
      signal.addEventListener('abort', abort, {once: true});
      try {
        if (signal.aborted) abort();
        const result = await jobs.wait(job.id);
        const [stdout, stderr] = await Promise.all(['stdout', 'stderr'].map(stream => readJobLog(jobs, result, stream as 'stdout' | 'stderr', {})));
        const output = [stdout.text.trim(), stderr.text.trim(), result.error].filter(Boolean).join('\n');
        jobs.markNotified(job.id);
        return {ok: result.state === 'completed' && result.exitCode === 0 && !signal.aborted,
          output: output || (result.state === 'completed' ? '' : `Gate ${result.state}: ${command}`)};
      } finally { signal.removeEventListener('abort', abort); }
    },
    async close() {
      for (const controller of controllers.values()) controller.abort();
      try {
        await Promise.all([...pending]);
        // Each stop joins its child even if job cleanup fails. Join every request before
        // publishing failure, and keep record identities for the owner's cleanup retry.
        const results = await Promise.allSettled([...executions].map(record => manager.stop(record.id, record.runId)));
        const gateJobs = await deps.jobs().stopCreatedBy([deps.workflowId]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, `Workflow child cleanup failed: ${failures.map(String).join('; ')}`);
        const outcomes = results.filter(result => result.status === 'fulfilled').map(result => result.value);
        if (outcomes.some(outcome => outcome.cleanup !== 'confirmed') || gateJobs.some(({job}) => ['pending', 'unconfirmed'].includes(job.cleanup.state))) {
          throw new Error('Workflow execution cleanup remains unconfirmed');
        }
        executions.clear();
      } finally {
        for (const release of retained) release();
        retained.clear(); records.clear(); controllers.clear();
      }
    },
  };
}
