import type { AgentRecord } from './types.ts';
import { field, outputRow, part, section, statePart, type StructuredDetails } from '../ui/structured-details.ts';
import { countText, elapsedText } from '../ui/format.ts';

/** Runtime statistics are run-scoped; current type configuration cannot rewrite history. */
export function agentDetails(record: AgentRecord, permissions?: {readonly: boolean; canMessage: boolean; canStop: boolean}, readOnlyBanner = false): StructuredDetails {
  const context = record.contextUsage;
  const tokens = record.usage?.tokens;
  // Pi tracks uncached input, cache reads and cache writes as separate prompt token counts.
  const promptTokens = tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : 0;
  return {rows: [
    readOnlyBanner ? [part('Read only', 'meta')] : undefined,
    [part(record.name, 'heading')], field('Type:', record.type), field('ID:', part(record.id, 'id')),
    field('State:', statePart(record.state)), null,
    field('Model:', `${record.model} · ${record.thinking}`), null,
    ...(permissions ? [field('Read only:', permissions.readonly), field('Can message:', permissions.canMessage), field('Can stop:', permissions.canStop)] : []),
    record.parentRunId ? field('Parent run:', part(record.parentRunId, 'id')) : undefined, null,
    tokens ? field('Tokens:', part(`input ${countText(tokens.input)} · output ${countText(tokens.output)} · cache read ${countText(tokens.cacheRead)} · cache write ${countText(tokens.cacheWrite)} · total ${countText(tokens.total)}`, 'number')) : undefined,
    tokens ? field('Cache hit rate:', promptTokens > 0 ? part(`${(tokens.cacheRead / promptTokens * 100).toFixed(1)}%`, 'number') : 'unavailable') : undefined,
    record.usage ? field('Cost:', part(`$${record.usage.cost.toFixed(6)}`, 'number')) : undefined,
    field('Context:', context ? part(`${context.tokens ?? 'unknown'} / ${context.contextWindow} tokens${context.percent === null ? '' : ` (${context.percent.toFixed(1)}%)`}`, 'number') : 'unavailable'),
    field('Tool calls:', part(record.toolUses ?? (record.state === 'queued' || record.state === 'starting' ? 0 : 'unavailable'), 'number')), null,
    field('Runtime:', record.elapsedMs === undefined ? 'not started' : part(elapsedText(record.elapsedMs), 'number')),
    record.state === 'queued' ? field('Queued:', part(`${Math.max(0, Date.now() - Date.parse(record.createdAt)) / 1000}s`, 'number')) : undefined,
    field('Created:', part(record.createdAt, 'meta')),
    record.startedAt ? field('Started:', part(record.startedAt, 'meta')) : undefined,
    ...(record.taskId || record.workflowId ? [null,
      record.taskId ? field('Task:', part(record.taskId, 'id'), part(' · source generation: ', 'label'), part(record.taskGeneration ?? 'unavailable (assignment expired)', 'id')) : undefined,
      record.workflowId ? field('Workflow:', part(record.workflowId, 'id')) : undefined, null,
    ] : []),
    record.endedAt ? field('Ended:', part(record.endedAt, 'meta')) : undefined,
    // Prompt and result are free text; titled sections keep them apart from the fields above.
    section('Input'), record.prompt,
    ...(record.result !== undefined || record.error ? [section('Output'),
      record.error ? field('Error:', part(record.error, 'error')) : undefined,
      record.result === undefined ? undefined : outputRow(record.result, {markdown: true})] : []),
  ]};
}
