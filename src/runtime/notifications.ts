import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionBinding } from "./binding.ts";

/** One delivery path for job, agent and goal wakeups; UI readers never send follow-ups. */
type Pending = { text: string; delivered?: () => void };
/** A child's question to its parent uses request ID `agent:<agentId>:ask` (agents/interaction.md). */
export const isQuestion = (requestId: string): boolean => requestId.startsWith("agent:") && requestId.endsWith(":ask");
export class Notifications {
  private pending = new Map<string, Map<string, Pending>>();
  private blockers = new Set<symbol>();
  private admission: (requestIds: string[]) => boolean = () => true;
  private idleTimer?: NodeJS.Timeout;
  constructor(private pi: ExtensionAPI, private binding: SessionBinding) {}
  /** Decides from the queued request IDs whether this batch may wake the model now. */
  setAdmission(admission: (requestIds: string[]) => boolean): void { this.admission = admission; }
  private admitted(sessionId: string): boolean {
    const messages = this.pending.get(sessionId);
    return Boolean(messages?.size) && this.admission([...messages!.keys()]);
  }

  cancel(sessionId: string, id: string): void { this.pending.get(sessionId)?.delete(id); }
  has(sessionId: string, id: string): boolean { return this.pending.get(sessionId)?.has(id) ?? false; }
  detach(): void { clearTimeout(this.idleTimer); this.idleTimer = undefined; }

  hold(): () => void {
    const token = Symbol();
    this.blockers.add(token);
    return () => { this.blockers.delete(token); this.flush(); };
  }

  /** delivered runs once the message has left the queue; a later enqueue under the same ID replaces it. */
  enqueue(sessionId: string, id: string, text: string, delivered?: () => void): void {
    let messages = this.pending.get(sessionId);
    if (!messages) this.pending.set(sessionId, messages = new Map());
    messages.set(id, { text, delivered });
    this.flush();
  }
  private take(sessionId: string): string {
    const messages = this.pending.get(sessionId)!;
    this.pending.delete(sessionId);
    for (const message of messages.values()) message.delivered?.();
    return [...messages.values()].map(message => message.text).join("\n");
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const active = this.binding.current;
    if (!active || this.blockers.size || event.outcome !== "completed") return;
    // Existing host/extension work already has a runnable continuation. Leave our batch for
    // the next boundary instead of adding another request or changing its ordering.
    if (event.continue || event.context.pendingMessages.length) return;
    if (!this.admitted(active.sessionId)) return;
    return { continue: true, entries: [{ type: "custom_message", customType: "pi-suite:notification",
      content: this.take(active.sessionId), display: false }] };
  }

  afterHostOperation(): void {
    this.detach();
    const captured = this.binding.current;
    if (!captured || !this.pending.get(captured.sessionId)?.size) return;
    // Pi 1.5.0 emits session_compact/session_tree before clearing their busy flags,
    // without public extension end callbacks. Only these operations need an idle check.
    const check = () => {
      if (!this.binding.isCurrent(captured)) return;
      if (captured.ctx.isIdle()) { this.idleTimer = undefined; this.flush(); }
      else this.idleTimer = setTimeout(check, 25);
    };
    this.idleTimer = setTimeout(check, 0);
  }

  flush(): void {
    const active = this.binding.current;
    if (!active || this.blockers.size || !active.ctx.isIdle() || active.ctx.hasPendingMessages()) return;
    if (!this.admitted(active.sessionId)) return;
    this.pi.sendMessage({ customType: "pi-suite:notification", content: this.take(active.sessionId), display: true },
      { triggerTurn: true, deliverAs: "followUp" });
  }
}
