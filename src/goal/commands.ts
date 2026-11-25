import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Notifications } from "../runtime/notifications.ts";
import type { Dock } from "../ui/dock.ts";
import { GOAL_RESUME, goalDetails, type ResumeDetails } from './presentation.ts';

import type { GoalManager } from './manager.ts';

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
    const captured = manager.captureBinding(ctx);
    if (!captured) return;
    const release = notifications.hold();
    try {
      const { showDetails } = await import('../ui/details.ts');
      // Loading can cross shutdown/tree/reload. Never mount the old page in a new binding.
      if (!manager.isCurrent(captured) || manager.goal !== goal || ctx.signal?.aborted) return;
      await showDetails(ctx, dock, 'Goal', goalDetails(goal, manager.schedule, manager.elapsedMs));
    } finally { release(); }
  };
  pi.registerCommand("goal", {
    description: 'Manage goal: [--tokens 100k] <objective>, status, edit, pause, resume, clear',
    getArgumentCompletions: prefix => ['status', 'edit', 'pause', 'resume', 'clear'].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed || trimmed === "status") { await details(ctx); return; }
      if (trimmed === "pause") { await manager.pause(ctx); return; }
      if (trimmed === 'resume') {
        // Hold control delivery until the explicit result is stored. The display message never
        // triggers execution; the existing requestId queue owns the one continuation.
        const release = notifications.hold();
        try {
          const result = await manager.resume();
          const summary = result === 'running' ? 'Goal already running' : result === 'waiting_host' ? 'Goal resumed · waiting' : 'Goal resumed';
          // A custom message is deferred until turn_end while streaming. This receipt is
          // display-only, so an entry can appear immediately without entering model history.
          pi.appendEntry(GOAL_RESUME, { resumeVersion: 1, summary, text: summary } satisfies ResumeDetails & { summary: string });
        } finally { release(); }
        return;
      }
      // Removed control words must not fall through to objective creation.
      if (/^stop(?:\s|$)/.test(trimmed)) throw new Error('Unknown goal command: stop');
      if (trimmed === "clear") { await manager.clear(ctx); return; }
      if (trimmed === "edit" || trimmed.startsWith("edit ")) {
        const input = parseGoalArgs(trimmed.slice(4));
        if (input.text === undefined && input.budget === undefined) throw new Error("Supply an objective or --tokens budget to edit");
        await manager.edit(input.text, input.budget, ctx); return;
      }
      const input = parseGoalArgs(trimmed);
      if (!input.text) throw new Error("Supply a goal objective");
      const old = manager.goal;
      const captured = manager.captureBinding(ctx);
      if (!captured) return;
      if (old && old.status !== "completed") {
        if (!ctx.hasUI || !await ctx.ui.confirm("Replace unfinished goal?", `${old.text}\n\nNew goal: ${input.text}`)) return;
        if (!manager.isCurrent(captured) || ctx.signal?.aborted) return;
      }
      await manager.start(input.text, ctx, input.budget);
    },
  });
}
