// Adapted from pi-background-jobs 0.1.3 src/state.ts (MIT). The exclusive-lock predicate is
// dropped with the workspace lock; "cancelled" is reported as "stopped".
import type { JobState, ExitObservation, StopReason, JobSummary } from './types.ts';
export function isTerminal(state: JobState): boolean {
  return !['starting', 'running', 'stopping'].includes(state);
}
/** A real exit observation settles the job; a stop reason only explains why it ended. */
export function settleExit(exit: ExitObservation, reason?: StopReason): JobState {
  if (reason === 'timeout') return 'timed_out';
  if (reason === 'log_limit') return 'failed';
  if (reason) return 'stopped';
  return exit.code === 0 && !exit.signal && !exit.error ? 'completed' : 'failed';
}
/** Active for status counts: unsettled, or settled while cleanup is still unproven. */
export function isActive(job: JobSummary): boolean {
  return !isTerminal(job.state) || job.cleanup.state === 'pending' || job.cleanup.state === 'unconfirmed' && !job.cleanup.rootExited;
}
/**
 * List bucket. Only jobs this Pi process controls can be active; a stored record without a
 * proven settlement (another process, or a crash) is "unsettled" and never counted as success.
 */
export function bucket(job: JobSummary, live: boolean): 'active' | 'finished' | 'unsettled' {
  if (live) return isActive(job) ? 'active' : 'finished';
  return isTerminal(job.state) && job.cleanup.state !== 'pending' && job.cleanup.state !== 'unconfirmed' ? 'finished' : 'unsettled';
}
