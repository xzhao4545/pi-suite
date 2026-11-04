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
import { WaitRegistry, registerWait } from "./runtime/wait.ts";

export default function piSuite(pi: ExtensionAPI): void {
  let config = loadConfig(process.cwd());
  const binding = new SessionBinding();
  const dock = new Dock();
  const status = new StatusPublisher(dock);
  const notifications = new Notifications(pi, binding);
  const goal = config.modules.goal ? new GoalManager(pi, binding, notifications, status) : undefined;
  const ask = new AskManager(binding, notifications, dock, (answered, ctx) => goal?.askResult(answered, ctx));
  if (config.modules.ask) registerAsk(pi, ask, () => config);
  const jobs = config.modules.jobs ? new JobsModule(pi, binding, notifications, status) : undefined;
  const waits = new WaitRegistry();
  if (jobs) { registerJobTools(pi, jobs); waits.register(jobs); }
  if (jobs) registerWait(pi, waits);
  if (goal) {
    registerGoalTools(pi, goal); registerGoalCommand(pi, goal, dock, notifications); registerGoalLifecycle(pi, goal);
  }

  const bindSession = (ctx: Parameters<SessionBinding["bind"]>[0], reason: "startup" | "reload" | "new" | "resume" | "fork") => {
    // Tree navigation has no shutdown event. Revoke the old readers and timers before
    // rebinding, without appending their state into the branch the host just selected.
    ask.cancel(); goal?.detach(); jobs?.detach(); notifications.detach();
    config = loadConfig(ctx.cwd);
    binding.bind(ctx);
    dock.bind(ctx, config.ui.maxRows);
    status.bind(ctx.ui, { goal: config.goal.display, agents: config.agents.display, jobs: config.jobs.display });
    goal?.restore(ctx, reason);
    jobs?.bind();
    notifications.flush();
  };
  pi.on("session_start", (event, ctx) => bindSession(ctx, event.reason));
  pi.on("session_tree", (_event, ctx) => { bindSession(ctx, "resume"); notifications.afterHostOperation(); });
  pi.on("session_shutdown", event => {
    ask.cancel(); goal?.shutdown();
    // Detach before revoking so pending job notices are cancelled under the old session ID.
    const quit = jobs?.shutdown(event.reason);
    notifications.detach(); status.detach(); dock.detach(binding.current?.ctx); binding.revoke();
    return quit;
  });
  pi.on("agent_before_settle", event => { goal?.beforeSettle(event); return notifications.beforeSettle(event); });
  pi.on("agent_settled", event => { goal?.settled(event.aborted); if (event.aborted) jobs?.pauseWakes(); notifications.flush(); });
  pi.registerCommand("suite", {
    description: "Show pi-suite settings and implemented modules",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-suite · ask_user ${config.modules.ask ? "enabled" : "disabled"} · jobs ${jobs ? "enabled" : "disabled"} · timeout ${config.ask.timeout}ms · maxRows ${config.ui.maxRows}`);
    },
  });
}
