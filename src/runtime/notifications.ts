import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionBinding } from "./binding.ts";

/** One delivery path for job, agent and goal wakeups; UI readers never send follow-ups. */
export class Notifications {
  private pending = new Map<string, Map<string, string>>();
  private blockers = new Set<symbol>();
  private admission = () => true;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private pi: ExtensionAPI, private binding: SessionBinding) {}
  setAdmission(admission: () => boolean): void { this.admission = admission; }

  cancel(sessionId: string, id: string): void { this.pending.get(sessionId)?.delete(id); }
  has(sessionId: string, id: string): boolean { return this.pending.get(sessionId)?.has(id) ?? false; }
  detach(): void { clearTimeout(this.idleTimer); this.idleTimer = undefined; }

  hold(): () => void {
    const token = Symbol();
    this.blockers.add(token);
    return () => { this.blockers.delete(token); this.flush(); };
  }

  enqueue(sessionId: string, id: string, text: string): void {
    let messages = this.pending.get(sessionId);
    if (!messages) this.pending.set(sessionId, messages = new Map());
    messages.set(id, text);
    this.flush();
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const active = this.binding.current;
    if (!active || this.blockers.size || !this.admission() || event.outcome !== "completed") return;
    // Existing host/extension work already has a runnable continuation. Leave our batch for
    // the next boundary instead of adding another request or changing its ordering.
    if (event.continue || event.context.pendingMessages.length) return;
    const messages = this.pending.get(active.sessionId);
    if (!messages?.size) return;
    this.pending.delete(active.sessionId);
    return { continue: true, entries: [{ type: "custom_message", customType: "pi-suite:notification",
      content: [...messages.values()].join("\n"), display: false }] };
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
    if (!active || this.blockers.size || !this.admission() || !active.ctx.isIdle() || active.ctx.hasPendingMessages()) return;
    const messages = this.pending.get(active.sessionId);
    if (!messages?.size) return;
    this.pending.delete(active.sessionId);
    this.pi.sendMessage({ customType: "pi-suite:notification", content: [...messages.values()].join("\n"), display: true },
      { triggerTurn: true, deliverAs: "followUp" });
  }
}
