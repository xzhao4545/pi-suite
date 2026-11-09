import type { Theme } from '@earendil-works/pi-coding-agent';
import { executionRow } from '../../ui/dock/line.ts';
import { displayName, jobStatus, jobCompactStatus } from '../index.ts';
import type { JobSummary } from '../types.ts';

/** Lists and viewers protect the same domain-ordered state/time/cleanup metrics. */
export function jobRow(job: JobSummary, width: number, theme?: Theme): string {
  return executionRow(displayName(job), jobStatus(job), jobCompactStatus(job), width, theme);
}
