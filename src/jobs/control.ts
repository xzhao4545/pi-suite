import type { JobManager } from './manager.ts';

/** Reload protocol boundary: these operations use saved job data, never manager internals. */
export type JobReader = Pick<JobManager, 'peek' | 'get' | 'list' | 'logPath' | 'subscribe'> &
  Partial<Pick<JobManager, 'readTerminalSnapshot'>>;
export type JobControl = JobReader & Pick<JobManager, 'stop' | 'activeIds' | 'markNotified'> & Partial<Pick<JobManager, 'clear'>>;

/** Kept independently of the execution protocol so occupied runtimes remain controllable. */
export type ControlBridge =
  | { version: 1; jobs: JobControl; quit(): Promise<void> }
  | { version: 2; jobs: JobControl & Pick<JobManager, 'createdBy'>; quit(): Promise<void> }
  | { version: 3; jobs: JobControl & Pick<JobManager, 'createdBy' | 'sessionJobs'>; quit(): Promise<void> }
  | { version: 4; jobs: JobControl & Pick<JobManager, 'createdBy' | 'sessionJobs' | 'readTerminalSnapshot' | 'clear'>; quit(): Promise<void> };
