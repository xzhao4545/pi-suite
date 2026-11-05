// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/progress.ts (MIT).
import type { WorkflowMeta, WorkflowPhaseMeta } from "../meta.ts";
import type { WorkflowEntry, WorkflowAgentEntry, CollapsedProgress, WorkflowDisplayState, PhaseGroup, WorkflowStats } from "./types.ts";

/**
 * Fold the event log into its latest state.
 *
 * Agent entries collapse by index (last write wins); logs accumulate in order;
 * phase titles are a lookup for grouping.
 */
export function collapse(progress: readonly WorkflowEntry[]): CollapsedProgress {
  const agents = new Map<number, WorkflowAgentEntry>();
  const logs: string[] = [];
  const phaseTitles = new Map<number, string>();

  for (const entry of progress) {
    if (entry.type === "workflow_agent") agents.set(entry.index, entry);
    else if (entry.type === "workflow_log") logs.push(entry.message);
    else phaseTitles.set(entry.index, entry.title);
  }

  return {
    agents: [...agents.values()].sort((a, b) => a.index - b.index),
    logs,
    phaseTitles,
  };
}

/**
 * Derive what to render for one agent.
 *
 * `workflowActive` is false once the run has stopped: anything still mid-flight
 * at that point was cut off rather than finished, hence "interrupted".
 */
export function displayState(entry: WorkflowAgentEntry, workflowActive: boolean): WorkflowDisplayState {
  if (entry.state === "done") return "done";
  if (entry.state === "error") {
    if (entry.skipped) return "skipped";
    if (entry.blocked) return "blocked";
    return "failed";
  }
  if (!workflowActive) return "interrupted";
  // Queued means accepted but never given a slot. An entry with no queuedAt at
  // all predates the semaphore and is treated as running.
  return entry.queuedAt != null && entry.startedAt == null ? "queued" : "running";
}

/** True while an entry is still expected to change. */
export function isLive(entry: WorkflowAgentEntry): boolean {
  return entry.state === "start" || entry.state === "progress";
}

/** Bucket agents by phase. Returns null when no agent declared a phase. */
function groupByPhase(
  agents: readonly WorkflowAgentEntry[],
  phaseTitles: Map<number, string>,
): { phaseIndex: number; title: string; agents: WorkflowAgentEntry[] }[] | null {
  if (!agents.some(a => a.phaseIndex != null)) return null;

  const byPhase = new Map<number, { phaseIndex: number; title: string; agents: WorkflowAgentEntry[] }>();
  for (const agent of agents) {
    const phaseIndex = agent.phaseIndex ?? 0;
    let group = byPhase.get(phaseIndex);
    if (!group) {
      group = { phaseIndex, title: phaseTitles.get(phaseIndex) ?? `Phase ${phaseIndex}`, agents: [] };
      byPhase.set(phaseIndex, group);
    }
    group.agents.push(agent);
  }
  return [...byPhase.values()].sort((a, b) => a.phaseIndex - b.phaseIndex);
}

/** Roll a phase's agents up into the counts and totals its header shows. */
function summarize(group: { title: string; agents: WorkflowAgentEntry[] }): PhaseGroup {
  let done = 0;
  let failed = 0;
  let tokens = 0;
  let minStart = Number.POSITIVE_INFINITY;
  let maxProgress = 0;

  for (const agent of group.agents) {
    if (agent.state === "done") done++;
    else if (agent.state === "error") failed++;
    if (agent.tokens) tokens += agent.tokens;
    if (agent.startedAt != null) {
      if (agent.startedAt < minStart) minStart = agent.startedAt;
      const last = agent.lastProgressAt ?? agent.startedAt;
      if (last > maxProgress) maxProgress = last;
    }
  }

  const total = group.agents.length;
  const finished = done + failed === total && total > 0;
  return {
    title: group.title,
    status: finished ? (failed > 0 ? "failed" : "done") : "running",
    agents: group.agents,
    doneCount: done,
    totalCount: total,
    tokens,
    // Wall-clock across the phase, not the sum of its agents: they overlap.
    durationMs: minStart < Number.POSITIVE_INFINITY ? maxProgress - minStart : 0,
  };
}

/** A phase declared in `meta` that has not produced any agent yet. */
function placeholder(title: string): PhaseGroup {
  return { title, status: "not-started", agents: [], doneCount: 0, totalCount: 0, tokens: 0, durationMs: 0 };
}

const normalizeTitle = (title: string) => title.toLowerCase().trim();

/**
 * Reconcile the phases declared in `meta` with the phases actually observed.
 *
 * Matching is fuzzy on purpose: a script may call `phase("Review")` against a
 * declared `{ title: "Review changed files" }`, and Claude Code treats those as
 * the same phase when either title is a prefix of the other. Each observed
 * group is consumed at most once, declared-but-unseen phases render as
 * not-started placeholders, and observed groups with no declaration are
 * appended after — that is how an undeclared `phase()` "gets its own group".
 */
function mergePhases(
  declared: readonly WorkflowPhaseMeta[] | undefined,
  observed: { phaseIndex: number; title: string; agents: WorkflowAgentEntry[] }[],
): PhaseGroup[] {
  const consumed = new Set<{ phaseIndex: number; title: string; agents: WorkflowAgentEntry[] }>();
  const merged: PhaseGroup[] = [];

  for (const phase of declared ?? []) {
    const wanted = normalizeTitle(phase.title);
    const match = observed.find(group => {
      if (consumed.has(group)) return false;
      const actual = normalizeTitle(group.title);
      return actual === wanted || actual.startsWith(wanted) || wanted.startsWith(actual);
    });
    if (match) {
      consumed.add(match);
      merged.push(summarize(match));
    } else {
      merged.push(placeholder(phase.title));
    }
  }

  for (const group of observed) {
    if (!consumed.has(group)) merged.push(summarize(group));
  }

  return merged;
}

/**
 * Build the phase groups a renderer walks.
 *
 * When nothing declared or emitted a phase, every agent collapses into a single
 * group titled "Agents" so the tree still has one level of structure.
 */
export function buildPhaseGroups(
  progress: readonly WorkflowEntry[],
  declared?: readonly WorkflowPhaseMeta[],
): PhaseGroup[] {
  const { agents, phaseTitles } = collapse(progress);
  const observed = groupByPhase(agents, phaseTitles) ?? [];
  const merged = mergePhases(declared, observed);
  if (merged.length === 0 && agents.length > 0) {
    return [summarize({ title: "Agents", agents })];
  }
  // A run that declared phases but produced un-phased agents would otherwise
  // render placeholders and drop those agents from the tree entirely. Claude
  // Code has the same hole; showing the work is worth the small divergence.
  if (agents.length > 0 && !merged.some(group => group.totalCount > 0)) {
    return [...merged, summarize({ title: "Agents", agents })];
  }
  return merged;
}

/**
 * Aggregate counts for the header line.
 *
 * `agentCount` is the number the runtime has *scheduled*, which can exceed the
 * number that has emitted an entry — a fan-out reports its size before its
 * agents start, so the total does not visibly climb as they trickle in.
 */
export function stats(progress: readonly WorkflowEntry[], agentCount = 0): WorkflowStats {
  let seen = 0;
  let done = 0;
  let failed = 0;
  let started = 0;
  let anyLive = false;

  // The log holds an entry per transition (queued, started, progress, settled);
  // only each agent's latest one describes it.
  for (const entry of collapse(progress).agents) {
    seen++;
    if (entry.state === "done") {
      done++;
      started++;
    } else if (entry.state === "error") {
      failed++;
      started++;
    } else {
      anyLive = true;
      // Counted as started unless it is provably still waiting for a slot.
      if (entry.startedAt !== undefined || entry.queuedAt === undefined) started++;
    }
  }

  const total = Math.max(agentCount, seen);
  return {
    done,
    failedCount: failed,
    running: anyLive,
    total,
    started,
    // `!anyLive` is implied by the count test — `total >= seen`, and `seen` also
    // counts live entries, so `done + failed >= total` can only hold when none
    // are live. Kept for parity with Claude Code and as a guard should `total`
    // ever stop deriving from `seen`; no test can reach it as written.
    complete: !anyLive && seen > 0 && done + failed >= total,
  };
}

/** Elapsed run time, excluding any time spent paused. */
export function elapsedMs(
  task: { startTime: number; endTime?: number; totalPausedMs?: number },
  now: number,
): number {
  return Math.max(0, (task.endTime ?? now) - task.startTime - (task.totalPausedMs ?? 0));
}
