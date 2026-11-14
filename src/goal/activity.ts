import { createHash } from "node:crypto";
import type { ToolExecutionStartEvent, ToolExecutionEndEvent } from "@earendil-works/pi-coding-agent";

export type AutoStopReason = "no_tools" | "repeated_tools";
export const autoStopMessage: Record<AutoStopReason, string> = {
  no_tools: 'Goal paused · no tool activity',
  repeated_tools: 'Goal paused · repeated tool activity',
};
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Samples Goal-delivered auto rounds, not provider turns or user work. No output history is retained. */
export class GoalActivity {
  private pending = false;
  private automatic = false;
  private calls = new Map<string, { call: string; result?: string }>();
  private previous?: string;
  private empty = 0;
  private repeated = 0;

  reset(): void {
    this.pending = false; this.automatic = false; this.calls.clear();
    this.previous = undefined; this.empty = 0; this.repeated = 0;
  }
  delivered(): void { this.pending = true; }
  start(): void {
    // Host retries/compaction retries without a new Goal delivery stay in the same round.
    if (!this.pending) return;
    this.pending = false; this.automatic = true; this.calls.clear();
  }
  toolStart(event: ToolExecutionStartEvent): void {
    if (this.automatic) this.calls.set(event.toolCallId, { call: digest([event.toolName, event.args]) });
  }
  toolEnd(event: ToolExecutionEndEvent): void {
    const call = this.calls.get(event.toolCallId);
    // Include failed and nested calls, but not call IDs, timings or provider usage.
    if (call) call.result = digest([event.result.content, event.result.details, event.result.structuredContent, event.isError]);
  }
  finish(): AutoStopReason | undefined {
    if (!this.automatic) { this.reset(); return; }
    this.automatic = false;
    const signature = this.calls.size ? digest([...this.calls.values()]) : undefined;
    this.calls.clear();
    // Source insertion order is stable even when tool completions arrive in parallel.
    this.empty = signature === undefined ? this.empty + 1 : 0;
    this.repeated = signature !== undefined ? signature === this.previous ? this.repeated + 1 : 1 : 0;
    this.previous = signature;
    if (this.empty >= 5) return "no_tools";
    if (this.repeated >= 5) return "repeated_tools";
  }
}
