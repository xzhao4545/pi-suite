// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/structured-output.ts (MIT).
// The name matches Claude Code so ported prompts can still call StructuredOutput.
// AgentSession does not expose toolChoice. Constrained sampling and tool guidance
// help the model make the call; validation and one final prompt cover failures.

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stateLine, toolRenderers } from "../../ui/tool-render.ts";
import type { CompiledSchema } from "./schema.ts";

// The child runner injects this tool. Adding it to the subagent exclusion list
// would hide it; adding it to the built-in list would let frontmatter select it.
export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

type OutputDetails = { payload?: string; error?: string };
export const structuredOutputRenderers = toolRenderers<unknown, OutputDetails>({
  call: () => ({ icon: "", title: STRUCTURED_OUTPUT_TOOL_NAME }),
  collapsed: () => ({ ...stateLine("completed"), title: STRUCTURED_OUTPUT_TOOL_NAME, summary: "accepted" }),
  error: details => ({ summary: "rejected", diagnostic: details?.error }),
  expanded: details => details?.payload === undefined ? [] : [{ code: details.payload, language: "json" }],
});

export interface StructuredCapture {
  json?: string;
  /** Why the most recent attempt was rejected, for the retry prompt. */
  lastError?: string;
  /** Whether the tool was called at all — "never tried" reads differently. */
  called: boolean;
}

export function createStructuredCapture(): StructuredCapture {
  return { called: false };
}

// The runner owns capture so it can check the result even if the model never calls the tool.
export function createStructuredOutputTool(
  compiled: CompiledSchema,
  capture: StructuredCapture,
): ToolDefinition {
  return defineTool({
    ...structuredOutputRenderers,
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    label: "Structured Output",
    description:
      "Submit your complete final answer in one StructuredOutput call. Use the schema fields, not prose. If rejected, fix the reported fields and call again.",
    promptSnippet: "Submit a structured final answer",
    promptGuidelines: [
      "Put the complete final answer in StructuredOutput; prose does not count as the result.",
    ],
    // Pass the caller's JSON Schema directly so the provider sees the same fields the checker validates.
    parameters: compiled.schema as never,
    // "prefer", not "require": a provider that cannot constrain sampling should
    // fall through to validation-and-retry rather than fail the call outright.
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    // Models occasionally send the whole payload as one JSON string instead of
    // an object. Recovering that costs nothing and saves a whole retry.
    prepareArguments: (args: unknown) => {
      if (typeof args !== "string") return args as never;
      return JSON.parse(args) as never;
    },
    execute: async (_toolCallId, params) => {
      capture.called = true;
      const verdict = compiled.check(params);
      if (verdict !== true) {
        capture.lastError = verdict;
        // `isError` puts the reason in front of the model as a tool result, so
        // it can correct itself inside this same run. This is where most
        // mismatches are resolved; the prompt-level retry is the backstop.
        return {
          content: [{
            type: "text",
            text: `${verdict}\nFix the reported fields and call StructuredOutput again.`,
          }],
          isError: true,
          details: { error: verdict } satisfies OutputDetails,
        };
      }
      // Last valid call wins: a model that calls twice meant the second one. The payload
      // also goes into details so replay needs neither the schema nor the call arguments.
      capture.json = JSON.stringify(params);
      capture.lastError = undefined;
      return { content: [{ type: "text", text: "Recorded." }], details: { payload: capture.json } satisfies OutputDetails };
    },
  }) as ToolDefinition;
}

/**
 * The one extra prompt sent when a run ended with nothing captured.
 *
 * Distinguishes "never called it" from "called it wrongly" — the two need
 * different corrections, and telling a model it got the shape wrong when it
 * never answered at all sends it looking for a mistake it did not make.
 */
export function structuredRetryPrompt(capture: StructuredCapture): string {
  const reason = capture.called && capture.lastError !== undefined
    ? `StructuredOutput rejected the last call: ${capture.lastError}`
    : `You did not call ${STRUCTURED_OUTPUT_TOOL_NAME}.`;
  return `${reason}\n\nCall ${STRUCTURED_OUTPUT_TOOL_NAME} with your complete answer, not prose.`;
}
