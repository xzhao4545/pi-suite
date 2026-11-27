import type { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { Execution } from './types.ts';

const RETRY = /upstream|interrupted|timed out|timeout|network|connection|socket hang up|ECONNRESET|fetch failed|overloaded|\b(?:429|5(?:\d{2}|xx))\b/i;
const EXCLUDE = /quota|billing|balance|usage limit|insufficient|unauthorized|\b(?:401|403)\b/i;

/** Keep the provider error separate from other diagnostics in the run's error field. */
export class ModelRequestError extends Error {
  constructor(readonly requestError: string, readonly retry: ReturnType<SettingsManager['getRetrySettings']>, diagnostics: string[] = []) {
    super([...diagnostics, requestError].join('; '));
  }
}

export function retryable(error: ModelRequestError): boolean {
  return error.retry.enabled && RETRY.test(error.requestError) && !EXCLUDE.test(error.requestError);
}

export function retrySuffix(run?: Execution): string | undefined {
  if (run?.record.state === 'queued' && run.retry) return ` · retry ${run.retry.attempt}/${run.retry.max}`;
}
