import { goalDuration, goalStateLabels, goalUserState, pauseLabels, type Goal, type Schedule } from './state.ts';

export const GOAL_RESUME = 'pi-suite:goal-resume';
export type ResumeDetails = { resumeVersion: 1; text: string };
/** Display-only data has no model contract and can be read after the live goal changes. */
export function goalDetails(goal: Goal, schedule: Schedule, elapsedMs: number): string {
  const reason = goal.reason;
  const wait = goal.waiting ? goal : reason?.wait;
  return `# ${goal.text}\n\nStatus: ${goalStateLabels[goalUserState(goal, schedule)]}` +
    `${reason ? `\n\nReason: ${pauseLabels[reason.kind]}${reason.previous ? ` (${reason.previous})` : ''}` : ''}\n\nID: ${goal.id} · Revision: ${goal.revision}\n\n` +
    `Tokens: ${goal.usedTokens}${goal.budget ? `/${goal.budget}` : ' (no limit)'} · Turns: ${goal.turns} · Active elapsed: ${goalDuration(elapsedMs)}\n\n` +
    `Progress: ${goal.progress || 'not yet recorded'}${goal.error ? `\n\nError: ${goal.error}` : ''}` +
    `${reason?.automaticStop ? `\n\nAutomatic pause: ${pauseLabels[reason.automaticStop]}` : ''}` +
    `${wait?.waiting ? `\n\nWaiting: ${wait.waiting}${wait.waitFor?.length ? ` · ${wait.waitFor.join(', ')}` : ''}${wait.resumeAt ? ` · until ${new Date(wait.resumeAt).toISOString()}` : ''}` : ''}`;
}
