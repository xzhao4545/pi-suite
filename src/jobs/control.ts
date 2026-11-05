import type { JobManager } from './manager.ts';

/** Reload protocol boundary: these operations use saved job data, never manager internals. */
export type JobReader = Pick<JobManager, 'peek' | 'get' | 'list' | 'logPath' | 'subscribe'>;
export type JobControl = JobReader & Pick<JobManager, 'stop' | 'activeIds' | 'markNotified'>;

/** Kept independently of the execution protocol so occupied runtimes remain controllable. */
export type ControlBridge =
  | { version: 1; jobs: JobControl; quit(): Promise<void> }
  | { version: 2; jobs: JobControl & Pick<JobManager, 'createdBy'>; quit(): Promise<void> };
