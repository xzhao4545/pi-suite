export type JobState = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
export type CleanupState = 'not_required' | 'pending' | 'managed_scope_confirmed' | 'unconfirmed';
export type StopReason = 'user' | 'timeout' | 'log_limit' | 'quit' | 'start_aborted';
export type ProcessIdentity = { pid: number; createdAt: string };
export type Workspace = { root: string; key: string; hash: string };
export type ExitObservation = { code: number | null; signal: string | null; error?: string };
export type CleanupEvidence = {
  state: CleanupState; scope: ProcessIdentity[]; rootExited: boolean;
  taskkillExitCode?: number | null; error?: string;
};
export type JobSummary = {
  schemaVersion: 1; jobId: string; workspace: Workspace;
  ownerRuntimeId: string; ownerSessionId: string;
  name: string; command: string; cwd: string;
  state: JobState; exclusive: boolean; holdsLock: boolean;
  createdAt: string; startedAt?: string; endedAt?: string;
  timeoutSeconds: number; exitCode: number | null;
  stopReason?: StopReason; cleanup: CleanupEvidence;
  stdoutPath: string; stderrPath: string;
  storageError?: string; notificationError?: string; history: boolean;
};
export type JobDiagnostic = {
  source: 'history' | 'persistence'; code: string; message: string;
  location?: string; runtimeId?: string; jobId?: string;
  pending?: boolean; attempts?: number; nextRetryAt?: string;
};
export type JobListReport = { jobs: JobSummary[]; diagnostics: JobDiagnostic[] };
export type StartRequest = {
  command: string; name?: string; cwd: string; ownerSessionId: string;
  timeoutSeconds?: number; exclusive?: boolean;
};
export type LogRequest = { stream: 'stdout' | 'stderr'; offset?: number; tail?: boolean; limitBytes?: number };
export type LogPage = { text: string; offset: number; nextOffset: number; endOfLog: boolean; stream: 'stdout' | 'stderr'; warnings: string[] };
export type WaitResult = { completed: JobSummary[]; pending: string[]; timedOut: boolean };
export type StopResult = { job: JobSummary; requested: boolean; warnings: string[] };
export class JobError extends Error {
  code: string; jobId?: string;
  constructor(code: string, message: string, jobId?: string) {
    super(message); this.name = 'JobError'; this.code = code; this.jobId = jobId;
  }
}
export const LIMITS = {
  defaultRunSeconds: 1800, maxRunSeconds: 86400,
  defaultReadBytes: 16384, maxReadBytes: 65536,
  jobLogBytes: 104857600, workspaceBytes: 1073741824,
  monitorMs: 1000, stopMs: 10000, quitMs: 10000, exitFallbackMs: 3000,
} as const;
