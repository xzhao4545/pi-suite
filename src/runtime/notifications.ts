import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SessionBinding } from "./binding.ts";

/** One delivery path for job, agent and goal wakeups; UI readers never send follow-ups. */
export class Notifications {
  private pending = new Map<string, Map<string, string>>();
  private blockers = new Set<symbol>();
  constructor(private pi: ExtensionAPI, private binding: SessionBinding) {}

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

  flush(): void {
    const active = this.binding.current;
    if (!active || this.blockers.size || !active.ctx.isIdle() || active.ctx.hasPendingMessages()) return;
    const messages = this.pending.get(active.sessionId);
    if (!messages?.size) return;
    this.pending.delete(active.sessionId);
    this.pi.sendMessage({ customType: "pi-suite:notification", content: [...messages.values()].join("\n"), display: true },
      { triggerTurn: true, deliverAs: "followUp" });
  }
}
