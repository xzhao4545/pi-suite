import { loadConfig } from '../runtime/config.ts';
import { acquireRuntime } from '../jobs/runtime.ts';
import { AgentManager } from './manager.ts';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Reload changes listeners; existing SDK sessions and queued runs keep their owner. */
const key = Symbol.for('pi-suite.agents.runtime.v1');
const registry = globalThis as unknown as Record<symbol, Map<string, AgentManager> | undefined>;
export function agentRuntime(): AgentManager {
  const managers = registry[key] ??= new Map();
  const agentDir = getAgentDir();
  if (!managers.has(agentDir) || managers.get(agentDir)!.closed) {
    const runtime = acquireRuntime(agentDir);
    let execution: Promise<readonly [typeof import('./runner.ts'), typeof import('./child.ts')]> | undefined;
    const manager = new AgentManager(async run => {
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
    managers.set(agentDir, manager);
  }
  return managers.get(agentDir)!;
}

/** Query only: quit must not create an owner when agent tools are disabled. */
export function quitExistingAgentRuntime(agentDir: string): Promise<void> | undefined {
  return registry[key]?.get(agentDir)?.shutdown();
}
