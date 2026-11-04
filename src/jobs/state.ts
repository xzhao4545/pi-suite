import type { JobState, ExitObservation, StopReason, CleanupState } from './types.ts';
export function isTerminal(state: JobState): boolean {
  return !['starting', 'running', 'stopping'].includes(state);
}
export function settleExit(exit: ExitObservation, reason?: StopReason): JobState {
  if (reason === 'timeout') return 'timed_out';
  if (reason === 'log_limit') return 'failed';
  if (reason) return 'cancelled';
  return exit.code === 0 && !exit.signal && !exit.error ? 'completed' : 'failed';
}
export function canReleaseExclusive(rootExited: boolean, reason: StopReason | undefined, cleanup: CleanupState, knownResidual: boolean): boolean {
  if (!rootExited || knownResidual) return false;
  return reason === undefined ? cleanup === 'not_required' : cleanup === 'managed_scope_confirmed';
}
