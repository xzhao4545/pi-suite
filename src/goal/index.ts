import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalManager } from "./manager.ts";
import { goalContract } from "./state.ts";

export function registerGoalLifecycle(pi: ExtensionAPI, manager: GoalManager): void {
  pi.on("before_agent_start", event => {
    const admitted = manager.beforeStart(event.messageType === "user");
    if (admitted && manager.goal) event.systemPromptOptions.sections["pi-suite-goal"] = goalContract(manager.goal);
    else delete event.systemPromptOptions.sections["pi-suite-goal"];
  });
  pi.on("agent_start", () => manager.startRun());
  pi.on("agent_end", event => {
    const message = event.messages.findLast(message => message.role === "assistant");
    manager.endRun(message?.role === "assistant" && message.stopReason === "error" ? message.errorMessage : undefined);
  });
  pi.on("message_end", (event, ctx) => manager.messageEnd(event, ctx));
  pi.on("ui_prompt_start", () => manager.userPrompt(true));
  pi.on("ui_prompt_end", () => manager.userPrompt(false));
  pi.on("session_before_compact", () => manager.beforeCompact());
  pi.on("session_compact", event => manager.compacted(event.willRetry));
  pi.on("session_compact_failed", event => manager.compactFailed(event.errorMessage));
}
