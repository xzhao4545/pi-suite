import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalManager } from "./manager.ts";
import { GOAL_CONTEXT, goalContext, stripGoalSections } from "./context.ts";

export function registerGoalLifecycle(pi: ExtensionAPI, manager: GoalManager): void {
  pi.on("before_agent_start", event => {
    manager.beforeStart(event.messageType === "user");
    delete event.systemPromptOptions.sections["pi-suite-goal"];
  });
  pi.on("context_with_system", (event, ctx) => {
    const messages = stripGoalSections(event.messages).filter(message => message.role !== "custom" || message.customType !== GOAL_CONTEXT);
    const view = manager.contextView(ctx);
    // Full-transcript projection keeps Pi's head and in-place tool/prompt patches.
    // Forced prompts run afterwards and drop sections, so the contract is conversation data.
    return { messages: view ? [...messages, goalContext(view.goal, view.access)] : messages };
  });
  pi.on("input", event => { if (event.source !== "extension") manager.activity.reset(); });
  pi.on("tool_execution_start", (event, ctx) => { if (manager.contextView(ctx)?.access === "execute") manager.activity.toolStart(event); });
  pi.on("tool_execution_end", (event, ctx) => { if (manager.contextView(ctx)?.access === "execute") manager.activity.toolEnd(event); });
  pi.on("agent_start", (_event, ctx) => manager.startRun(ctx));
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
