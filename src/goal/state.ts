import type { AutoStopReason } from './activity.ts';

export type GoalLifecycle = 'active' | 'paused' | 'completed';
export type PauseKind = 'manual' | 'blocked' | 'request_failed' | 'budget' | AutoStopReason | 'shutdown' | 'startup' | 'cancelled' | 'compaction_failed' | 'historical_stop' | 'permission';
const explicitResumeKinds = new Set<PauseKind>(['manual', 'budget', 'shutdown', 'startup', 'historical_stop', 'permission']);
export function requiresExplicitResume(kind: PauseKind): boolean { return explicitResumeKinds.has(kind); }
export type GoalWait = { waiting: 'user' | 'jobs'; resumeAt?: number; waitFor?: string[] };
export type PauseReason = { kind: PauseKind; previous?: string; automaticStop?: AutoStopReason; wait?: GoalWait };
export interface Goal {
  id: string; revision: number; text: string; status: GoalLifecycle;
  automatic: boolean; reason?: PauseReason;
  budget?: number; usedTokens: number; elapsedMs: number; turns: number;
  progress: string; error?: string; completedAt?: number;
  waiting?: 'user' | 'jobs'; resumeAt?: number; waitFor?: string[];
}
export type Schedule = 'running' | 'waiting_user' | 'waiting_jobs' | 'waiting_host' | 'detached' | 'idle';
export type GoalUserState = 'running' | 'waiting' | 'paused' | 'completed';
export const goalStateLabels: Record<GoalUserState, string> = { running: '进行中', waiting: '等待中', paused: '已暂停', completed: '已完成' };
export const pauseLabels: Record<PauseKind, string> = {
  manual: 'Manually paused', blocked: 'External blocker', request_failed: 'Model request failed', budget: 'Token budget reached',
  no_tools: 'No tool activity', repeated_tools: 'Repeated tool activity', shutdown: 'Session ended', startup: 'Session restored',
  cancelled: 'Request cancelled', compaction_failed: 'Compaction failed', historical_stop: 'Historical stop', permission: 'Resume required',
};
/** Detached is a binding fact, not a fifth lifecycle. All UI uses this projection. */
export function goalUserState(goal: Goal, schedule: Schedule): GoalUserState {
  if (goal.status === 'completed') return 'completed';
  if (goal.status === 'paused' || !goal.automatic) return 'paused';
  return goal.waiting || schedule.startsWith('waiting_') ? 'waiting' : 'running';
}
export function goalDuration(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  const pair = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pair(minutes % 60)}:${pair(seconds % 60)}` : `${pair(minutes)}:${pair(seconds % 60)}`;
}
export function goalSummary(goal: Goal | undefined, schedule: Schedule, now = Date.now(), elapsedMs = goal?.elapsedMs ?? 0): string | undefined {
  if (!goal || schedule === 'detached' || goal.status === 'completed' && now >= (goal.completedAt ?? 0) + 5000) return;
  const icons: Record<GoalUserState, string> = { running: '🎯', waiting: '⏳', paused: '⏸', completed: '✅' };
  return `${icons[goalUserState(goal, schedule)]} goal ${goalDuration(elapsedMs)}`;
}
