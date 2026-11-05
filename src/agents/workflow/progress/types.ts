// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/progress.ts (MIT).
/**
 * progress.ts — the workflow progress model, ported from Claude Code.
 *
 * Progress is an **append-only event log**, not a tree. Agent entries are keyed
 * by `index` and last-write-wins, so a running agent is updated by appending a
 * fresh entry with the same index rather than mutating anything. Every view —
 * the inline card, the workflows dialog, the fleet widget — derives its shape
 * by collapsing that log. Keeping the log authoritative is what lets a batched
 * update carry several agents' changes in one message from the worker.
 *
 * Two vocabularies, deliberately distinct:
 *   - entry `state` is only start | progress | done | error, with `skipped`,
 *     `blocked` and `cached` as separate booleans;
 *   - the display state adds queued, running, interrupted, skipped, blocked and
 *     failed, and is *derived* (see `displayState`).
 * Mixing them up is the easiest way to get the rendering wrong, which is why
 * the derivation lives here as one function rather than inline in each renderer.
 *
 * Everything in this file is pure and framework-free so the whole model is
 * unit-testable without a terminal.
 */

import type { WorkflowMeta, WorkflowPhaseMeta } from "../meta.ts";

/** Raw entry lifecycle, as written by the runtime. */
export type WorkflowEntryState = "start" | "progress" | "done" | "error";

/** Derived per-agent state, as rendered. */
export type WorkflowDisplayState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "blocked"
  | "interrupted";

/** Why an agent is on a later attempt, shown next to its row. */
export type AttemptReason = "throttled" | "user-retry" | "stalled";

export interface WorkflowPhaseEntry {
  type: "workflow_phase";
  index: number;
  title: string;
}

export interface WorkflowLogEntry {
  type: "workflow_log";
  message: string;
}

export interface WorkflowAgentEntry {
  type: "workflow_agent";
  /** Stable identity. Re-emitting this index replaces the previous entry. */
  index: number;
  label: string;
  /**
   * Absent when the agent ran before any `phase()` call. That is the signal —
   * not a default of 0 — that turns the whole run into one "Agents" group.
   */
  phaseIndex?: number;
  phaseTitle?: string;
  state: WorkflowEntryState;
  agentId?: string;
  /**
   * The manager's `AgentRecord` id, once the child has one.
   *
   * Distinct from {@link agentId}, which is the run's own `wf-agent-N` handle
   * and means nothing outside the runtime. This is what the inspector's `c`
   * key opens a conversation viewer on, so it is reported the moment the
   * manager issues it rather than with the effective model — a child that dies
   * before its session resolves still has a conversation worth reading.
   */
  recordId?: string;
  gateJobId?: string;
  agentType?: string;
  /**
   * Short model label for tight rows, e.g. `haiku 4.5`.
   *
   * Seeded from what the script asked for and then REPLACED by what the child
   * actually ran on, once its session exists to report one — the same
   * effective-not-requested rule every other subagent surface follows (#168).
   * An `agent()` that named no model therefore starts blank and fills in.
   */
  model?: string;
  /** Canonical `provider/model-id`, for the dialog, which has room for it. */
  modelId?: string;
  /** The level actually in effect, once the child's session reports one. */
  thinking?: string;
  /**
   * What the call asked for, kept only when it did not get it — pi clamped the
   * level, or an agent file's frontmatter outranked the option (#182). Rendered
   * as `(asked max)` beside the effective value rather than silently replacing
   * it.
   */
  requestedThinking?: string;
  requestedModel?: string;
  fallbackModel?: string;
  error?: string;
  skipped?: boolean;
  blocked?: boolean;
  cached?: boolean;
  queuedAt?: number;
  startedAt?: number;
  lastProgressAt?: number;
  attempt?: number;
  lastAttemptReason?: AttemptReason;
  promptPreview?: string;
  resultPreview?: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}

export type WorkflowEntry = WorkflowPhaseEntry | WorkflowLogEntry | WorkflowAgentEntry;

/** Overall run status, mirroring the task record. */
export type WorkflowRunStatus = "running" | "completed" | "failed" | "killed" | "paused";

export interface CollapsedProgress {
  agents: WorkflowAgentEntry[];
  logs: string[];
  phaseTitles: Map<number, string>;
}

export interface PhaseGroup {
  title: string;
  status: "not-started" | "running" | "done" | "failed";
  agents: WorkflowAgentEntry[];
  doneCount: number;
  totalCount: number;
  tokens: number;
  durationMs: number;
}

export interface WorkflowStats {
  done: number;
  failedCount: number;
  running: boolean;
  total: number;
  started: number;
  complete: boolean;
}
