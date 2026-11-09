import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { DisplayMode } from "../runtime/config.ts";
import type { Dock, DockRow } from "./dock.ts";
import type { DisplayText } from './browser-chrome.ts';

export class StatusPublisher {
  private ui?: ExtensionUIContext;
  private previous = new Map<string, string | undefined>();
  private goal?: string;
  private agents = new Set<string>();
  private jobs = new Set<string>();
  private details: Record<'agents' | 'jobs', DockRow[]> = { agents: [], jobs: [] };
  private asides: Record<'agents' | 'jobs', DisplayText> = { agents: '', jobs: '' };
  private ownsGoal = true;
  private modes: Record<"goal" | "agents" | "jobs", DisplayMode> = { goal: "status", agents: "status", jobs: "status" };

  constructor(private dock: Dock) {
    dock.register("goal", { title: "Goal", rows: () => this.modes.goal === "dock" && this.goal
      ? [{ id: "goal", text: this.goal, priority: 90 }] : [] });
    for (const key of ["agents", "jobs"] as const) dock.register(key, { title: key === 'agents' ? 'Agents' : 'Jobs', rows: () => [
      // Counts are summaries, not object identities that a viewer can open.
      ...(this.modes[key] === "dock" && this[key].size && !this.asides[key].length ? [{ id: key, text: `${this[key].size} active`, priority: 70, selectable: false }] : []),
      ...(this.modes[key] === 'hidden' ? [] : this.details[key]),
    ], aside: () => this.asides[key] });
  }

  bind(ui: ExtensionUIContext, modes: typeof this.modes, ownsGoal = true): void {
    this.detach(); this.ui = ui; this.modes = modes; this.ownsGoal = ownsGoal; this.previous.clear(); this.flush();
  }
  detach(): void {
    if (this.ownsGoal) this.ui?.setStatus("goal", undefined);
    this.ui?.setStatus("pi-suite:runtime", undefined);
    this.ui = undefined;
    this.goal = undefined; this.agents.clear(); this.jobs.clear();
    this.details = { agents: [], jobs: [] }; this.asides = { agents: '', jobs: '' };
    this.dock.setStatusRow(false);
  }
  setGoal(text?: string): void {
    if (text === this.goal) return;
    this.goal = text; this.flush();
  }
  get goalVisible(): boolean { return Boolean(this.ui && this.modes.goal !== 'hidden'); }
  detailsVisible(kind: 'agents' | 'jobs'): boolean { return Boolean(this.ui && this.modes[kind] !== 'hidden'); }
  setActivities(kind: "agents" | "jobs", ids: Iterable<string>, details: DockRow[] = [], aside: DisplayText = ''): void {
    const next = new Set(ids), previousSize = this[kind].size;
    this[kind] = next;
    const changed = JSON.stringify(details) !== JSON.stringify(this.details[kind]) || JSON.stringify(aside) !== JSON.stringify(this.asides[kind]);
    this.details[kind] = details; this.asides[kind] = aside;
    // Footer counts do not tick; live row metrics and state counts only redraw Dock.
    if (next.size !== previousSize) this.flush();
    else if (changed && this.modes[kind] !== 'hidden') this.dock.invalidate();
  }

  private flush(): void {
    const goal = this.modes.goal === "status" ? this.goal : undefined;
    const runtime = (["agents", "jobs"] as const).filter(key => this.modes[key] === "status" && this[key].size)
      .map(key => `${key === "agents" ? "🤖" : "⚙"}${this[key].size}`).join(" · ") || undefined;
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
