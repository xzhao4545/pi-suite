import type { SessionBinding } from '../runtime/binding.ts';
import type { WaitRegistry } from '../runtime/wait.ts';
import { ToolError } from '../runtime/errors.ts';
import type { Goal } from './state.ts';

/** Own only the deadline/subscription. GoalManager owns lifecycle, permission and persistence. */
export class GoalWaitResources {
  private timer?: NodeJS.Timeout;
  private watch?: () => void;
  constructor(private binding: SessionBinding, private waits: WaitRegistry) {}
  disarm(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.watch?.(); this.watch = undefined;
  }
  private done(ids: string[]): boolean {
    // After restart history-only objects cannot settle in this process. Only those explicit
    // registry errors release the wait; unexpected failures remain visible.
    const states = ids.map(id => {
      try { return this.waits.settlement(id); }
      catch (error) { if (error instanceof ToolError) return undefined; throw error; }
    });
    return states.every(state => !state || state.settled) || states.some(state => state?.question);
  }
  arm(goal: Goal | undefined, wake: () => void): void {
    this.disarm();
    const captured = this.binding.current;
    if (!captured || goal?.status !== 'active' || !goal.automatic || goal.waiting !== 'jobs') return;
    const revision = goal.revision;
    const resume = () => {
      if (this.binding.isCurrent(captured) && goal.revision === revision && goal.status === 'active' && goal.automatic && goal.waiting === 'jobs') wake();
    };
    if (goal.resumeAt) this.timer = setTimeout(resume, Math.max(0, goal.resumeAt - Date.now()));
    if (!goal.waitFor) return;
    // Disabled modules have no active registry and cannot hold the goal indefinitely.
    const ids = goal.waitFor.filter(id => this.waits.has(id));
    if (this.done(ids)) { resume(); return; }
    this.watch = this.waits.watch(ids, () => { if (this.done(ids)) resume(); });
  }
}
