import type { AgentRecord } from './types.ts';

/** Runtime statistics are run-scoped; current type configuration cannot rewrite history. */
export function agentDetails(record: AgentRecord, permissions?: {readonly: boolean; canMessage: boolean; canStop: boolean}): string {
  const context = record.contextUsage;
  return [record.name, `Type: ${record.type}`, `ID: ${record.id}`, `Run: ${record.runId}`, `State: ${record.state}`,
    `Model: ${record.model} (${record.modelSource})`, `Thinking: ${record.thinking} (${record.thinkingSource})`,
    ...permissions ? [`Read only: ${permissions.readonly}`, `Can message: ${permissions.canMessage}`, `Can stop: ${permissions.canStop}`] : [],
    `Owner session: ${record.ownerSessionId}`, ...record.parentRunId ? [`Parent run: ${record.parentRunId}`] : [],
    ...record.usage ? [`Tokens: input ${record.usage.tokens.input} · output ${record.usage.tokens.output} · cache read ${record.usage.tokens.cacheRead} · cache write ${record.usage.tokens.cacheWrite} · total ${record.usage.tokens.total}`, `Cost: $${record.usage.cost.toFixed(6)}`] : [],
    `Context: ${context ? `${context.tokens ?? 'unknown'} / ${context.contextWindow} tokens${context.percent === null ? '' : ` (${context.percent.toFixed(1)}%)`}` : 'unavailable'}`,
    `Tool calls: ${record.toolUses ?? (record.state === 'queued' || record.state === 'starting' ? 0 : 'unavailable')}`,
    `Runtime: ${record.elapsedMs === undefined ? 'not started' : `${(record.elapsedMs / 1000).toFixed(1)}s`}`,
    ...(record.state === 'queued' ? [`Queued: ${Math.max(0, Date.now() - Date.parse(record.createdAt)) / 1000}s`] : []),
    `Created: ${record.createdAt}`, ...record.startedAt ? [`Started: ${record.startedAt}`] : [],
    ...record.taskId ? [`Task: ${record.taskId}`] : [], ...record.workflowId ? [`Workflow: ${record.workflowId}`] : [],
    ...record.endedAt ? [`Ended: ${record.endedAt}`] : [], `Cwd: ${record.cwd}`, '', record.prompt,
    ...record.error ? ['', `Error: ${record.error}`] : []].join('\n');
}
