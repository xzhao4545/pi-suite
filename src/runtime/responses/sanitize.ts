import { randomUUID } from 'node:crypto';
import { projectContextEntry, type ContextEditEntry, type SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { encodeTextSignatureV1, isResponsesApi, parseTextSignature, parseResponsesToolCallId } from '@earendil-works/pi-ai/api/responses-signatures';
import { GOAL_ENTRY, pausedGoalCopy } from '../../goal/state.ts';

type CleanupReport = { hadPrivateState: boolean };

const localId = (prefix: string) => `${prefix}_pi_${randomUUID().replaceAll('-', '')}`;

/** Only protocol fields are changed: business data and non-Responses signatures are opaque. */
function cleanAssistant(message: AssistantMessage, calls: Map<string, string>, report: CleanupReport): AssistantMessage {
  if (!isResponsesApi(message.api)) return message;
  if (message.deferred) throw new Error('Cannot fork an unfinished provider-deferred response; resolve it in the source session first.');
  const clean = { ...message };
  report.hadPrivateState ||= Boolean(clean.responseId);
  delete clean.responseId;
  clean.content = message.content.flatMap<AssistantMessage['content'][number]>(block => {
    if (block.type === 'thinking') {
      report.hadPrivateState ||= Boolean(block.thinkingSignature || block.redacted);
      if (block.thinkingSignature) {
        let item: { type?: string };
        try { item = JSON.parse(block.thinkingSignature); }
        catch { throw new Error('Cannot safely migrate an unrecognized Responses reasoning signature. Source history is unchanged.'); }
        if (item?.type !== 'reasoning') throw new Error('Cannot migrate opaque Responses compaction without readable context. Source history is unchanged.');
      }
      // Keep locally readable thinking in its original role, never turn it into assistant text.
      return block.redacted || !block.thinking ? [] : [{ type: 'thinking' as const, thinking: block.thinking }];
    }
    if (block.type === 'text') {
      report.hadPrivateState ||= Boolean(block.textSignature);
      const phase = parseTextSignature(block.textSignature)?.phase;
      return [{ type: 'text' as const, text: block.text, ...(phase ? { textSignature: encodeTextSignatureV1(localId('msg'), phase) } : {}) }];
    }
    const call = { ...block, id: calls.get(block.id) ?? block.id };
    report.hadPrivateState ||= Boolean(block.thoughtSignature || call.id !== block.id);
    delete call.thoughtSignature;
    return [call];
  });
  return clean;
}

/** Materialize edits on a detached selected branch; raw navigable history is also clean. */
export function cleanBranch(entries: SessionEntry[], report: CleanupReport = { hadPrivateState: false }): SessionEntry[] {
  const edits = new Map<string, ContextEditEntry>();
  for (const entry of entries) if (entry.type === 'context_edit') edits.set(entry.targetId, entry);
  const materialized = entries.flatMap<SessionEntry>(entry => {
    if (entry.type === 'context_edit') return [];
    if (entry.type !== 'message' && entry.type !== 'custom_message') return [entry];
    const edit = edits.get(entry.id);
    if (!edit) return [entry];
    const message = projectContextEntry(entry, edit)[0];
    if (!message) return [];
    return [entry.type === 'message' ? { ...entry, message }
      : { ...entry, content: (message as { content: typeof entry.content }).content }];
  });
  const calls = new Map<string, string>(), used = new Set<string>();
  for (const entry of materialized) if (entry.type === 'message' && entry.message.role === 'assistant') {
    for (const block of entry.message.content) if (block.type === 'toolCall' && !isResponsesApi(entry.message.api)) used.add(block.id);
  }
  // An edit can remove a call but retain its real result. Keep source provenance to strip
  // the result's item identity without guessing that every provider's pipe-containing id is Responses.
  for (const entry of [...materialized, ...entries]) if (entry.type === 'message' && entry.message.role === 'assistant' && isResponsesApi(entry.message.api)) {
    for (const block of entry.message.content) if (block.type === 'toolCall' && !calls.has(block.id)) {
      const { callId: base } = parseResponsesToolCallId(block.id);
      const id = used.has(base) ? localId('call') : base;
      calls.set(block.id, id); used.add(id);
    }
  }
  // Removed edits/omissions map forward, so a retained range never expands backwards.
  const kept = new Set(materialized.map(entry => entry.id)), references = new Map<string, string>();
  let next: string | undefined;
  for (const entry of entries.toReversed()) {
    if (kept.has(entry.id)) next = entry.id;
    if (next) references.set(entry.id, next);
  }
  let parentId: string | null = null;
  return materialized.map(original => {
    let entry = { ...original, parentId };
    if (entry.type === 'message') {
      const message = entry.message;
      if (message.role === 'toolResult') report.hadPrivateState ||= Boolean(calls.has(message.toolCallId) && calls.get(message.toolCallId) !== message.toolCallId);
      entry = { ...entry, message: message.role === 'assistant' ? cleanAssistant(message, calls, report)
        : message.role === 'toolResult' ? { ...message, toolCallId: calls.get(message.toolCallId) ?? message.toolCallId } : message };
    } else if (entry.type === 'compaction') {
      entry = { ...entry, firstKeptEntryId: references.get(entry.firstKeptEntryId) ?? entry.id };
    } else if (entry.type === 'branch_summary') {
      // An abandoned sibling is not copied; its source remains provenance, not a dangling tree id.
      entry = { ...entry, fromId: references.get(entry.fromId) ?? 'root' };
    } else if (entry.type === 'custom' && entry.customType === GOAL_ENTRY) {
      entry = { ...entry, data: pausedGoalCopy(entry.data) };
    }
    parentId = entry.id;
    return entry;
  });
}
