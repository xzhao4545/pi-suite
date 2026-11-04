import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./runtime/config.ts";
import { SessionBinding } from "./runtime/binding.ts";
import { Notifications } from "./runtime/notifications.ts";
import { Dock } from "./ui/dock.ts";
import { StatusPublisher } from "./ui/status.ts";
import { AskManager, registerAsk } from "./ask/index.ts";

export default function piSuite(pi: ExtensionAPI): void {
  let config = loadConfig(process.cwd());
  const binding = new SessionBinding();
  const dock = new Dock();
  const status = new StatusPublisher(dock);
  const notifications = new Notifications(pi, binding);
  const ask = new AskManager(binding, notifications, dock);
  if (config.modules.ask) registerAsk(pi, ask, () => config);

  pi.on("session_start", (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    binding.bind(ctx);
    dock.bind(ctx, config.ui.maxRows);
    status.bind(ctx.ui, { goal: config.goal.display, agents: config.agents.display, jobs: config.jobs.display });
    notifications.flush();
  });
  pi.on("session_shutdown", () => {
    ask.cancel(); status.detach(); dock.detach(binding.current?.ctx); binding.revoke();
  });
  pi.on("agent_settled", () => notifications.flush());
  pi.registerCommand("suite", {
    description: "Show pi-suite settings and implemented modules",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`pi-suite · ask_user ${config.modules.ask ? "enabled" : "disabled"} · timeout ${config.ask.timeout}ms · maxRows ${config.ui.maxRows}`);
    },
  });
}
