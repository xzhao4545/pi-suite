import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WAIT_ID_PATTERN, registerBoundTool } from '../runtime/tools.ts';
import { ToolError } from '../runtime/errors.ts';
import type { GoalManager } from "./manager.ts";

import { completeRenderers, blockedRenderers, waitRenderers } from './render.ts';

const goalId = Type.String({ minLength: 1, description: "The exact goalId from the latest Goal instruction" });
export function registerGoalTools(pi: ExtensionAPI, manager: GoalManager): void {
  registerBoundTool(pi, {
    name: "goal_complete",
    ...completeRenderers, label: "Goal Complete", executionMode: "sequential",
    description: "Mark the current goal complete after checking every original requirement. Do not complete partial or unverified work. Works while the goal runs, and in a user turn while it is paused. On an already completed goal it keeps the first summary.",
    parameters: Type.Object({ goalId, summary: Type.String({ minLength: 1, maxLength: 4000, description: "Each requirement with the evidence that verifies it" }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.summary.trim()) throw new ToolError("INVALID_ARGS", "summary must list each requirement with its verification evidence", params.goalId);
      const changed = await manager.complete(params.goalId, params.summary, ctx, signal);
      const summary = manager.goal!.progress;
      return { content: [{ type: "text", text: `${changed ? "Goal complete" : "Goal already completed"}: ${summary}` }],
        details: { goalId: params.goalId, summary }, terminate: true };
    },
  }, 'initial');
  registerBoundTool(pi, {
    name: "goal_blocked",
    ...blockedRenderers, label: "Goal Blocked", executionMode: "sequential",
    description: "Pause the running goal because of an external blocker you cannot resolve that has repeated for at least 3 consecutive goal turns. Unfinished work and questions for the user are not blockers; ask questions with ask_user.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.String({ minLength: 1, maxLength: 4000 }), repeatedTurns: Type.Integer({ minimum: 3 }) }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.reason.trim() || !params.evidence.trim()) throw new ToolError("INVALID_ARGS", "reason and evidence must both be non-empty", params.goalId);
      await manager.block(params.goalId, params.reason, params.evidence, ctx, signal);
      return { content: [{ type: "text", text: `Goal paused: ${params.reason}` }], details: params, terminate: true };
    },
  }, 'initial');
  registerBoundTool(pi, {
    name: "goal_wait",
    ...waitRenderers, label: "Goal Wait", executionMode: "sequential",
    description: "Pause the running goal until external work you started (jobs, subagents, workflows) needs attention. Call it alone, and not for work you can do now. " +
      "The goal resumes when the user sends a message, a direct subagent asks a question, or resumeAfterMs passes. " +
      "With waitFor it also resumes when all listed IDs settle or a listed job emits a monitor event or hands-free update; without waitFor, any notification resumes it.",
    parameters: Type.Object({ goalId, reason: Type.String({ minLength: 1, maxLength: 1000, description: "What the goal is waiting for" }),
      waitFor: Type.Optional(Type.Array(Type.String({ pattern: WAIT_ID_PATTERN }), { minItems: 1, maxItems: 50,
        description: "job_, agent_ or wf_ IDs. If all have already settled, the call returns without waiting." })),
      resumeAfterMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647,
        description: "Resume after this many milliseconds even if nothing else happens" })) }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      if (!params.reason.trim()) throw new ToolError("INVALID_ARGS", "reason must say what the goal is waiting for", params.goalId);
      const { waiting, settled } = await manager.wait(params.goalId, params.reason, params.resumeAfterMs, ctx, params.waitFor, signal);
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
