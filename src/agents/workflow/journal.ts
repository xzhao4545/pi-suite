// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/journal.ts (MIT).
/**
 * journal.ts — the record a workflow run leaves so a later run can skip work.
 *
 * ## What resume actually buys
 *
 * The documented iteration loop is "edit the persisted script and re-run it".
 * Without a journal that re-pays every agent from scratch, which for a 40-agent
 * audit is the entire cost of the run — to change one line of the last stage.
 * With one, the unchanged prefix comes back from disk and only the edit runs.
 *
 * ## Why a *prefix*, and not a lookup table
 *
 * Each entry is keyed by both its position in the run and a hash of everything
 * that decides what that agent does. A replay walks positions in order and
 * stops reusing at the first entry that does not match — every call from there
 * on runs live. Reusing later matches out of order would be reusing a result
 * produced under different upstream conditions: the same prompt at position 12
 * of a *different* run is not the same work, because what fed it changed.
 *
 * A failed agent is journaled as a failure and never replayed as one. Resuming
 * a run that died at agent 5 exists to retry agent 5, so the prefix ends there
 * and 5 onwards run live — the alternative would make a failure permanent.
 *
 * ## Runs that use `agent({ resume })`
 *
 * Those are not replayed at all. A replayed agent is text from a file, not a
 * live child, so there is no conversation in this run for a later `resume` to
 * continue — and the id map that would find one belongs to the run that did
 * the spawning. Rather than replay a prefix that strands the first `resume`
 * call, a journal carrying one declines the whole cache and the run pays in
 * full. Coarse on purpose: the alternative is tracking which label each entry
 * ran under and capping the prefix below the earliest one that gets resumed,
 * which is a second key concept for a case that costs one run.
 *
 * ## Ordering under concurrency
 *
 * Positions are assigned as calls arrive, and with `pipeline` that order
 * depends on which agent finished first. A replay usually reproduces it, since
 * cached calls answer in journal order, but it is not guaranteed. That is why
 * the key is checked as well as the position: a run that interleaves
 * differently loses cache hits, it never returns another agent's answer.
 *
 * The file is JSON Lines, appended as each agent settles, so a run that is
 * killed mid-flight still leaves everything it had finished.
 */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

/** One settled agent call, as replayed. */
export interface WorkflowJournalEntry {
  /** Position in the run — the same counter that names `wf-agent-N`. */
  index: number;
  /** Hash of the call's payload; a mismatch ends the replayable prefix. */
  key: string;
  /** Whether the agent succeeded. A failure ends the prefix on replay. */
  ok: boolean;
  /** The agent's answer, when it had one. */
  text?: string;
  /**
   * Whether the call continued an earlier child (`agent({ resume })`).
   *
   * A replayed agent leaves no session behind in the run that replays it — the
   * conversation belongs to the run that actually spawned it, and the host's
   * id map is per-run — so a later `resume` would have nothing to continue.
   * Recording it lets the next run decline to replay at all rather than fail
   * partway through, which is why the flag is on the journal and not derived.
   */
  resumed?: true;
}

/**
 * The fields that decide what an agent does.
 *
 * Deliberately not the whole payload: `phaseIndex` and `phaseTitle` move the
 * row around in the progress tree without changing a single token the agent
 * sees, so re-grouping phases should not throw away an hour of results.
 */
export interface JournalKeyInput {
  prompt: string;
  label?: string;
  model?: string;
  agentType?: string;
  effort?: string;
  gate?: string;
  resume?: string;
  /** Serialized `agent({ schema })`, when the call asked for one. */
  schema?: string;
}

/** Stable hash of a call's payload. Field order is fixed here, not by the caller. */
export function journalKey(input: JournalKeyInput): string {
  const canonical = JSON.stringify([
    input.prompt,
    input.label ?? null,
    input.model ?? null,
    input.agentType ?? null,
    input.effort ?? null,
    input.gate ?? null,
    input.resume ?? null,
    input.schema ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** A torn final append is reported separately; other corruption is an error. */
export function readJournal(path: string): { entries: WorkflowJournalEntry[]; truncated: boolean } {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n"), entries: WorkflowJournalEntry[] = [];
  const positions = new Set<number>();
  let truncated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch (error) {
      // A process may die during its last append. Only this suffix can be dropped,
      // and the caller receives a flag so a resumed run can report the partial journal.
      if (i === lines.length - 1 && !raw.endsWith("\n")) { truncated = true; break; }
      throw new Error(`Invalid workflow journal ${path}:${i + 1}: ${String(error)}`);
    }
    if (!isEntry(parsed) || positions.has(parsed.index)) throw new Error(`Invalid workflow journal entry ${path}:${i + 1}`);
    positions.add(parsed.index); entries.push(parsed);
  }
  entries.sort((a, b) => a.index - b.index);
  return { entries, truncated };
}

/** Persistence is part of the resume contract; the runtime reports append failures. */
export function appendJournal(path: string, entry: WorkflowJournalEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
}

function isEntry(value: unknown): value is WorkflowJournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.index) &&
    (entry.index as number) >= 0 &&
    typeof entry.key === "string" &&
    typeof entry.ok === "boolean" &&
    (entry.text === undefined || typeof entry.text === "string") &&
    (entry.resumed === undefined || entry.resumed === true)
  );
}
