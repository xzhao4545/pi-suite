import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { AgentManager } from './manager.ts';
import { existingOwner } from '../runtime/owner.ts';

// Reloaded factories and display-only imports share the execution owners, not a
// second name cache that would need synchronization on every lifecycle change.
export const AGENT_OWNER = 'pi-suite.agents.runtime.v1';
export const WORKFLOW_OWNER = 'pi-suite.workflows.runtime.v1';

/** Query only: renderers and quit never acquire or replace an owner. */
export function existingAgentRuntime(agentDir: string): AgentManager | undefined {
  return existingOwner(AGENT_OWNER, agentDir) as AgentManager | undefined;
}

/** Only consult records already loaded in this process; renderers do not scan session files. */
export function agentDisplayName(id: string, runId?: string): string {
  if (!id?.startsWith('agent_')) return id;
  return existingAgentRuntime(getAgentDir())?.records()
    .find(record => record.id === id && (!runId || record.runId === runId) && !record.workflowId)?.name ?? id;
}
