// Adapted from pi-background-jobs 0.1.3 src/types.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite adds PTY mode, creator ownership, input records and monotonic elapsed time.
export type JobMode = 'pipe' | 'pty';
export type JobState = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'timed_out';
export type CleanupState = 'not_required' | 'pending' | 'managed_scope_confirmed' | 'unconfirmed';
export type StopReason = 'user' | 'agent' | 'timeout' | 'log_limit' | 'quit' | 'start_aborted';
export type Stream = 'stdout' | 'stderr' | 'output' | 'input';
export type ProcessIdentity = { pid: number; createdAt: string };
export type Workspace = { root: string; key: string; hash: string };
export type ExitObservation = { code: number | null; signal: string | null; error?: string };
export type CleanupEvidence = {
  state: CleanupState; scope: ProcessIdentity[]; rootExited: boolean;
  taskkillExitCode?: number | null; error?: string;
};
/** Creation ownership used for cascading subagent stops; separate from display references. */
export type Creator = { agentId: string; runId: string; ancestors: string[] };
export type JobSummary = {
  schemaVersion: 1; id: string; workspace: Workspace;
  ownerRuntimeId: string; ownerSessionId: string; anchorEntryId: string | null;
  name: string; command: string; cwd: string; mode: JobMode;
  taskId?: string; creator?: Creator;
  state: JobState; createdAt: string; startedAt?: string; endedAt?: string; elapsedMs?: number;
  timeoutMs?: number; exitCode: number | null; signal?: string | null;
  stopReason?: StopReason; cleanup: CleanupEvidence;
  /** Launch, exit-observation or storage error; visible in list/read instead of being dropped. */
  error?: string; notified?: boolean;
};
export type StartRequest = {
  command: string; name?: string; cwd: string; mode?: JobMode; timeoutMs?: number; taskId?: string;
  ownerSessionId: string; anchorEntryId: string | null; creator?: Creator; cols?: number; rows?: number;
};
export type InputRecord = { at: string; source: 'model' | 'user' | 'parent'; kind: 'text' | 'keys' | 'paste'; text?: string; bytes: number; sensitive?: boolean };
export type StopResult = { job: JobSummary; requested: boolean };
export class JobError extends Error {
  code: string; jobId?: string;
  constructor(code: string, message: string, jobId?: string) {
    // The code leads the message because tool errors reach the model as text only.
    super(`${code}: ${message}`); this.name = 'JobError'; this.code = code; this.jobId = jobId;
  }
}
/** Node system error code, if the value carries one. */
export function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
export const LIMITS = {
  // timeoutMs is optional: an omitted timeout means no run-time limit.
  maxRunMs: 86400000,
  defaultReadBytes: 16384, maxReadBytes: 65536,
  jobLogBytes: 104857600, workspaceBytes: 1073741824,
  monitorMs: 1000, stopMs: 10000, quitMs: 10000, exitFallbackMs: 3000, termGraceMs: 250,
} as const;
