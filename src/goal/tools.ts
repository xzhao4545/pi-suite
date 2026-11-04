import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalManager } from "./manager.ts";

const goalId = Type.String({ minLength: 1, description: "The exact goal_id in the current active goal contract" });
export function registerGoalTools(pi: ExtensionAPI, manager: GoalManager): void {
  pi.registerTool({
    name: "goal_complete", label: "Goal Complete", executionMode: "sequential",
    description: "Complete the active goal only after verifying every original requirement. Include the completion evidence in summary; partial or unverified work stays active.",
    parameters: Type.Object({ goal_id: goalId, summary: Type.String({ minLength: 1, maxLength: 4000 }) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.summary.trim()) throw new Error("Completion summary must include verification evidence");
      manager.complete(params.goal_id, params.summary, ctx);
      return { content: [{ type: "text", text: `Goal complete: ${params.summary}` }],
        details: { goal_id: params.goal_id, summary: params.summary }, terminate: true };
    },
  });
  pi.registerTool({
    name: "goal_blocked", label: "Goal Blocked", executionMode: "sequential",
    description: "Stop only for the same evidenced external blocker repeated for at least three consecutive goal turns. Incomplete work and ordinary clarification are not blockers.",
    parameters: Type.Object({ goal_id: goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.String({ minLength: 1, maxLength: 4000 }), repeated_turns: Type.Integer({ minimum: 3 }) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.reason.trim() || !params.evidence.trim()) throw new Error("Blocking requires a reason and concrete evidence");
      manager.block(params.goal_id, params.reason, params.evidence, ctx);
      return { content: [{ type: "text", text: `Goal blocked: ${params.reason}` }], details: params, terminate: true };
    },
  });
  pi.registerTool({
    name: "goal_wait", label: "Goal Wait", executionMode: "sequential",
    description: "Wait for an arranged external job/event, with an optional single wake deadline. Call alone; ordinary unfinished work should continue instead.",
    parameters: Type.Object({ goal_id: goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      resume_after_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.reason.trim()) throw new Error("Waiting requires an external wake reason");
      manager.wait(params.goal_id, params.reason, params.resume_after_ms, ctx);
      return { content: [{ type: "text", text: `Goal waiting: ${params.reason}` }], details: params, terminate: true };
    },
  });
}
