import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type { SessionBinding } from "./binding.ts";

/** One delivery path for job, agent and goal wakeups; UI readers never send follow-ups. */
type Source = "event" | "goal-continuation" | "reminder";
type Pending = { text: string; source: Source; delivered?: () => void };
type Segment = { requestId: string; source: Source };
type NotificationDetails = { notificationVersion: 1; segments: Segment[] };
/** Per-run questions keep the :ask suffix so goal admission uses the same shared queue. */
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
  enqueue(sessionId: string, id: string, text: string, delivered?: () => void, source: Source = "event"): void {
    let messages = this.pending.get(sessionId);
    if (!messages) this.pending.set(sessionId, messages = new Map());
    messages.set(id, { text, delivered, source });
    this.flush();
  }
  private take(sessionId: string): { content: TextContent[]; details: NotificationDetails } {
    const messages = this.pending.get(sessionId)!;
    this.pending.delete(sessionId);
    for (const message of messages.values()) message.delivered?.();
    // Provenance aligns with content blocks, avoiding a second persisted copy of event text.
    const events = [...messages].filter(([, message]) => message.source !== 'goal-continuation');
    // A real result/question already supplies the wake text. Goal still receives its
    // exactly-once delivery callback, without a redundant independent control block.
    const visible = events.length ? events : [...messages];
    const segments = visible.map(([requestId, message]) => ({ requestId, source: message.source }));
    return { content: visible.map(([, message]) => ({ type: "text", text: message.text })), details: { notificationVersion: 1, segments } };
  }

  /** Non-waking reminders use the same provenance envelope at a natural boundary. */
  reminder(requestId: string, text: string) {
    return { type: 'custom_message' as const, customType: 'pi-suite:notification', display: false,
      content: [{ type: 'text' as const, text }],
      details: { notificationVersion: 1, segments: [{ requestId, source: 'reminder' }] } satisfies NotificationDetails };
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const active = this.binding.current;
    if (!active || this.blockers.size || event.outcome !== "completed") return;
    // Existing host/extension work already has a runnable continuation. Leave our batch for
    // the next boundary instead of adding another request or changing its ordering.
    if (event.continue || event.context.pendingMessages.length) return;
    if (!this.admitted(active.sessionId)) return;
    return { continue: true, entries: [...event.entries, { type: "custom_message", customType: "pi-suite:notification",
      ...this.take(active.sessionId), display: false }] };
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
    const message = this.take(active.sessionId);
    this.pi.sendMessage({ customType: "pi-suite:notification", ...message,
      display: message.details.segments.some(segment => segment.source !== "goal-continuation") },
      { triggerTurn: true, deliverAs: "followUp" });
  }
}
