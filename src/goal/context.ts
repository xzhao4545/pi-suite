import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { Goal } from "./state.ts";
type AgentMessage = ContextEvent["messages"][number];

export const GOAL_CONTEXT = "pi-suite:goal-context";
export const GOAL_CONTINUATION = "Continue the current goal using the latest request contract.";

// Rules are stable; task data is JSON-encoded separately so a goal cannot close a
// framework wrapper. Neither component is appended to the persisted conversation.
const rules = "Continue until every original requirement is implemented and verified; never replace the objective with an easier subset. " +
  "Use goal_complete with the exact goalId only after auditing every requirement with verification evidence. " +
  "A user audit may close failed, paused, blocked, budget_limited or stopped goals without resume; completion is idempotent and preserves evidence and time. " +
  "Use goal_blocked only for the same evidenced external blocker repeated for at least three goal turns. " +
  "Use goal_wait only for arranged external work or a wake deadline, not ordinary unfinished work. " +
  "Skipped, timed_out and cancelled ask_user answers are not consent. The access field controls Goal tools, not a file sandbox. " +
  "Only explicit /goal resume restores execution after an autoStopReason; a new user message may audit that stopped automatic phase. " +
  "Only an execute contract permits goal_wait/goal_blocked or automatic goal continuation; completion-only permission permits auditing, not resuming work.";

export function goalContext(goal: Goal, access: "execute" | "complete"): AgentMessage {
  return { role: "custom", customType: GOAL_CONTEXT, display: false, timestamp: 0,
    content: `Current Goal contract (request-only; supersedes historical Goal control):\n${rules}\n` +
      JSON.stringify({ goalId: goal.id, revision: goal.revision, objective: goal.text, status: goal.status, access,
        automatic: goal.automatic, autoStopReason: goal.autoStopReason, resumeRequired: goal.resumeRequired ?? false,
        usedTokens: goal.usedTokens, budget: goal.budget ?? null, turns: goal.turns,
        progress: goal.progress, error: goal.error, stoppedFrom: goal.stoppedFrom,
        waiting: goal.waiting, waitFor: goal.waitFor, resumeAt: goal.resumeAt }) };
}

/** Only remove our named section, never the system message or its tool deltas. */
export function stripGoalSections(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(message => {
    if (message.role !== "system" || !message.sections || !("pi-suite-goal" in message.sections)) return message;
    const { "pi-suite-goal": _goal, ...sections } = message.sections;
    return { ...message, sections };
  });
}
