import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { DisplayMode } from "../runtime/config.ts";
import type { Dock } from "./dock.ts";

export class StatusPublisher {
  private ui?: ExtensionUIContext;
  private previous = new Map<string, string | undefined>();
  private goal?: string;
  private agents = new Set<string>();
  private jobs = new Set<string>();
  private ownsGoal = true;
  private modes: Record<"goal" | "agents" | "jobs", DisplayMode> = { goal: "status", agents: "status", jobs: "status" };

  constructor(private dock: Dock) {
    dock.register("status", () => [
      ...(this.modes.goal === "dock" && this.goal ? [{ id: "goal", text: this.goal, priority: 90 }] : []),
      ...(["agents", "jobs"] as const).flatMap(key => this.modes[key] === "dock" && this[key].size
        ? [{ id: key, text: `${key} ${this[key].size}`, priority: 70 }] : []),
    ]);
  }

  bind(ui: ExtensionUIContext, modes: typeof this.modes, ownsGoal = true): void {
    this.detach(); this.ui = ui; this.modes = modes; this.ownsGoal = ownsGoal; this.previous.clear(); this.flush();
  }
  detach(): void {
    if (this.ownsGoal) this.ui?.setStatus("goal", undefined);
    this.ui?.setStatus("pi-suite:runtime", undefined);
    this.ui = undefined;
    this.goal = undefined; this.agents.clear(); this.jobs.clear();
    this.dock.setStatusRow(false);
  }
  setGoal(text?: string): void {
    if (text === this.goal) return;
    this.goal = text; this.flush();
  }
  setActivities(kind: "agents" | "jobs", ids: Iterable<string>): void {
    const next = new Set(ids), previousSize = this[kind].size;
    this[kind] = next;
    // Both status and Dock display counts. Token updates and equal-sized identity
    // changes leave that projection unchanged and must not request another render.
    if (next.size !== previousSize) this.flush();
  }

  private flush(): void {
    const goal = this.modes.goal === "status" ? this.goal : undefined;
    const runtime = (["agents", "jobs"] as const).filter(key => this.modes[key] === "status" && this[key].size)
      .map(key => `${key} ${this[key].size}`).join(" · ") || undefined;
    for (const [key, text] of [["goal", goal], ["pi-suite:runtime", runtime]] as const) {
      // The goal key is shared with pi-goal; a disabled suite module does not own it.
      if (key === 'goal' && !this.ownsGoal) continue;
      if (!this.previous.has(key) || this.previous.get(key) !== text) {
        this.ui?.setStatus(key, text); this.previous.set(key, text);
      }
    }
    this.dock.setStatusRow(Boolean(goal || runtime));
  }
}
