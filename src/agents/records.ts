// Pi custom entries and resume references adapted from pi-subagents agent-record-entry.ts (MIT).
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { ToolError } from '../runtime/errors.ts';
import { active, type AgentRecord, type Execution } from './types.ts';

export const AGENT_ENTRY = 'pi-suite:agent-record';
export function recordsIn(entries: readonly SessionEntry[]): AgentRecord[] {
  const runs = new Map<string, AgentRecord>();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === AGENT_ENTRY) {
    const record = entry.data as AgentRecord;
    if (record.version !== 1) throw new ToolError('AGENT_HISTORY', `Unsupported agent record version: ${record.version}`);
    runs.set(record.runId, record);
  }
  return [...runs.values()];
}
/** A detached parent's startup entry still points to the child's durable final run entry. */
export function hydrate(record: AgentRecord): AgentRecord {
  if ((!active(record.state) && record.result !== undefined) || !record.sessionFile) return record;
  const saved = recordsIn(SessionManager.open(record.sessionFile).getEntries()).find(run => run.runId === record.runId);
  return saved ?? { ...record, state: 'failed', error: 'Execution is no longer owned by this Pi process; the saved transcript is available' };
}
export function transcript(record: AgentRecord, run?: Execution): SessionEntry[] {
  if (run?.session) return [...run.session.sessionManager.getBranch(record.endLeafId ?? undefined), ...run.streamingEntry ? [run.streamingEntry] : [], ...run.liveResults?.values() ?? []];
  if (run?.entries) return run.entries;
  if (!record.sessionFile) throw new ToolError('HISTORY_UNAVAILABLE', `${record.id} has no saved transcript outside its live process`, record.id);
  const manager = SessionManager.open(record.sessionFile);
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
