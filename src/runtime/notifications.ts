import type { AgentBeforeSettleEvent, BoundaryResult, ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";
import type { SessionBinding } from "./binding.ts";
type AgentMessage = ContextEvent["messages"][number];

/** One delivery path for job, agent and goal wakeups; UI readers never send follow-ups. */
type Source = "event" | "goal-continuation";
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
    const segments = [...messages].map(([requestId, message]) => ({ requestId, source: message.source }));
    return { content: [...messages.values()].map(message => ({ type: "text", text: message.text })), details: { notificationVersion: 1, segments } };
  }

  /** Keep one current control signal, but every real event in a mixed delivery. */
  project(messages: AgentMessage[], goalRequestId?: string): AgentMessage[] {
    let keptControl = false;
    const result: AgentMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const details = message.role === "custom" && message.customType === "pi-suite:notification" ?
        message.details as NotificationDetails | undefined : undefined;
      // Legacy batches have no segment provenance: never infer it from their text.
      if (message.role !== "custom" || details?.notificationVersion !== 1) { result.push(message); continue; }
      if (!Array.isArray(message.content) || !Array.isArray(details.segments) || details.segments.length !== message.content.length ||
        details.segments.some(segment => !segment || typeof segment.requestId !== "string" ||
          !["event", "goal-continuation"].includes(segment.source))) throw new Error("Invalid pi-suite notification segments");
      const segments: Segment[] = [];
      const content = message.content.filter((_block, index) => {
        const segment = details.segments[index];
        if (segment.source === "goal-continuation") {
          if (keptControl || segment.requestId !== goalRequestId) return false;
          keptControl = true;
        }
        segments.push(segment); return true;
      });
      if (content.length) result.push(content.length === message.content.length ? message : { ...message, content, details: { ...details, segments } });
    }
    return result.reverse();
  }

  beforeSettle(event: AgentBeforeSettleEvent): BoundaryResult | undefined {
    const active = this.binding.current;
    if (!active || this.blockers.size || event.outcome !== "completed") return;
    // Existing host/extension work already has a runnable continuation. Leave our batch for
    // the next boundary instead of adding another request or changing its ordering.
    if (event.continue || event.context.pendingMessages.length) return;
    if (!this.admitted(active.sessionId)) return;
    return { continue: true, entries: [{ type: "custom_message", customType: "pi-suite:notification",
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
    this.pi.sendMessage({ customType: "pi-suite:notification", ...this.take(active.sessionId), display: true },
      { triggerTurn: true, deliverAs: "followUp" });
  }
}
