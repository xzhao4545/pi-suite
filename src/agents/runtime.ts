import { loadConfig } from '../runtime/config.ts';
import { acquireOwner, ownerBusy, type OwnerHandle } from '../runtime/owner.ts';
import { acquireRuntime } from '../jobs/runtime.ts';
import { AgentManager } from './manager.ts';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

import { AGENT_OWNER, existingAgentRuntime, WORKFLOW_OWNER } from './registry.ts';

/**
 * Reload changes listeners; existing SDK sessions and queued runs keep their owner. The start
 * callback closes over this module load's config loader and child stack, so an owner from an
 * earlier load is replaced once idle (see runtime/owner.ts).
 */
export function agentRuntime(): OwnerHandle<AgentManager> {
  const agentDir = getAgentDir();
  return acquireOwner(AGENT_OWNER, 'subagents', agentDir, () => {
    const runtime = acquireRuntime(agentDir);
    let execution: Promise<readonly [typeof import('./runner.ts'), typeof import('./child.ts')]> | undefined;
    const manager: AgentManager = new AgentManager(async run => {
      // Resolve ordinary child settings when its slot starts. Workflow continuation
      // fixes its original config; resources and tools must read the same snapshot.
      if (!run.record.workflowId) run.config = loadConfig(run.configCwd);
      // Concurrent first starts share one load; Jiti must finish shared dependencies in order.
      execution ??= (async () => [await import('./runner.ts'), await import('./child.ts')] as const)();
      const [{ executeAgent }, { childSuite }] = await execution;
      return executeAgent(run, pi => childSuite(pi, run, manager), manager.changed,
        (kind, details) => manager.event(kind, run, details));
    }, async ids => {
      if (runtime.mode !== 'active') throw new Error('Cannot cascade agent stop: jobs execution runtime is unavailable');
      return (await runtime.manager.stopCreatedBy(ids)).map(({ job }) => ({ id: job.id, state: job.state, cleanup: job.cleanup.state }));
    });
    return manager;
    // A running workflow drives this owner; closing it would fail the workflow's next agent.
  }, { dependants: () => ownerBusy(WORKFLOW_OWNER, agentDir) });
}

/** Query only: quit must not create an owner when agent tools are disabled. */
export function quitExistingAgentRuntime(agentDir: string): Promise<void> | undefined {
  return existingAgentRuntime(agentDir)?.shutdown();
}
