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
  if (jobs) {
    const viewer = { jobs, dock, notifications, keys: () => config.jobs };
    registerJobTools(pi, jobs, viewer, { ask, config: () => config, tasks }); registerJobsCommand(pi, viewer); waits.register(jobs);
  }
  const agents = config.modules.agents ? new AgentsModule(pi, binding, notifications, status, tasks) : undefined;
  if (agents) {
    registerAgentTools(pi, agents, waits, () => config); registerAgentsCommand(pi, agents, dock, notifications, () => config, cwd => { config = loadConfig(cwd); }); waits.register(agents);
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
    ask.cancel(); goal?.detach(); jobs?.detach(); agents?.detach(); notifications.detach();
    config = loadConfig(ctx.cwd);
    binding.bind(ctx);
    dock.bind(ctx, config.ui.maxRows);
    status.bind(ctx.ui, { goal: config.goal.display, agents: config.agents.display, jobs: config.jobs.display });
    goal?.restore(ctx, reason);
    jobs?.bind();
    await tasks?.bind(ctx, { reason, previousSessionFile });
    agents?.manager.configure(config); agents?.bind();
    notifications.flush();
  };
  pi.on("session_start", (event, ctx) => bindSession(ctx, event.reason, event.previousSessionFile));
  pi.on("session_tree", async (_event, ctx) => { await bindSession(ctx, "resume"); notifications.afterHostOperation(); });
  pi.on("session_shutdown", event => {
    ask.cancel(); goal?.shutdown();
    tasks?.detach();
    // Detach before revoking so pending job notices are cancelled under the old session ID.
    const quit = jobs?.shutdown(event.reason);
    const agentQuit = event.reason === 'quit' ? agents?.manager.shutdown() : undefined;
    agents?.detach();
    notifications.detach(); status.detach(); dock.detach(binding.current?.ctx); binding.revoke();
    return Promise.all([quit, agentQuit]).then(() => {});
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
