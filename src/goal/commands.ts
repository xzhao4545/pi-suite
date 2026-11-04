import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Notifications } from "../runtime/notifications.ts";
import type { Dock } from "../ui/dock.ts";
import { showDetails } from "../ui/details.ts";
import type { GoalManager } from "./manager.ts";

export function parseGoalArgs(args: string): { text?: string; budget?: number } {
  let text = args.trim(); let budget: number | undefined;
  if (text.startsWith("--tokens")) {
    const match = /^--tokens\s+(\d+(?:\.\d+)?)([km]?)\b\s*/i.exec(text);
    if (!match) throw new Error("Use --tokens <positive amount>, e.g. 100k, before the objective");
    budget = Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1);
    if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error("Token budget must be a positive whole amount");
    text = text.slice(match[0].length).trim();
  }
  if (text.length > 4000) throw new Error("Goal text must be at most 4000 characters; reference a file for longer instructions");
  return { text: text || undefined, budget };
}

export function registerGoalCommand(pi: ExtensionAPI, manager: GoalManager, dock: Dock, notifications: Notifications): void {
  const details = async (ctx: ExtensionCommandContext) => {
    const goal = manager.goal;
    if (!goal) { ctx.ui.notify("No goal"); return; }
    const release = notifications.hold();
    try {
      await showDetails(ctx, dock, "Goal", `# ${goal.text}\n\nStatus: ${goal.status} · ${manager.schedule}\n\n` +
        `ID: ${goal.id}\n\nTokens: ${goal.usedTokens}${goal.budget ? `/${goal.budget}` : " (no limit)"} · Turns: ${goal.turns} · Active elapsed: ${Math.round(goal.elapsedMs / 1000)}s\n\n` +
        `Progress: ${goal.progress || "not yet recorded"}${goal.error ? `\n\nError: ${goal.error}` : ""}`);
    } finally { release(); }
  };
  pi.registerCommand("goal", {
    description: "Manage goal: [--tokens 100k] <objective>, status, edit, pause, resume, clear",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed || trimmed === "status") { await details(ctx); return; }
      if (trimmed === "pause") { manager.pause(ctx); return; }
      if (trimmed === "resume") { manager.resume(); return; }
      if (trimmed === "clear" || trimmed === "stop") { manager.clear(ctx); return; }
      if (trimmed === "edit" || trimmed.startsWith("edit ")) {
        const input = parseGoalArgs(trimmed.slice(4));
        if (input.text === undefined && input.budget === undefined) throw new Error("Supply an objective or --tokens budget to edit");
        manager.edit(input.text, input.budget, ctx); return;
      }
      const input = parseGoalArgs(trimmed);
      if (!input.text) throw new Error("Supply a goal objective");
      const old = manager.goal;
      if (old && old.status !== "completed") {
        if (!ctx.hasUI || !await ctx.ui.confirm("Replace unfinished goal?", `${old.text}\n\nNew goal: ${input.text}`)) return;
      }
      manager.start(input.text, ctx, input.budget);
    },
  });
}
