import type { AgentRecord } from './types.ts';

/** Runtime statistics are run-scoped; current type configuration cannot rewrite history. */
export function agentDetails(record: AgentRecord): string {
  const context = record.contextUsage;
  return [record.name, `Type: ${record.type}`, `ID: ${record.id}`, `Run: ${record.runId}`, `State: ${record.state}`,
    `Model: ${record.model} (${record.modelSource})`, `Thinking: ${record.thinking} (${record.thinkingSource})`,
    `Context: ${context ? `${context.tokens ?? 'unknown'} / ${context.contextWindow} tokens${context.percent === null ? '' : ` (${context.percent.toFixed(1)}%)`}` : 'unavailable'}`,
    `Tool calls: ${record.toolUses ?? (record.state === 'queued' || record.state === 'starting' ? 0 : 'unavailable')}`,
    `Runtime: ${record.elapsedMs === undefined ? 'not started' : `${(record.elapsedMs / 1000).toFixed(1)}s`}`,
    ...(record.state === 'queued' ? [`Queued: ${Math.max(0, Date.now() - Date.parse(record.createdAt)) / 1000}s`] : []),
    `Created: ${record.createdAt}`, ...record.startedAt ? [`Started: ${record.startedAt}`] : [],
    ...record.endedAt ? [`Ended: ${record.endedAt}`] : [], `Cwd: ${record.cwd}`, '', record.prompt,
    ...record.error ? ['', `Error: ${record.error}`] : []].join('\n');
}
