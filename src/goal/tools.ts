import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WAIT_ID_PATTERN, registerBoundTool } from '../runtime/tools.ts';
import { ToolError } from '../runtime/errors.ts';
import type { GoalManager } from "./manager.ts";

import { completeRenderers, blockedRenderers, waitRenderers } from './render.ts';

const goalId = Type.String({ minLength: 1, description: "The exact goalId in the current owned goal contract" });
export function registerGoalTools(pi: ExtensionAPI, manager: GoalManager): void {
  registerBoundTool(pi, {
    name: "goal_complete",
    ...completeRenderers, label: "Goal Complete", executionMode: "sequential",
    description: "Complete the current owned goal after auditing every original requirement with verification evidence. A new user-driven audit may close paused goals without resume or automatic execution. Completed is idempotent: original evidence, completion time and feedback are preserved. Partial or unverified work must not be completed.",
    parameters: Type.Object({ goalId, summary: Type.String({ minLength: 1, maxLength: 4000 }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.summary.trim()) throw new ToolError("INVALID_ARGS", "Completion summary must include verification evidence", params.goalId);
      const changed = manager.complete(params.goalId, params.summary, ctx, signal);
      const summary = manager.goal!.progress;
      return { content: [{ type: "text", text: `${changed ? "Goal complete" : "Goal already completed"}: ${summary}` }],
        details: { goalId: params.goalId, summary }, terminate: true };
    },
  }, 'initial');
  registerBoundTool(pi, {
    name: "goal_blocked",
    ...blockedRenderers, label: "Goal Blocked", executionMode: "sequential",
    description: "For an active owned execution turn only: pause for the same evidenced external blocker repeated for at least three consecutive goal turns. Incomplete work and ordinary clarification are not blockers.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.String({ minLength: 1, maxLength: 4000 }), repeatedTurns: Type.Integer({ minimum: 3 }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.reason.trim() || !params.evidence.trim()) throw new ToolError("INVALID_ARGS", "Blocking requires a reason and concrete evidence", params.goalId);
      manager.block(params.goalId, params.reason, params.evidence, ctx, signal);
      return { content: [{ type: "text", text: `Goal paused: ${params.reason}` }], details: params, terminate: true };
    },
  }, 'initial');
  registerBoundTool(pi, {
    name: "goal_wait",
    ...waitRenderers, label: "Goal Wait", executionMode: "sequential",
    description: "For an active owned execution turn only: wait for an arranged external job/agent/event, with an optional single wake deadline. waitFor lists job_/agent_ IDs: the goal resumes only when all of them settle (or one asks a question) or the deadline passes; other notices do not end the wait. " +
      "Without waitFor any external wake resumes it. Call alone; ordinary unfinished work should continue instead.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      waitFor: Type.Optional(Type.Array(Type.String({ pattern: WAIT_ID_PATTERN }), { minItems: 1, maxItems: 50 })),
      resumeAfterMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })) }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.reason.trim()) throw new ToolError("INVALID_ARGS", "Waiting requires an external wake reason", params.goalId);
      const { waiting, settled } = manager.wait(params.goalId, params.reason, params.resumeAfterMs, ctx, params.waitFor, signal);
      const note = settled.length ? `already settled: ${settled.join(", ")}` : undefined;
      if (!waiting) {
        return { content: [{ type: "text", text: `Not waiting: every waitFor object has already settled (${settled.join(", ")}). Read their results and continue.` }],
          details: { ...params, waiting, settled } };
      }
      return { content: [{ type: "text", text: [`Goal waiting: ${params.reason}`, note].filter(Boolean).join("\n") }],
        details: { ...params, waiting, settled }, terminate: true };
    },
  }, 'initial');
}
