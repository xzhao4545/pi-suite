import { join } from 'node:path';
import { getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { JsonStore } from '../runtime/json-store.ts';
import { ToolError } from '../runtime/errors.ts';
import { goalSchema, readGoalSnapshot } from './snapshot.ts';
import type { Goal } from './state.ts';

export interface GoalData { version: 1; sessionId: string; control: number; goal: Goal | null }
const schema = Type.Object({ version: Type.Literal(1), sessionId: Type.String({ minLength: 1 }),
  control: Type.Integer({ minimum: 0 }), goal: Type.Union([goalSchema, Type.Null()]) }, { additionalProperties: false });
export function goalPath(agentDir: string, sessionId: string): string {
  // SDK IDs are not necessarily UUIDs. Prefix the encoded component so '.'/'..'
  // cannot escape the session directory, without truncating or conflating identities.
  return join(agentDir, 'pi-suite', 'goals', `session-${encodeURIComponent(sessionId)}`, 'state.json');
}
const empty = (): GoalData => ({ version: 1, sessionId: '', control: 0, goal: null });
export class GoalStore extends JsonStore<GoalData> {
  constructor(path: string | undefined, readonly sessionId: string) {
    super(path, empty(), value => {
      if (!Value.Check(schema, value) || value.sessionId !== sessionId) throw new Error('Invalid Goal state or session ownership');
      readGoalSnapshot({ version: 2, goal: value.goal });
      return value as GoalData;
    }, 'GOAL', { missing: empty, skipUnchanged: true });
  }
  initialize(imported: () => Goal | undefined): Promise<void> {
    // Missing check and import share the commit lock with clear and all writers.
    return this.mutate(data => {
      if (data.sessionId) return;
      data.sessionId = this.sessionId; data.goal = imported() ?? null;
    });
  }
  change<T>(expected: GoalData, apply: (data: GoalData) => T, signal?: AbortSignal): Promise<T> {
    return this.mutate(data => {
      if (data.sessionId !== expected.sessionId || data.goal?.id !== expected.goal?.id ||
        data.goal?.revision !== expected.goal?.revision || data.control !== expected.control) {
        throw new ToolError('GOAL_STALE', 'Goal changed; retry against the current state', expected.goal?.id);
      }
      return apply(data);
    }, signal);
  }
  account(id: string, tokens: number, current: () => boolean): Promise<void> {
    return this.mutate(data => {
      // Metering may arrive after pause/edit, but can never write lifecycle fields
      // or charge a replacement goal. Binding cancellation is checked under the lock.
      if (!current() || data.goal?.id !== id) return;
      data.goal.usedTokens += tokens; data.goal.turns++;
    });
  }
}
const stores = new Map<string, GoalStore>();
export function goalStore(ctx: ExtensionContext, agentDir = getAgentDir()): GoalStore {
  const sessionId = ctx.sessionManager.getSessionId();
  const path = ctx.sessionManager.getSessionFile?.() ? goalPath(agentDir, sessionId) : undefined;
  const key = path ?? `memory:${agentDir}:${sessionId}`;
  let store = stores.get(key);
  if (!store) stores.set(key, store = new GoalStore(path, sessionId));
  return store;
}
