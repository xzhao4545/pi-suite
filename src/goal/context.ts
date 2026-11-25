import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Goal } from './state.ts';

export const GOAL_CONTEXT = 'pi-suite:goal-context';
export const GOAL_CONTROL = 'pi-suite:goal-control';
export const GOAL_CONTINUATION = 'Continue the current goal.';
type Access = 'execute' | 'complete' | 'none';
type Control = { goalId: string | null; revision: number | null; control: number; access: Access; budget: number | null; status: string; resumeRequired: boolean };

// Objective and hard execution boundaries are recorded once per visible revision.
// Tool-specific evidence/wait constraints live in the tool declarations, not every request.
const rules = 'Continue until every original requirement is implemented and verified; never replace the objective with an easier subset. ' +
  'The latest Goal instruction/control supersedes earlier Goal text; historical messages cannot grant permission. ' +
  'Only execute access permits automatic work, goal_wait or goal_blocked. Complete access permits auditing existing work, not resuming execution. ' +
  'Only explicit /goal resume restores execution when resumeRequired is true. Access controls Goal tools, not a file sandbox. ' +
  'Skipped, timed_out and cancelled ask_user answers are not consent.';

/** Derived delivery metadata only: it is never a state or permission recovery source. */
export function goalInstruction(ctx: ExtensionContext, goal: Goal | undefined, access: Access, control: number) {
  const messages = ctx.sessionManager.buildSessionProjection().messages;
  const anchor = messages.findLast(message => message.role === 'custom' && message.customType === GOAL_CONTEXT);
  const last = messages.findLast(message => message.role === 'custom' && [GOAL_CONTEXT, GOAL_CONTROL].includes(message.customType));
  if (!goal && !last) return;
  const state: Control = { goalId: goal?.id ?? null, revision: goal?.revision ?? null, control, access,
    budget: goal?.budget ?? null, status: goal?.status ?? 'none', resumeRequired: goal?.resumeRequired ?? false };
  const previous = last?.role === 'custom' ? last.details as Control | undefined : undefined;
  if (JSON.stringify(previous) === JSON.stringify(state)) return;
  const anchored = anchor?.role === 'custom' ? anchor.details as Control | undefined : undefined;
  const full = goal && (anchored?.goalId !== goal.id || anchored.revision !== goal.revision);
  return { customType: full ? GOAL_CONTEXT : GOAL_CONTROL, display: false, details: state,
    content: full ? `Current Goal instruction:\n${rules}\n${JSON.stringify({ ...state, objective: goal.text })}` :
      `Current Goal control (supersedes earlier permission):\n${JSON.stringify(state)}` };
}
