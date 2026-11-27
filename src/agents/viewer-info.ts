import type { AgentRecord } from './types.ts';
import { field, part, statePart, type StructuredDetails } from '../ui/structured-details.ts';

/** Runtime statistics are run-scoped; current type configuration cannot rewrite history. */
export function agentDetails(record: AgentRecord, permissions?: {readonly: boolean; canMessage: boolean; canStop: boolean}, readOnlyBanner = false): StructuredDetails {
  const context = record.contextUsage;
  const tokens = record.usage?.tokens;
  return {rows: [
    readOnlyBanner ? [part('Read only', 'meta')] : undefined,
    [part(record.name, 'heading')], field('Type:', record.type), field('ID:', part(record.id, 'id')),
    field('Run:', part(record.runId, 'id')), field('State:', statePart(record.state)), null,
    field('Model:', record.model, part(` (${record.modelSource})`, 'meta')),
    field('Thinking:', record.thinking, part(` (${record.thinkingSource})`, 'meta')), null,
    ...(permissions ? [field('Read only:', permissions.readonly), field('Can message:', permissions.canMessage), field('Can stop:', permissions.canStop)] : []),
    field('Owner session:', part(record.ownerSessionId, 'id')),
    record.parentRunId ? field('Parent run:', part(record.parentRunId, 'id')) : undefined, null,
    tokens ? field('Tokens:', part(`input ${tokens.input} · output ${tokens.output} · cache read ${tokens.cacheRead} · cache write ${tokens.cacheWrite} · total ${tokens.total}`, 'number')) : undefined,
    record.usage ? field('Cost:', part(`$${record.usage.cost.toFixed(6)}`, 'number')) : undefined,
    field('Context:', context ? part(`${context.tokens ?? 'unknown'} / ${context.contextWindow} tokens${context.percent === null ? '' : ` (${context.percent.toFixed(1)}%)`}`, 'number') : 'unavailable'),
    field('Tool calls:', part(record.toolUses ?? (record.state === 'queued' || record.state === 'starting' ? 0 : 'unavailable'), 'number')), null,
    field('Runtime:', record.elapsedMs === undefined ? 'not started' : part(`${(record.elapsedMs / 1000).toFixed(1)}s`, 'number')),
    record.state === 'queued' ? field('Queued:', part(`${Math.max(0, Date.now() - Date.parse(record.createdAt)) / 1000}s`, 'number')) : undefined,
    field('Created:', part(record.createdAt, 'meta')),
    record.startedAt ? field('Started:', part(record.startedAt, 'meta')) : undefined,
    ...(record.taskId || record.workflowId ? [null,
      record.taskId ? field('Task:', part(record.taskId, 'id'), part(' · source generation: ', 'label'), part(record.taskGeneration ?? 'unavailable (assignment expired)', 'id')) : undefined,
      record.workflowId ? field('Workflow:', part(record.workflowId, 'id')) : undefined, null,
    ] : []),
    record.endedAt ? field('Ended:', part(record.endedAt, 'meta')) : undefined,
    field('Cwd:', part(record.cwd, 'meta')), '', record.prompt,
    ...(record.error ? ['', field('Error:', part(record.error, 'error'))] : []),
  ]};
}
