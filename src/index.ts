import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./runtime/config.ts";
import { SessionBinding } from "./runtime/binding.ts";
import { Notifications } from "./runtime/notifications.ts";
import { Dock } from "./ui/dock.ts";
import { StatusPublisher } from "./ui/status.ts";
import { AskManager, registerAsk } from "./ask/index.ts";
import { GoalManager } from "./goal/manager.ts";
import { registerGoalTools } from "./goal/tools.ts";
import { registerGoalCommand } from "./goal/commands.ts";
import { registerGoalLifecycle } from "./goal/index.ts";
import { JobsModule } from "./jobs/index.ts";
import { registerJobTools } from "./jobs/tools.ts";
import { registerJobsCommand } from "./jobs/viewer.ts";
import { WaitRegistry, registerWait } from "./runtime/wait.ts";
import { TasksModule } from "./tasks/index.ts";
import { registerTaskTools } from "./tasks/tools.ts";
import { registerTasksCommand } from "./tasks/viewer.ts";
import { AgentsModule } from "./agents/index.ts";
import { registerAgentTools } from "./agents/tools.ts";
import { registerAgentsCommand } from "./agents/viewer.ts";
import { registerAgentMentions } from "./agents/mentions/index.ts";
import { AgentScheduler } from "./agents/schedules/index.ts";
import { AgentRpc } from "./agents/rpc/index.ts";
import { WorkflowsModule } from './agents/workflow/index.ts';
import { registerWorkflowTool } from './agents/workflow/tools.ts';
import { showWorkflows } from './agents/workflow/ui/menu.ts';

export default function piSuite(pi: ExtensionAPI): void {
  let config = loadConfig(process.cwd());
  const binding = new SessionBinding();
  const dock = new Dock();
  const status = new StatusPublisher(dock);
  const notifications = new Notifications(pi, binding);
  const tasks = config.modules.tasks ? new TasksModule(binding, dock) : undefined;
  if (tasks) { registerTaskTools(pi, tasks); registerTasksCommand(pi, tasks, dock, notifications); tasks.registerReminders(pi, () => config); }
  const waits = new WaitRegistry();
  const goal = config.modules.goal ? new GoalManager(pi, binding, notifications, status, waits) : undefined;
  const ask = new AskManager(binding, notifications, dock, (answered, ctx) => goal?.askResult(answered, ctx));
  if (config.modules.ask) registerAsk(pi, ask, () => config);
  const jobs = config.modules.jobs ? new JobsModule(pi, binding, notifications, status) : undefined;
  const jobViewer = jobs ? { jobs, dock, notifications, keys: () => config.jobs } : undefined;
  if (jobs) {
    registerJobTools(pi, jobs, jobViewer!, { ask, config: () => config, tasks }); registerJobsCommand(pi, jobViewer!); waits.register(jobs);
  }
  const agents = config.modules.agents ? new AgentsModule(pi, binding, notifications, status, tasks) : undefined;
  const agentJobViewer = agents ? {pi, viewer: jobViewer ?? {jobs: new JobsModule(pi, binding, notifications, status), dock, notifications, keys: () => config.jobs}} : undefined;
  const schedules = agents ? new AgentScheduler(pi, binding, agents, notifications, () => config) : undefined;
  const agentRpc = agents ? new AgentRpc(pi, binding, agents, () => config) : undefined;
  const workflows = agents ? new WorkflowsModule(pi, binding, notifications, dock, agents) : undefined;
  const workflowTool = workflows && agents ? registerWorkflowTool(pi, workflows, agents, () => config) : undefined;
  if (workflows) waits.register(workflows);
  let startTool: ReturnType<typeof registerAgentTools> | undefined;
  let mentions: ReturnType<typeof registerAgentMentions> | undefined;
  if (agents) {
    startTool = registerAgentTools(pi, agents, waits, () => config, schedules, agentJobViewer!.viewer.jobs);
    registerAgentsCommand(pi, agents, dock, notifications, () => config, cwd => {
      config = loadConfig(cwd); mentions?.refreshTypes();
      if (binding.current) workflowTool?.refreshTypes(binding.current.ctx);
    }, schedules,
      workflows && workflowTool ? {available: () => workflowTool.enabled,
        show: ctx => showWorkflows(ctx, {workflows, agents, dock, config: () => config, jobs: agentJobViewer})} : undefined,
      agentJobViewer); waits.register(agents);
    mentions = registerAgentMentions(pi, agents, binding, () => config, startTool);
  }
  if (jobs || agents) {
    registerWait(pi, waits);
    // Extension-sent messages (our own notices) are not the user and must not end a wait.
    pi.on("input", event => { if (event.streamingBehavior === "steer" && event.source !== "extension") waits.userSteered(); });
    pi.on("message_start", event => { if (event.message.role === "user") waits.steeringDelivered(); });
  }
  if (goal) {
    registerGoalTools(pi, goal); registerGoalCommand(pi, goal, dock, notifications); registerGoalLifecycle(pi, goal);
  }

  const bindSession = async (ctx: Parameters<SessionBinding["bind"]>[0], reason: "startup" | "reload" | "new" | "resume" | "fork", previousSessionFile?: string) => {
    // Tree navigation has no shutdown event. Revoke the old readers and timers before
    // rebinding, without appending their state into the branch the host just selected.
    schedules?.stop(); ask.cancel(); goal?.detach(); jobs?.detach(); workflows?.detach(); agents?.detach(); notifications.detach();
    config = loadConfig(ctx.cwd);
    binding.bind(ctx);
    dock.bind(ctx, config.ui.maxRows);
    status.bind(ctx.ui, { goal: config.goal.display, agents: config.agents.display, jobs: config.jobs.display });
    goal?.restore(ctx, reason);
    jobs?.bind();
    await tasks?.bind(ctx, { reason, previousSessionFile });
    agents?.manager.configure(config); agents?.bind();
    workflows?.bind(); workflowTool?.bind(ctx);
    await schedules?.bind(); startTool?.refreshSchema();
    agentRpc?.bind();
    notifications.flush();
  };
  pi.on("session_start", (event, ctx) => bindSession(ctx, event.reason, event.previousSessionFile));
  pi.on("session_tree", async (_event, ctx) => { await bindSession(ctx, "resume"); notifications.afterHostOperation(); });
  pi.on("session_shutdown", event => {
    agentRpc?.detach();
    schedules?.stop();
    ask.cancel(); goal?.shutdown();
    tasks?.detach();
    // Detach before revoking so pending job notices are cancelled under the old session ID.
    const quit = (jobs ?? agentJobViewer?.viewer.jobs)?.shutdown(event.reason);
    const agentQuit = event.reason === 'quit' ? agents?.manager.shutdown() : undefined;
    const workflowQuit = event.reason === 'quit' ? workflows?.manager.shutdown() : undefined;
    const scheduleQuit = agentQuit?.then(() => schedules?.drain());
    workflows?.detach(); agents?.detach();
    notifications.detach(); status.detach(); dock.detach(binding.current?.ctx); binding.revoke();
    return Promise.all([quit, agentQuit, workflowQuit, scheduleQuit]).then(() => { if (agents) pi.events.emit('subagents:disposed', {}); });
  });
  pi.on("agent_before_settle", event => { goal?.beforeSettle(event); return notifications.beforeSettle(event); });
  pi.on("agent_settled", event => {
    waits.steeringDelivered(); goal?.settled(event.aborted);
    if (event.aborted) jobs?.pauseWakes();
    notifications.flush();
  });
  pi.registerCommand("suite", {
    description: "Show pi-suite settings and implemented modules",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-suite · ask_user ${config.modules.ask ? "enabled" : "disabled"} · tasks ${tasks ? "enabled" : "disabled"} · agents ${agents ? "enabled" : "disabled"} · jobs ${jobs ? "enabled" : "disabled"} · timeout ${config.ask.timeout}ms · maxRows ${config.ui.maxRows}`);
    },
  });
}
