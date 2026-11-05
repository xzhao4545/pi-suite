import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { SessionBinding } from '../runtime/binding.ts';
import { Notifications } from '../runtime/notifications.ts';
import { WaitRegistry, registerWait } from '../runtime/wait.ts';
import { Dock } from '../ui/dock.ts';
import { StatusPublisher } from '../ui/status.ts';
import { TasksModule } from '../tasks/index.ts';
import { registerTaskTools } from '../tasks/tools.ts';
import { JobsModule } from '../jobs/index.ts';
import { registerJobTools } from '../jobs/tools.ts';
import { askSchema, type AskParams } from '../ask/schema.ts';
import { askDetails } from '../ask/index.ts';
import { askParent } from './questions.ts';
import { AgentsModule } from './index.ts';
import { registerAgentTools } from './tools.ts';
import type { AgentManager } from './manager.ts';
import type { Execution } from './types.ts';
import { loadConfig } from '../runtime/config.ts';

/** Child tools use the owner's task list and real run ancestry; the model cannot forge creators. */
export function childSuite(pi: ExtensionAPI, run: Execution, manager: AgentManager): void {
  const config = run.config, binding = new SessionBinding(), dock = new Dock();
  const status = new StatusPublisher(dock), notices = new Notifications(pi, binding), waits = new WaitRegistry();
  const tasks = config.modules.tasks ? new TasksModule(binding, dock, run.parent.taskStore) : undefined;
  const agents = new AgentsModule(pi, binding, notices, status, tasks, run, manager);
  const jobs = config.modules.jobs ? new JobsModule(pi, binding, notices, status) : undefined;
  const ask = { ask: (params: AskParams, _ctx: unknown, _config: unknown, signal?: AbortSignal) => askParent(run, params, config.ask.timeout, manager.changed, signal) };
  pi.registerTool({ name: 'ask_user', label: 'Ask parent', parameters: askSchema, executionMode: 'sequential',
    description: 'Ask your direct parent for information; wait for its explicit answer. timed_out/cancelled never means consent.',
    async execute(_id, params, signal) {
      const { result, questions } = await ask.ask(params, undefined, undefined, signal);
      const details = { ...askDetails(params, questions, result), source: 'parent' };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details, terminate: result.status !== 'answered' };
    } });
  if (tasks) { registerTaskTools(pi, tasks); tasks.registerReminders(pi, () => config); }
  if (jobs) {
    const viewer = { jobs, dock, notifications: notices, keys: () => config.jobs };
    registerJobTools(pi, jobs, viewer, { ask, config: () => config, tasks, parentQuestions: true,
      creator: { agentId: run.record.id, runId: run.record.runId,
        ancestors: [...run.record.ancestors, ...run.record.workflowId ? [run.record.workflowId] : []] } });
    waits.register(jobs);
  }
  // A type toggle changes admission for newly requested descendants, even while their
  // parent keeps the tools/resources with which it already started.
  if (run.type.allowedSubagents && !run.isolated && run.record.ancestors.length + 1 < config.agents.maxDepth) registerAgentTools(pi, agents, waits, () => loadConfig(run.configCwd));
  waits.register(agents); registerWait(pi, waits);
  pi.on('session_start', async (_event, ctx) => {
    binding.bind(ctx);
    await tasks?.bind(ctx, { reason: 'startup' });
    agents.bind(); jobs?.bind();
  });
  pi.on('input', event => { if (event.streamingBehavior === 'steer') waits.userSteered(); });
  pi.on('message_start', event => { if (event.message.role === 'user') waits.steeringDelivered(); });
  pi.on('agent_before_settle', event => notices.beforeSettle(event));
  pi.on('agent_settled', () => { waits.steeringDelivered(); notices.flush(); });
  pi.on('session_shutdown', () => {
    // The child owns its bindings, while the shared job/agent runtimes belong to the Pi process.
    agents.detach(); jobs?.detach(); tasks?.detach(); notices.detach(); binding.revoke();
  });
}
