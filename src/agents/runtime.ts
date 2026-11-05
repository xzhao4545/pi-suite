import { loadConfig } from '../runtime/config.ts';
import { acquireRuntime } from '../jobs/runtime.ts';
import { AgentManager } from './manager.ts';
import { executeAgent } from './runner.ts';
import { childSuite } from './child.ts';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

/** Reload changes listeners; existing SDK sessions and queued runs keep their owner. */
const key = Symbol.for('pi-suite.agents.runtime.v1');
export function agentRuntime(): AgentManager {
  const registry = globalThis as unknown as Record<symbol, Map<string, AgentManager> | undefined>;
  const managers = registry[key] ??= new Map();
  const agentDir = getAgentDir();
  if (!managers.has(agentDir) || managers.get(agentDir)!.closed) {
    const runtime = acquireRuntime(agentDir);
    const manager = new AgentManager(run => {
      // Resolve ordinary child settings when its slot starts. Workflow continuation
      // fixes its original config; resources and tools must read the same snapshot.
      if (!run.record.workflowId) run.config = loadConfig(run.configCwd);
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
