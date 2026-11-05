// Pi custom entries and resume references adapted from pi-subagents agent-record-entry.ts (MIT).
import { readFileSync } from 'node:fs';
import { CURRENT_SESSION_VERSION, parseSessionEntries, SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { objectId } from '../runtime/tools.ts';
import { active, type AgentRecord, type Execution } from './types.ts';

export const AGENT_ENTRY = 'pi-suite:agent-record';
const string = Type.String();
const agentId = objectId('agent', 'agent_3fa1c2d0'), runId = objectId('run', 'run_3fa1c2d0');
const recordSchema = Type.Object({
  version: Type.Literal(1), id: agentId, runId, type: string, name: string, prompt: string, cwd: string,
  ownerSessionId: string, anchorEntryId: Type.Union([string, Type.Null()]), ancestors: Type.Array(runId),
  background: Type.Boolean(), persisted: Type.Boolean(), createdAt: string,
  state: Type.Union(['queued', 'starting', 'running', 'waiting', 'stopping', 'completed', 'failed', 'stopped', 'limited'].map(state => Type.Literal(state))),
  model: string, modelSource: string, thinking: string, thinkingSource: string,
  configCwd: Type.Optional(string), parentAgentId: Type.Optional(agentId), parentRunId: Type.Optional(runId),
  sessionFile: Type.Optional(string), endLeafId: Type.Optional(Type.Union([string, Type.Null()])),
  usage: Type.Optional(Type.Object({tokens: Type.Object(Object.fromEntries(
    ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].map(key => [key, Type.Number()]))), cost: Type.Number()})),
  result: Type.Optional(string), error: Type.Optional(string), individual: Type.Optional(Type.Object({model: Type.Optional(string), thinking: Type.Optional(string)})),
}, {additionalProperties: true});
/** Validate saved suite data once, before it can enter Manager or workflow history. */
export function decodeAgentRecord(value: unknown, source = 'session entry'): AgentRecord {
  if (!Value.Check(recordSchema, value)) throw new ToolError('AGENT_HISTORY', `Invalid agent record version or data in ${source}`);
  return value as AgentRecord;
}
/** Pi's disk open can repair files. Its in-memory tree migrates and reads without writes. */
export function readAgentSession(path: string): SessionManager {
  const content = readFileSync(path, 'utf8'), entries = parseSessionEntries(content), header = entries[0];
  // Pi's parser skips malformed lines. Saved suite history must report corruption rather
  // than silently presenting an earlier result; migration/tree construction still use Pi.
  if (entries.length !== content.split('\n').reduce((count, line) => count + (line.trim() ? 1 : 0), 0)) {
    throw new ToolError('AGENT_HISTORY', `Malformed session JSONL in ${path}`);
  }
  if (!header || header.type !== 'session' || typeof header.id !== 'string' || typeof header.cwd !== 'string'
    || header.version !== undefined && (!Number.isInteger(header.version) || header.version < 1 || header.version > CURRENT_SESSION_VERSION)) {
    throw new ToolError('AGENT_HISTORY', `Invalid or unsupported session header in ${path}`);
  }
  return SessionManager.inMemory(header.cwd, undefined, entries);
}
export function recordsIn(entries: readonly SessionEntry[]): AgentRecord[] {
  const runs = new Map<string, AgentRecord>();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === AGENT_ENTRY) {
    const record = decodeAgentRecord(entry.data);
    runs.set(record.runId, record);
  }
  return [...runs.values()];
}
/** A detached parent's startup entry still points to the child's durable final run entry. */
export function hydrate(record: AgentRecord): AgentRecord {
  if (!record.sessionFile) return active(record.state) ? {...record, state: 'failed',
    error: 'Execution is no longer owned by this Pi process; no transcript was saved'} : record;
  if (!active(record.state) && record.result !== undefined) return record;
  const manager = readAgentSession(record.sessionFile);
  const saved = recordsIn(manager.getEntries()).find(run => run.runId === record.runId) ?? record;
  return active(saved.state) ? { ...saved, state: 'failed', endLeafId: manager.getLeafId(),
    error: 'Execution is no longer owned by this Pi process; the saved transcript is available' } : saved;
}
export function transcript(record: AgentRecord, run?: Execution): SessionEntry[] {
  if (run?.session) return [...run.session.sessionManager.getBranch(record.endLeafId ?? undefined), ...run.streamingEntry ? [run.streamingEntry] : [], ...run.liveResults?.values() ?? []];
  if (run?.entries) return run.entries;
  if (!record.sessionFile) throw new ToolError('HISTORY_UNAVAILABLE', `${record.id} has no saved transcript outside its live process`, record.id);
  const manager = readAgentSession(record.sessionFile);
  if (record.endLeafId && !manager.getEntry(record.endLeafId)) throw new ToolError('AGENT_HISTORY', `Missing history leaf ${record.endLeafId} in ${record.sessionFile}`, record.id);
  return manager.getBranch(record.endLeafId ?? undefined);
}
export function resultText(entries: SessionEntry[]): string {
  for (const entry of [...entries].reverse()) if (entry.type === 'message' && entry.message.role === 'assistant') {
    const text = entry.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (text) return text;
  }
  return '';
}
/** Model-facing serialization keeps complete messages so offsets before the streaming tail stay stable. */
export function transcriptText(entries: SessionEntry[]): string {
  return entries.flatMap(entry => {
    if (entry.type !== 'message') return [];
    const message = entry.message;
    if (message.role === 'user') return [`[user]\n${typeof message.content === 'string' ? message.content : message.content.map(block => block.type === 'text' ? block.text : '[image]').join('\n')}`];
    if (message.role === 'assistant') return message.content.map(block => block.type === 'text' ? `[assistant]\n${block.text}`
      : block.type === 'thinking' ? `[thinking]\n${block.thinking}` : `[tool ${block.name} ${block.id}]\n${JSON.stringify(block.arguments)}`);
    if (message.role === 'toolResult') return [`[result ${message.toolName} ${message.toolCallId}${message.isError ? ' error' : ''}]\n${message.content.map(block => block.type === 'text' ? block.text : '[image]').join('\n')}`];
    return [];
  }).join('\n\n');
}
