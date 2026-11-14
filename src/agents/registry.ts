import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentManager } from './manager.ts';

// Reloaded factories and display-only imports share the execution owners, not a
// second name cache that would need synchronization on every lifecycle change.
const key = Symbol.for('pi-suite.agents.runtime.v1');
const registry = globalThis as unknown as Record<symbol, Map<string, AgentManager> | undefined>;

/** Only the execution path creates the registry; renderer queries never acquire an owner. */
export function agentOwners(): Map<string, AgentManager> {
  return registry[key] ??= new Map();
}

export function existingAgentRuntime(agentDir: string): AgentManager | undefined {
  return registry[key]?.get(agentDir);
}

/** Queries are process-local: missing/history-only owners keep their original ID. */
export function agentDisplayName(id: string, runId?: string): string {
  if (!id?.startsWith('agent_')) return id;
  return existingAgentRuntime(getAgentDir())?.records()
    .find(record => record.id === id && (!runId || record.runId === runId) && !record.workflowId)?.name ?? id;
}
