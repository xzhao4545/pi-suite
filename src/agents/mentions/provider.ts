// Grammar, roster and additive autocomplete adapted from @tintinweb/pi-subagents
// 0.23.0 src/ui/agent-mention.ts (MIT). Saved run records are the history source.
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui';
import { active, type AgentRecord, type AgentType, type ParentScope } from '../types.ts';
import type { AgentManager } from '../manager.ts';
import { handleBase, isReservedHandle, MENTION_TRIGGER } from './grammar.ts';

export type MentionTarget =
  | { kind: 'record'; handle: string; record: AgentRecord; typeLabel: string }
  | { kind: 'type'; handle: string; type: string; description: string };

/** Dispatch and completion share this roster, so foreign branches never become targets. */
export function mentionRoster(manager: AgentManager, scope: ParentScope, types: AgentType[]): MentionTarget[] {
  const latest = new Map<string, AgentRecord>();
  for (const record of manager.records().filter(record => manager.visible(record, scope)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(record.id, record);
  const records = [...latest.values()].filter(record => record.handle)
    .sort((a, b) => Number(active(b.state)) - Number(active(a.state)) || b.createdAt.localeCompare(a.createdAt));
  const taken = new Set<string>(), targets: MentionTarget[] = [];
  for (const record of records) {
    const handle = record.alias ?? record.handle!;
    taken.add(handle.toLowerCase()); taken.add(record.handle!.toLowerCase());
    targets.push({ kind: 'record', handle, record, typeLabel: types.find(type => type.name === record.type)?.displayName ?? record.type });
  }
  for (const type of types) {
    const handle = handleBase(type.name);
    if (type.enabled === false || taken.has(handle) || isReservedHandle(handle)) continue;
    taken.add(handle); targets.push({ kind: 'type', handle, type: type.name, description: type.description });
  }
  return targets;
}

export function resolveMentionTarget(targets: MentionTarget[], handle: string): MentionTarget | undefined {
  const wanted = handle.toLowerCase();
  return targets.find(target => target.handle.toLowerCase() === wanted
    || target.kind === 'record' && target.record.handle?.toLowerCase() === wanted);
}

export function createMentionProvider(current: AutocompleteProvider, roster: () => MentionTarget[], isEnabled: () => boolean,
  reportFailure: (error: unknown) => void): AutocompleteProvider {
  let warned = false;
  return {
    triggerCharacters: ['@'],
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      const match = isEnabled() ? MENTION_TRIGGER.exec((lines[cursorLine] ?? '').slice(0, cursorCol)) : null;
      const items: AutocompleteItem[] = match ? roster().filter(target => target.handle.toLowerCase().startsWith(match[2].toLowerCase()))
        .map(target => ({ value: `@${target.handle}`, label: `@${target.handle}`, description: describeTarget(target) })) : [];
      const mine = items.length ? { items, prefix: `@${match![2]}` } : null;
      let theirs: AutocompleteSuggestions | null;
      try { theirs = await current.getSuggestions(lines, cursorLine, cursorCol, options); }
      catch (error) {
        // Pi 1.5.0's editor awaits provider results without a rejection handler. A file
        // search/inner extension failure must reach the UI, rather than break typing.
        // Remove this boundary when the host handles provider failures itself.
        if (options?.signal?.aborted) return null;
        if (!warned) { warned = true; reportFailure(error); }
        return mine;
      }
      if (!mine) return theirs;
      if (!theirs) return mine;
      return { items: [...mine.items, ...theirs.items], prefix: mine.prefix };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

function describeTarget(target: MentionTarget): string {
  if (target.kind === 'type') return `start agent · ${summarize(target.description)}`;
  const { state, name, alias } = target.record;
  const action = state === 'stopping' ? 'stopping' : active(state) ? 'send message' : 'resume';
  return `${action} · ${alias ? `${target.typeLabel} · ` : ''}${state} · ${summarize(name)}`;
}
function summarize(description: string): string {
  const first = (description.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? description).replace(/\s+/g, ' ').trim();
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}
