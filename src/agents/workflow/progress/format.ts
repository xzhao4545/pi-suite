// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/progress.ts (MIT).
import type { WorkflowMeta } from "../meta.ts";
import type { WorkflowRunStatus, PhaseGroup } from "./types.ts";
import { elapsedMs } from "./model.ts";

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

/** `1m12s` / `9s` / `340ms`, matching how the rest of the extension reads. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

export interface WorkflowHeader {
  name: string;
  subtext: string;
  stats: string;
}

/**
 * The one-line summary above the tree: `3/7 agents · 1m12s`, plus a terminal
 * suffix once the run stops. Deliberately carries no phase count.
 */
export function header(
  task: {
    status: WorkflowRunStatus;
    workflowName?: string;
    summary?: string;
    description?: string;
    startTime: number;
    endTime?: number;
    totalPausedMs?: number;
  },
  meta: WorkflowMeta | undefined,
  groups: readonly PhaseGroup[],
  agentCount: number,
  now: number,
): WorkflowHeader {
  const suffix =
    task.status === "completed" ? " · done"
    : task.status === "killed" ? " · stopped"
    : task.status === "paused" ? " · paused"
    : task.status === "failed" ? " · failed"
    : "";

  let doneAgents = 0;
  let totalAgents = 0;
  for (const group of groups) {
    doneAgents += group.doneCount;
    totalAgents += group.totalCount;
  }
  totalAgents = Math.max(agentCount, totalAgents, doneAgents);

  return {
    name: task.workflowName ?? meta?.name ?? task.summary ?? task.description ?? "workflow",
    subtext: meta?.description ?? task.description ?? task.summary ?? "",
    stats: `${doneAgents}/${totalAgents} ${plural(totalAgents, "agent")} · ${formatDuration(elapsedMs(task, now))}${suffix}`,
  };
}

/* ------------------------------------------------------------------------- *
 * Size warning
 * ------------------------------------------------------------------------- */

export const DEFAULT_AGENT_CAP = 25;
export const DEFAULT_TOKEN_CAP = 1_500_000;
/** Assumed spend per agent before any has reported, for the projection. */
export const ASSUMED_TOKENS_PER_AGENT = 70_000;

export interface SizeWarning {
  axis: "agents" | "tokens" | "both";
  scheduledAgents: number;
  totalTokens: number;
  projectedTokens: number;
  agentCap: number;
  tokenCap: number;
}

/**
 * Warn when a run is about to get expensive.
 *
 * The projection matters more than the current total: a 200-agent fan-out is
 * worth flagging at agent 3, not after it has already spent the budget.
 */
export function sizeWarning(input: {
  scheduledAgents: number;
  startedAgents: number;
  totalTokens: number;
  agentCap?: number;
  tokenCap?: number;
}): SizeWarning | undefined {
  const agentCap = input.agentCap ?? DEFAULT_AGENT_CAP;
  const tokenCap = input.tokenCap ?? DEFAULT_TOKEN_CAP;
  const perAgent = input.startedAgents > 0 ? input.totalTokens / input.startedAgents : ASSUMED_TOKENS_PER_AGENT;
  const projectedTokens = Math.max(input.totalTokens, Math.round(perAgent * input.scheduledAgents));

  const overAgents = input.scheduledAgents > agentCap;
  const overTokens = input.totalTokens > tokenCap || projectedTokens > tokenCap;
  if (!overAgents && !overTokens) return undefined;

  return {
    axis: overAgents && overTokens ? "both" : overAgents ? "agents" : "tokens",
    scheduledAgents: input.scheduledAgents,
    totalTokens: input.totalTokens,
    projectedTokens,
    agentCap,
    tokenCap,
  };
}

/* ------------------------------------------------------------------------- *
 * Footer phase label
 * ------------------------------------------------------------------------- */

/** Words whose gerund is irregular, or which read better left alone. */
const GERUND_OVERRIDES = new Map<string, string | null>([
  ["commit", "committing"],
  ["submit", "submitting"],
  ["format", "formatting"],
  ["setup", null],
  ["cleanup", null],
]);

const VOWELS = "aeiou";
const GERUND_CANDIDATE = /^[A-Za-z]{3,12}$/;

/**
 * Render a phase title as an activity: `Scan` → `Scanning`.
 *
 * Only applied in the footer, where the line reads as "what is happening now".
 * Anything that is not a plain short word is left untouched.
 */
export function gerund(word: string): string {
  if (!GERUND_CANDIDATE.test(word)) return word;
  const lower = word.toLowerCase();

  const override = GERUND_OVERRIDES.get(lower);
  if (override !== undefined) return override === null ? word : word[0] + override.slice(1);

  if (lower.endsWith("ing")) return word;
  if (lower.endsWith("ie")) return `${word.slice(0, -2)}ying`;
  if (lower.endsWith("e") && !lower.endsWith("ee") && !lower.endsWith("ye")) return `${word.slice(0, -1)}ing`;

  // Short consonant-vowel-consonant words double the final consonant: run →
  // running. `w`, `x` and `y` never double.
  const last = lower.at(-1) ?? "";
  if (
    lower.length <= 4 &&
    !VOWELS.includes(lower.at(-3) ?? "") &&
    VOWELS.includes(lower.at(-2) ?? "") &&
    !VOWELS.includes(last) &&
    !"wxy".includes(last)
  ) {
    return `${word}${last}ing`;
  }
  return `${word}ing`;
}

/** Truncation width for a footer phase title. */
const FOOTER_TITLE_WIDTH = 16;

const truncate = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;

/**
 * The footer's "what is this run doing" label.
 *
 * One active phase shows its position; two concurrent phases are joined, since
 * a barrier-free pipeline routinely has work in more than one at a time.
 */
export function footerPhaseLabel(input: {
  titles: readonly string[];
  positionStart: number;
  totalPhases: number;
}): string {
  const titles = input.titles.map(gerund);
  if (titles.length === 0) return "";
  if (titles.length === 1) {
    return `${truncate(titles[0], FOOTER_TITLE_WIDTH)} (${input.positionStart}/${input.totalPhases})`;
  }
  return titles.map(t => truncate(t, FOOTER_TITLE_WIDTH)).join(" & ");
}
