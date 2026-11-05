import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalManager } from "./manager.ts";

const goalId = Type.String({ minLength: 1, description: "The exact goalId in the current active goal contract" });
export function registerGoalTools(pi: ExtensionAPI, manager: GoalManager): void {
  pi.registerTool({
    name: "goal_complete", label: "Goal Complete", executionMode: "sequential",
    description: "Complete the active goal only after verifying every original requirement. Include the completion evidence in summary; partial or unverified work stays active.",
    parameters: Type.Object({ goalId, summary: Type.String({ minLength: 1, maxLength: 4000 }) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.summary.trim()) throw new Error("Completion summary must include verification evidence");
      manager.complete(params.goalId, params.summary, ctx);
      return { content: [{ type: "text", text: `Goal complete: ${params.summary}` }],
        details: { goalId: params.goalId, summary: params.summary }, terminate: true };
    },
  });
  pi.registerTool({
    name: "goal_blocked", label: "Goal Blocked", executionMode: "sequential",
    description: "Stop only for the same evidenced external blocker repeated for at least three consecutive goal turns. Incomplete work and ordinary clarification are not blockers.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.String({ minLength: 1, maxLength: 4000 }), repeatedTurns: Type.Integer({ minimum: 3 }) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.reason.trim() || !params.evidence.trim()) throw new Error("Blocking requires a reason and concrete evidence");
      manager.block(params.goalId, params.reason, params.evidence, ctx);
      return { content: [{ type: "text", text: `Goal blocked: ${params.reason}` }], details: params, terminate: true };
    },
  });
  pi.registerTool({
    name: "goal_wait", label: "Goal Wait", executionMode: "sequential",
    description: "Wait for an arranged external job/agent/event, with an optional single wake deadline. waitFor lists job_/agent_ IDs: the goal resumes only when all of them settle (or one asks a question) or the deadline passes; other notices do not end the wait. " +
      "Without waitFor any external wake resumes it. Call alone; ordinary unfinished work should continue instead.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      waitFor: Type.Optional(Type.Array(Type.String({ pattern: "^(job|agent)_[a-f0-9]{8}$" }), { minItems: 1, maxItems: 50 })),
      resumeAfterMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })) }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!params.reason.trim()) throw new Error("Waiting requires an external wake reason");
      const { waiting, settled } = manager.wait(params.goalId, params.reason, params.resumeAfterMs, ctx, params.waitFor);
      const note = settled.length ? `already settled: ${settled.join(", ")}` : undefined;
      if (!waiting) {
        return { content: [{ type: "text", text: `Not waiting: every waitFor object has already settled (${settled.join(", ")}). Read their results and continue.` }],
          details: { ...params, waiting, settled } };
      }
      return { content: [{ type: "text", text: [`Goal waiting: ${params.reason}`, note].filter(Boolean).join("\n") }],
        details: { ...params, waiting, settled }, terminate: true };
    },
  });
}
