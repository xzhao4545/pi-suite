import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { ToolError } from './errors.ts';
import { WAIT_ID_PATTERN } from './tools.ts';

/**
 * One wait over jobs and agents. Each module registers a Waitable for its ID prefix; wait
 * observes their change signals and never stops anything. A settlement the model has seen
 * through wait is consumed, so the shared notifier does not deliver it again.
 */
/**
 * event/update: newest monitor event or hands-free update reported. Separate counters keep a
 * monitor and supervision on the same job independent; consuming progress leaves its result pending.
 */
export type Settlement = { id: string; runId?: string; state: string; summary: string; settled: boolean; question?: boolean; event?: number; update?: number };
export interface Waitable {
  readonly prefix: string;
  settlement(id: string): Settlement;
  /**
   * Entries visible to the current session that the model has not seen yet: settled results not
   * delivered or consumed, open questions from direct children, and undelivered job progress.
   */
  unread(): Settlement[];
  subscribe(listener: () => void): () => void;
  /** Marks a result, question or event batch as seen; it must leave unread() and the notification queue. */
  consume(item: Settlement): void;
}
export const WAIT_LIMITS = { maxIds: 50, defaultMs: 300000, maxMs: 3600000 };

/** Why a wait returned: its condition, a child question, job progress, another settlement, user input or timeout. */
export type WaitReason = 'condition' | 'question' | 'event' | 'other' | 'user' | 'timeout';
export type WaitResult = { results: Settlement[]; others: Settlement[]; pending: string[]; timedOut: boolean; reason: WaitReason };

export class WaitRegistry {
  private sources: Record<string, Waitable> = {};
  private interrupts = new Set<() => void>();
  private steerQueued = false;
  register(source: Waitable): void { this.sources[source.prefix] = source; }
  private source(id: string): Waitable {
    const source = this.sources[id.slice(0, id.indexOf('_') + 1)];
    if (!source) throw new ToolError('NOT_FOUND', `No waitable object for ${id}`, id);
    return source;
  }
  has(id: string): boolean { return Boolean(this.sources[id.slice(0, id.indexOf('_') + 1)]); }
  settlement(id: string): Settlement { return this.source(id).settlement(id); }
  /** Change signal for every source behind these IDs; goal_wait uses it to resume on its own condition. */
  watch(ids: string[], listener: () => void): () => void {
    const stops = [...new Set(ids.map(id => this.source(id)))].map(source => source.subscribe(listener));
    return () => { for (const stop of stops) stop(); };
  }
  /**
   * Pi reads steering messages only between tool calls, so a blocking wait would hold the
   * user's message until it returns. A steer queued now, or before the wait began, ends it.
   */
  userSteered(): void {
    this.steerQueued = true;
    // The input handler runs just before Pi queues the message; return after it is queued.
    setTimeout(() => { for (const interrupt of this.interrupts) interrupt(); }, 0);
  }
  steeringDelivered(): void { this.steerQueued = false; }

  /**
   * Resolves when the ids condition holds, when any visible job or agent settles or a direct
   * child asks, when a monitor event or hands-free update arrives (also on a waited job), when the user sends a steering
   * message, at the timeout, or when the signal aborts.
   */
  async wait(ids: string[], mode: 'any' | 'all', timeoutMs: number, signal?: AbortSignal): Promise<WaitResult> {
    const unique = [...new Set(ids)];
    const sources = unique.map(id => this.source(id));
    const all = Object.values(this.sources);
    const snapshot = () => unique.map((id, index) => sources[index].settlement(id));
    // A waited ID's own result is already in results; its progress is reported beside it.
    const others = () => all.flatMap(source => source.unread()).filter(item => item.event !== undefined || item.update !== undefined || !unique.includes(item.id));
    const done = Promise.withResolvers<WaitResult>();
    let finished = false;
    const finish = (reason: WaitReason) => {
      if (finished) return;
      finished = true;
      const results = snapshot(), extra = others();
      for (const item of [...results, ...extra]) if (item.settled || item.question || item.event !== undefined || item.update !== undefined) this.source(item.id).consume(item);
      done.resolve({ results, others: extra, pending: results.filter(result => !result.settled).map(result => result.id),
        timedOut: reason === 'timeout', reason });
    };
    const check = () => {
      const results = snapshot();
      if (results.some(result => result.question)) return finish('question');
      if (mode === 'any' ? results.some(result => result.settled) : results.every(result => result.settled)) return finish('condition');
      const extra = others();
      if (extra.some(item => item.question)) finish('question');
      else if (extra.some(item => item.event !== undefined || item.update !== undefined)) finish('event');
      else if (extra.length) finish('other');
    };
    const unsubscribe = all.map(source => source.subscribe(check));
    const interrupt = () => finish('user');
    this.interrupts.add(interrupt);
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const abort = () => { finished = true; done.reject(signal!.reason ?? new Error('Wait aborted')); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (this.steerQueued) finish('user'); else check();
      return await done.promise;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      this.interrupts.delete(interrupt); for (const stop of unsubscribe) stop();
    }
  }
}

const HEADLINE: Record<WaitReason, string> = {
  condition: '', timeout: ' · timed out', other: ' · returned early: another job, agent or workflow settled',
  question: ' · returned early: an agent asked a question', event: ' · returned early: a monitor event fired',
  user: ' · returned early: the user sent a message',
};

export function registerWait(pi: ExtensionAPI, registry: WaitRegistry): void {
  pi.registerTool({
    name: 'wait', label: 'Wait',
    description: 'Wait for jobs, agents or workflows (job_… / agent_… / wf_…) to settle. mode=all (default) or any. ' +
      'Also returns early when any other job, agent or workflow of this session settles, a monitor event or hands-free update arrives (including on a waited job), a child agent asks a question, or the user sends a message; ' +
      'check pending and call wait again if still needed. Timeout or cancel only ends the wait; nothing is stopped.',
    parameters: Type.Object({
      ids: Type.Array(Type.String({ pattern: WAIT_ID_PATTERN }), { minItems: 1, maxItems: WAIT_LIMITS.maxIds }),
      mode: Type.Optional(Type.Union([Type.Literal('any'), Type.Literal('all')])),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: WAIT_LIMITS.maxMs, description: `Default ${WAIT_LIMITS.defaultMs}` })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal) {
      const value = await registry.wait(params.ids, params.mode ?? 'all', params.timeoutMs ?? WAIT_LIMITS.defaultMs, signal);
      const settled = value.results.filter(result => result.settled).length;
      const headline = value.reason === 'event' && value.others.some(item => item.update !== undefined)
        ? ' · returned early: a hands-free update arrived' : HEADLINE[value.reason];
      const text = [`wait ${settled}/${value.results.length} settled${headline}`,
        ...value.results.map(result => result.summary),
        ...value.others.length ? ['also:', ...value.others.map(item => item.summary)] : [],
        value.pending.length && value.reason !== 'condition' ? `pending: ${value.pending.join(', ')}` : undefined,
      ].filter(line => line !== undefined).join('\n');
      return { content: [{ type: 'text', text }], details: value };
    },
  });
}
