import { contentText } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent } from '@earendil-works/pi-coding-agent';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { GoalManager } from '../../src/goal/manager.ts';
import { Dock } from '../../src/ui/dock.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { WaitRegistry } from '../../src/runtime/wait.ts';

function fixture() {
  const binding = new SessionBinding(), sessionId = randomUUID(), statuses = new Map<string, string | undefined>();
  const sent: string[] = [], entries: unknown[] = [];
  const pi = { appendEntry: (...args: unknown[]) => entries.push(args), sendMessage: (message: { content: string }) => sent.push(contentText(message.content)) } as unknown as ExtensionAPI;
  const notifications = new Notifications(pi, binding), status = new StatusPublisher(new Dock());
  const ctx = { isIdle: () => false, hasPendingMessages: () => false, abort() {},
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined, getEntries: () => [] },
    ui: { setStatus: (key: string, text?: string) => statuses.set(key, text), notify() {} },
  } as unknown as ExtensionContext;
  binding.bind(ctx); status.bind(ctx.ui, { goal: 'status', agents: 'status', jobs: 'status' });
  const g = new GoalManager(pi, binding, notifications, status, new WaitRegistry());
  const run = async (user = true) => { await g.beforeStart(user); await g.startRun(ctx); };
  return { g, binding, notifications, ctx, run, statuses, sent, entries, sessionId };
}
const event = { outcome: 'completed', continue: false, entries: [], context: { pendingMessages: [] } } as unknown as AgentBeforeSettleEvent;
const usage = { message: { role: 'assistant', usage: { totalTokens: 2 } } } as MessageEndEvent;

test('late usage preserves pause/edit; replacement, abort and binding changes reject stale tool ownership', async () => {
  const { g, ctx, run, binding, entries } = fixture();
  try {
    await g.start('Original', ctx, 100); await run(); const id = g.goal!.id;
    await g.pause(ctx); await g.messageEnd(usage, ctx);
    assert.equal(g.goal!.usedTokens, 2); assert.equal(g.goal!.status, 'paused');
    await assert.rejects(g.complete(id, 'Old audit', ctx), { code: 'STALE_BINDING' });
    await g.settled(true); await run();
    await g.edit('Changed revision', undefined, ctx); await g.messageEnd(usage, ctx);
    assert.equal(g.goal!.usedTokens, 4);
    await assert.rejects(g.complete(id, 'Old revision', ctx), { code: 'STALE_BINDING' });
    await g.start('Replacement', ctx); await g.messageEnd(usage, ctx);
    assert.equal(g.goal!.usedTokens, 0); await run();
    const current = g.goal!.id, cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(g.complete(current, 'Cancelled', ctx, cancelled.signal));
    binding.bind(ctx); await assert.rejects(g.complete(current, 'Revoked', ctx), { code: 'STALE_BINDING' });
    assert.deepEqual(entries, [], 'no state snapshots or usage entries are appended');
  } finally { g.detach(); }
});

test('completion-only user audits preserve original evidence/time and do not grant wait/block permission', async () => {
  const { g, ctx, run, notifications, sessionId } = fixture();
  try {
    await g.start('Audit full objective', ctx); await run(); await g.pause(ctx); await g.settled(true);
    assert.equal(await g.beforeStart(false), false); await g.settled(false); await run();
    const id = g.goal!.id;
    await assert.rejects(g.wait(id, 'Not execution', undefined, ctx), { code: 'NOT_RUNNING' });
    await assert.rejects(g.block(id, 'Not execution', 'Evidence', ctx), { code: 'NOT_RUNNING' });
    await g.messageEnd(usage, ctx); assert.equal(g.goal!.status, 'paused');
    assert.equal(await g.complete(id, 'Verified existing work', ctx), true);
    const at = g.goal!.completedAt;
    assert.equal(await g.complete(id, 'Do not replace evidence', ctx), false);
    assert.equal(g.goal!.completedAt, at); assert.equal(g.goal!.progress, 'Verified existing work');
    assert.equal(notifications.has(sessionId, `goal:${id}`), false);
    await g.settled(false); await assert.rejects(g.complete(id, 'Expired', ctx), { code: 'STALE_BINDING' });
  } finally { g.detach(); }
});

test('mixed notification delivery preserves event identity, omits redundant Goal text and counts callbacks once', async () => {
  const { g, ctx, run, notifications: n, sessionId } = fixture();
  try {
    await g.start('Work', ctx); await run(); let delivered = 0;
    n.enqueue(sessionId, 'job:1', 'Job finished', () => delivered++);
    n.enqueue(sessionId, 'agent:1', 'Agent finished', () => delivered++);
    await g.beforeSettle(event);
    assert.equal(n.beforeSettle({ ...event, continue: true }), undefined);
    assert.equal(n.beforeSettle({ ...event, context: { pendingMessages: [{}] } } as AgentBeforeSettleEvent), undefined);
    const result = n.beforeSettle(event)!;
    assert.equal(result.continue, true); assert.equal(result.entries!.length, 1);
    assert.match(JSON.stringify(result.entries), /Job finished.*Agent finished/);
    assert.ok(!JSON.stringify(result.entries).includes('Continue the current goal'));
    assert.equal(n.beforeSettle(event), undefined); assert.equal(delivered, 2);
    await g.beforeSettle(event);
    assert.match(JSON.stringify(n.beforeSettle(event)!.entries), /Continue the current goal/);
  } finally { g.detach(); }
});

test('clock reads do not persist ticks; pause freezes time and resume during older abort queues one wake', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] }); let now = 0;
  t.mock.method(performance, 'now', () => now);
  const { g, ctx, run, statuses, entries, notifications, sessionId } = fixture(); Object.assign(ctx, { mode: 'tui' });
  try {
    await g.start('Clock', ctx); await run(); now = 65000; t.mock.timers.tick(1000);
    assert.equal(statuses.get('goal'), '🎯 goal 01:05'); assert.deepEqual(entries, []);
    assert.equal(await g.resume(), 'running'); assert.equal(notifications.has(sessionId, `goal:${g.goal!.id}`), false);
    await g.pause(ctx); now = 100000; t.mock.timers.tick(10000); assert.equal(g.elapsedMs, 65000);
    await g.resume(); await g.settled(true);
    assert.equal(g.goal!.status, 'active'); assert.ok(notifications.has(sessionId, `goal:${g.goal!.id}`));
    await run(); await g.wait(g.goal!.id, 'External work', undefined, ctx);
    now = 120000; t.mock.timers.tick(10000); assert.equal(g.elapsedMs, 65000);
  } finally { g.detach(); }
});

test('quit/cold startup preserve diagnostics and current Goal across stale history branches', async () => {
  const { g, ctx, run, entries, notifications, sessionId } = fixture();
  try {
    await g.start('Persistent current Goal', ctx); await run(); await g.wait(g.goal!.id, 'Deadline', undefined, ctx);
    const id = g.goal!.id; await g.shutdown('quit');
    assert.equal(g.goal!.status, 'paused'); assert.equal(g.goal!.reason?.kind, 'shutdown');
    assert.equal(g.goal!.reason?.wait?.waiting, 'jobs'); assert.equal(g.goal!.resumeRequired, true);
    await g.restore(ctx, 'startup'); await g.restore(ctx, 'tree');
    assert.equal(g.goal!.id, id); assert.equal(g.goal!.status, 'paused');
    assert.equal(notifications.has(sessionId, `goal:${id}`), false);
    await g.resume(); await g.restore(ctx, 'tree'); assert.equal(g.goal!.status, 'active');
    await g.clear(ctx); await g.restore(ctx, 'tree'); assert.equal(g.goal, undefined);
    assert.deepEqual(entries, []);
  } finally { g.detach(); }
});

test('errors remain provisional until final settlement; retries do not count as inactivity rounds', async () => {
  const { g, ctx, notifications, sessionId } = fixture();
  try {
    await g.start('Recover', ctx); g.activity.delivered(); await g.beforeStart(false); await g.startRun(ctx);
    for (let i = 0; i < 6; i++) {
      g.endRun('429 retry'); await g.beforeSettle({ ...event, outcome: 'error', continue: true });
      assert.equal(g.goal!.status, 'active'); assert.equal(g.schedule, 'waiting_host'); await g.startRun(ctx);
    }
    g.endRun(); await g.beforeSettle(event); await g.settled(false);
    assert.ok(notifications.has(sessionId, `goal:${g.goal!.id}`));
    await g.beforeStart(false); await g.startRun(ctx); g.endRun('401 final failure');
    await g.beforeSettle({ ...event, outcome: 'error' }); assert.equal(g.goal!.status, 'active');
    await g.settled(false); assert.equal(g.goal!.reason?.kind, 'request_failed'); assert.equal(g.goal!.error, '401 final failure');
  } finally { g.detach(); }
});
