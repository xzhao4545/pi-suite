import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Goal } from './state.ts';

export const GOAL_CONTEXT = 'pi-suite:goal-context';
export const GOAL_CONTROL = 'pi-suite:goal-control';
export const GOAL_CONTINUATION = 'Continue the current goal.';
type Access = 'execute' | 'complete' | 'none';
type Control = { goalId: string | null; revision: number | null; control: number; access: Access; budget: number | null; status: string };

// Sent once per goal revision; later changes only append the short control JSON.
// `access` is what the model must act on. Pausing stops automatic continuation only:
// a user turn is ordinary work, so the rules must not read as "you may not work now".
// Evidence and wait rules live in the tool descriptions.
const rules = 'Work until every original requirement is implemented and verified; do not replace the objective with an easier one. ' +
  'The latest Goal instruction or control message replaces earlier ones. ' +
  'access "execute": the goal is running and continues automatically across turns; goal_wait and goal_blocked are available. ' +
  'access "complete": the goal is paused or completed and does not continue on its own. Handle the user\'s message normally with any tools; ' +
  'call goal_complete only if every requirement is already verified. If the user wants automatic work to continue, they run /goal resume. ' +
  'Skipped, timed_out and cancelled ask_user answers are not consent.';

/** Derived delivery metadata only: it is never a state or permission recovery source. */
export function goalInstruction(ctx: ExtensionContext, goal: Goal | undefined, access: Access, control: number) {
  const messages = ctx.sessionManager.buildSessionProjection().messages;
  const anchor = messages.findLast(message => message.role === 'custom' && message.customType === GOAL_CONTEXT);
  const last = messages.findLast(message => message.role === 'custom' && [GOAL_CONTEXT, GOAL_CONTROL].includes(message.customType));
  if (!goal && !last) return;
  const state: Control = { goalId: goal?.id ?? null, revision: goal?.revision ?? null, control, access,
    budget: goal?.budget ?? null, status: goal?.status ?? 'none' };
  const previous = last?.role === 'custom' ? last.details as Control | undefined : undefined;
  if (JSON.stringify(previous) === JSON.stringify(state)) return;
  const anchored = anchor?.role === 'custom' ? anchor.details as Control | undefined : undefined;
  const full = goal && (anchored?.goalId !== goal.id || anchored.revision !== goal.revision);
  return { customType: full ? GOAL_CONTEXT : GOAL_CONTROL, display: false, details: state,
    content: full ? `Current Goal instruction:\n${rules}\n${JSON.stringify({ ...state, objective: goal.text })}` :
      `Current Goal control (replaces earlier ones):\n${JSON.stringify(state)}` };
}
