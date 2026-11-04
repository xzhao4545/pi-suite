import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/**
 * One wait over jobs and agents. Each module registers a Waitable for its ID prefix; wait
 * observes their change signals and never stops anything. A settlement the model has seen
 * through wait is consumed, so the shared notifier does not deliver it again.
 */
export type Settlement = { id: string; state: string; summary: string; settled: boolean; question?: boolean };
export interface Waitable {
  readonly prefix: string;
  settlement(id: string): Settlement;
  subscribe(listener: () => void): () => void;
  consume(id: string): void;
}
export const WAIT_LIMITS = { maxIds: 50, defaultMs: 300000, maxMs: 3600000 };

export class WaitRegistry {
  private sources: Record<string, Waitable> = {};
  register(source: Waitable): void { this.sources[source.prefix] = source; }
  private source(id: string): Waitable {
    const source = this.sources[id.slice(0, id.indexOf('_') + 1)];
    if (!source) throw Object.assign(new Error(`No waitable object for ${id}`), { code: 'NOT_FOUND' });
    return source;
  }
  /** Resolves when the condition holds, a waited agent asks a question, the timeout passes or the signal aborts. */
  async wait(ids: string[], mode: 'any' | 'all', timeoutMs: number, signal?: AbortSignal): Promise<{ results: Settlement[]; pending: string[]; timedOut: boolean }> {
    const unique = [...new Set(ids)];
    const sources = unique.map(id => this.source(id));
    const snapshot = () => unique.map((id, index) => sources[index].settlement(id));
    const done = Promise.withResolvers<{ results: Settlement[]; pending: string[]; timedOut: boolean }>();
    const finish = (timedOut: boolean) => {
      const results = snapshot();
      for (const [index, result] of results.entries()) if (result.settled) sources[index].consume(result.id);
      done.resolve({ results, pending: results.filter(result => !result.settled).map(result => result.id), timedOut });
    };
    const check = () => {
      const results = snapshot();
      // A question from a waited child returns at once in both modes: the parent must answer it.
      if (results.some(result => result.question) || (mode === 'any' ? results.some(result => result.settled) : results.every(result => result.settled))) finish(false);
    };
    const unsubscribe = [...new Set(sources)].map(source => source.subscribe(check));
    const timer = setTimeout(() => finish(true), timeoutMs);
    const abort = () => done.reject(signal!.reason ?? new Error('Wait aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    try { check(); return await done.promise; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); for (const stop of unsubscribe) stop(); }
  }
}

export function registerWait(pi: ExtensionAPI, registry: WaitRegistry): void {
  pi.registerTool({
    name: 'wait', label: 'Wait',
    description: 'Wait for jobs or agents (ids like job_… / agent_…) to settle. mode=all (default) or any. Timeout or cancel only ends the wait; nothing is stopped. Returns at once when a waited agent asks a question.',
    parameters: Type.Object({
      ids: Type.Array(Type.String({ pattern: '^(job|agent)_[a-f0-9]{8}$' }), { minItems: 1, maxItems: WAIT_LIMITS.maxIds }),
      mode: Type.Optional(Type.Union([Type.Literal('any'), Type.Literal('all')])),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: WAIT_LIMITS.maxMs, description: `Default ${WAIT_LIMITS.defaultMs}` })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal) {
      const value = await registry.wait(params.ids, params.mode ?? 'all', params.timeoutMs ?? WAIT_LIMITS.defaultMs, signal);
      const settled = value.results.filter(result => result.settled).length;
      const text = [`wait ${settled}/${value.results.length} settled${value.timedOut ? ' · timed out' : ''}`,
        ...value.results.map(result => result.summary)].join('\n');
      return { content: [{ type: 'text', text }], details: value };
    },
  });
}
