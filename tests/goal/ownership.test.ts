import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { SessionBinding } from "../../src/runtime/binding.ts";
import { Notifications } from "../../src/runtime/notifications.ts";
import { GoalManager } from "../../src/goal/manager.ts";
import { Dock } from "../../src/ui/dock.ts";
import { StatusPublisher } from "../../src/ui/status.ts";
import { WaitRegistry } from "../../src/runtime/wait.ts";
import { GOAL_ENTRY, goalDuration, type Goal } from '../../src/goal/state.ts';

function fixture() {
  const binding = new SessionBinding();
  const statuses = new Map<string, string | undefined>(); const sent: string[] = [];
  const entries: { type: "custom"; customType: string; data: { version: number; goal: Goal | null } }[] = [];
  const pi = { appendEntry(customType: string, data: typeof entries[number]["data"]) { entries.push({ type: "custom", customType, data }); }, sendMessage: (m: { content: unknown }) => { sent.push(String(m.content)); } } as unknown as ExtensionAPI;
  const notifications = new Notifications(pi, binding);
  const status = new StatusPublisher(new Dock());
  const ctx = { isIdle: () => false, hasPendingMessages: () => false, abort() {},
    sessionManager: { getSessionId: () => "main", getBranch: () => entries, getEntries: () => entries },
    ui: { setStatus: (key: string, text?: string) => statuses.set(key, text) },
  } as unknown as ExtensionContext;
  binding.bind(ctx); status.bind(ctx.ui, { goal: "status", agents: "status", jobs: "status" });
  const manager = new GoalManager(pi, binding, notifications, status, new WaitRegistry());
  const run = () => { manager.beforeStart(true); manager.startRun(); };
  return { manager, binding, notifications, ctx, run, statuses, sent, entries };
}

test("late usage preserves pause; edited or replaced goals reject obsolete tool ownership", () => {
  const { manager: g, ctx, run } = fixture();
  assert.throws(() => g.requireOwned("missing", ctx), { name: "ToolError", code: "NOT_FOUND", objectId: "missing", message: /^NOT_FOUND:/ });
  g.start("Original", ctx, 1); run(); const old = g.goal!.id;
  g.pause(ctx);
  assert.throws(() => g.requireOwned(old, ctx), { name: "ToolError", code: "NOT_RUNNING", objectId: old, message: /^NOT_RUNNING:/ });
  g.messageEnd({ message: { role: "assistant", usage: { totalTokens: 2 } } } as MessageEndEvent, ctx);
  assert.equal(g.goal!.usedTokens, 2); assert.equal(g.goal!.status, "paused");
  g.edit("Edited", 100, ctx); g.resume(); run();
  g.edit("Revised during stream", undefined, ctx);
  assert.throws(() => g.requireOwned(old, ctx), { name: "ToolError", code: "STALE_BINDING", objectId: old, message: /^STALE_BINDING:/ });
  g.start("Replacement", ctx); run();
  assert.throws(() => g.requireOwned(old, ctx), { name: "ToolError", code: "NOT_FOUND", objectId: old, message: /^NOT_FOUND:/ });
  assert.equal(g.goal!.text, "Replacement"); assert.equal(g.goal!.status, "active");
  g.detach();
});

test("wait and completion timers cannot mutate edited objectives or revoked bindings", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const { manager: g, ctx, run, binding, notifications, statuses } = fixture();
  try {
    g.start("Wait", ctx); run(); g.wait(g.goal!.id, "Expected event", 100, ctx);
    g.edit("Different objective", undefined, ctx);
    t.mock.timers.tick(100);
    assert.equal(g.goal!.waiting, undefined); assert.equal(g.goal!.text, "Different objective");
    const request = `goal:${g.goal!.id}`;
    assert.ok(notifications.has("main", request));
    run(); g.complete(g.goal!.id, "Verified", ctx); assert.match(statuses.get("goal") ?? "", /^✅ goal \d+:\d{2}(?::\d{2})?$/);
    g.start("New goal", ctx); const id = g.goal!.id; t.mock.timers.tick(5000);
    assert.equal(g.goal!.id, id); assert.match(statuses.get("goal") ?? "", /^⏳ goal \d+:\d{2}(?::\d{2})?$/);
    run(); g.wait(id, "Late event", 100, ctx); binding.revoke(); t.mock.timers.tick(100);
    assert.throws(() => g.requireOwned(id, ctx), { name: "ToolError", code: "STALE_BINDING", objectId: id });
    assert.equal(g.goal!.waiting, "jobs"); assert.equal(g.goal!.id, id);
  } finally { g.detach(); t.mock.timers.reset(); }
});

test("a settlement merges goal/job/agent wakeups and yields to pending host messages", () => {
  const { manager: g, notifications: n, ctx, run } = fixture();
  try {
    g.start("Work", ctx); run();
    n.enqueue("main", "job:1", "Job finished"); n.enqueue("main", "agent:1", "Agent finished");
    const event = { outcome: "completed", continue: false, context: { pendingMessages: [] } } as unknown as AgentBeforeSettleEvent;
    g.beforeSettle(event);
    assert.equal(n.beforeSettle({ ...event, continue: true }), undefined);
    assert.equal(n.beforeSettle({ ...event, context: { pendingMessages: [{}] } } as AgentBeforeSettleEvent), undefined);
    const result = n.beforeSettle(event)!;
    assert.equal(result.continue, true); assert.equal(result.entries!.length, 1);
    assert.match(JSON.stringify(result.entries), /Job finished.*Agent finished.*Active goal/);
    assert.equal(n.beforeSettle(event), undefined);
  } finally { g.detach(); }
});

test('goal clock freezes at pause/wait and resumes cumulatively without persisting ticks or duplicate resume work', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const { manager: g, ctx, run, statuses, notifications } = fixture();
  Object.assign(ctx, { mode: 'tui' });
  try {
    g.start('Clock', ctx); run();
    let entries = 0;
    t.mock.method((g as unknown as { pi: ExtensionAPI }).pi, 'appendEntry', () => { entries++; });
    now = 65000; t.mock.timers.tick(1000);
    assert.equal(statuses.get('goal'), '🎯 goal 01:05'); assert.equal(entries, 0);
    assert.equal(g.resume(), 'running');
    assert.equal(notifications.has('main', `goal:${g.goal!.id}`), false);
    assert.equal(statuses.get('goal'), '🎯 goal 01:05');
    g.pause(ctx); const saved = entries;
    now = 100000; t.mock.timers.tick(10000);
    assert.equal(statuses.get('goal'), '⏸ goal 01:05'); assert.equal(entries, saved);
    g.resume(); run(); now = 102000;
    g.wait(g.goal!.id, 'External work', undefined, ctx);
    now = 120000; t.mock.timers.tick(10000);
    assert.equal(statuses.get('goal'), '⏳ goal 01:07');
    assert.equal(goalDuration(27 * 3600000 + 3000), '27:00:03');
  } finally { g.detach(); }
});

test('user audits close non-active goals without execution permission, and completion retries preserve feedback', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const { manager: g, ctx, run, notifications, entries, statuses } = fixture();
  try {
    for (const state of ['failed', 'paused', 'blocked', 'budget_limited', 'stopped'] as const) {
      g.start('Audit every requirement', ctx, 1); run(); const id = g.goal!.id;
      g.pause(ctx);
      g.goal!.status = state; g.goal!.error = 'Original fault'; g.goal!.usedTokens = 10;
      assert.throws(() => g.complete(id, 'Old request', ctx), { code: 'STALE_BINDING' });
      g.settled(true);
      assert.equal(g.beforeStart(false), false, 'unrelated child/custom run cannot acquire audit ownership');
      assert.throws(() => g.complete(id, 'Foreign work', ctx), { code: 'STALE_BINDING' });
      g.settled(false);
      assert.equal(g.beforeStart(true), true); g.startRun(ctx);
      assert.equal(g.goal!.automatic, false); assert.equal(g.schedule, 'idle');
      assert.throws(() => g.wait(id, 'Do work', undefined, ctx), { code: 'NOT_RUNNING' });
      assert.throws(() => g.block(id, 'Blocker', 'Evidence', ctx), { code: 'NOT_RUNNING' });
      g.messageEnd({ message: { role: 'assistant', usage: { totalTokens: 2 } } } as MessageEndEvent, ctx);
      assert.equal(g.goal!.usedTokens, 12); assert.equal(g.goal!.status, state);
      assert.equal(notifications.has('main', `goal:${id}`), false);
      assert.equal(g.complete(id, 'Verified existing work', ctx), true);
      const at = g.goal!.completedAt, saved = entries.length;
      t.mock.timers.tick(2000);
      assert.equal(g.complete(id, 'Do not overwrite evidence', ctx), false);
      assert.equal(entries.length, saved); assert.equal(g.goal!.completedAt, at);
      assert.equal(g.goal!.progress, 'Verified existing work'); assert.equal(g.goal!.error, 'Original fault');
      t.mock.timers.tick(3000); assert.equal(statuses.get('goal'), undefined);
      g.settled(false);
      assert.throws(() => g.complete(id, 'Expired audit', ctx), { code: 'STALE_BINDING' });
      g.beforeStart(true); g.startRun(ctx);
      assert.equal(g.complete(id, 'New retry', ctx), false); assert.equal(statuses.get('goal'), undefined);
      g.settled(false);
    }
  } finally { g.detach(); }
});

test('completion-only ownership rejects wrong sessions, revisions, cancelled requests and revoked bindings', () => {
  const { manager: g, ctx, run, binding } = fixture();
  try {
    g.start('Ownership', ctx); run(); g.pause(ctx); g.settled(true);
    const id = g.goal!.id;
    g.beforeStart(true); const request = new AbortController(); Object.assign(ctx, { signal: request.signal }); g.startRun(ctx);
    const foreign = { ...ctx, sessionManager: { getSessionId: () => 'child' } } as ExtensionContext;
    assert.throws(() => g.complete(id, 'Foreign', foreign), { code: 'STALE_BINDING' });
    assert.throws(() => g.complete('wrong', 'Missing', ctx), { code: 'NOT_FOUND' });
    const cancelled = new AbortController(); cancelled.abort();
    assert.throws(() => g.complete(id, 'Cancelled tool', ctx, cancelled.signal), { code: 'STALE_BINDING' });
    g.edit('Another revision', undefined, ctx);
    assert.throws(() => g.complete(id, 'Old revision', ctx), { code: 'STALE_BINDING' });
    g.settled(false); g.beforeStart(true); g.startRun(ctx); request.abort();
    assert.throws(() => g.complete(id, 'Cancelled request', ctx), { code: 'STALE_BINDING' });
    g.settled(true); Object.assign(ctx, { signal: new AbortController().signal }); g.beforeStart(true); g.startRun(ctx);
    g.resume();
    assert.throws(() => g.complete(id, 'Before newer resume request', ctx), { code: 'STALE_BINDING' });
    g.settled(false); g.beforeStart(true); g.startRun(ctx); binding.bind(ctx);
    assert.throws(() => g.complete(id, 'Revoked binding', ctx), { code: 'STALE_BINDING' });
  } finally { g.detach(); }
});

test('quit stops every unfinished state with frozen usage and reasons; cold permission survives tree/reload by revision', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0; t.mock.method(performance, 'now', () => now);
  const { manager: g, ctx, run, entries, notifications } = fixture();
  try {
    for (const state of ['active', 'failed', 'paused', 'blocked', 'budget_limited'] as const) {
      g.start('Retain all evidence', ctx, 100); run(); now += 1000;
      g.goal!.status = state; g.goal!.progress = 'Saved progress'; g.goal!.error = 'Fault retained';
      g.goal!.waiting = 'jobs'; g.goal!.resumeAt = Date.now() + 100; g.goal!.waitFor = ['job_deadbeef'];
      g.shutdown('quit'); const saved = entries.at(-1)!.data.goal!, count = entries.length;
      assert.equal(saved.status, 'stopped'); assert.equal(saved.stoppedFrom, state); assert.equal(saved.automatic, false);
      assert.equal(saved.progress, 'Saved progress'); assert.equal(saved.error, 'Fault retained'); assert.equal(saved.budget, 100);
      assert.equal(saved.resumeAt, undefined); assert.equal(saved.waitFor, undefined); assert.equal(saved.waiting, undefined);
      assert.equal(saved.elapsedMs, 1000); assert.equal(saved.resumeRequired, true);
      t.mock.timers.tick(200); now += 10000; assert.equal(g.elapsedMs, 1000);
      g.shutdown('quit'); assert.equal(entries.length, count); assert.equal(notifications.has('main', `goal:${saved.id}`), false);
    }
    g.start('Crash snapshot', ctx); run(); g.wait(g.goal!.id, 'Deadline', 100, ctx);
    const old = entries.at(-1)!; g.detach();
    g.restore(ctx, 'startup'); assert.equal(g.goal!.status, 'stopped');
    t.mock.timers.tick(200); assert.equal(notifications.has('main', `goal:${g.goal!.id}`), false);
    // Selecting a stale active branch must not undo the session's cold revocation.
    t.mock.method(ctx.sessionManager, 'getBranch', () => [old] as never);
    for (const reason of ['tree', 'reload'] as const) { g.restore(ctx, reason); assert.equal(g.goal!.status, 'stopped'); }
    g.beforeStart(true); g.startRun(ctx); assert.equal(g.goal!.automatic, false);
    g.settled(false); g.resume(); assert.equal(g.goal!.resumeRequired, false);
    g.restore(ctx, 'tree'); assert.equal(g.goal!.status, 'active');
    const prior = { ...old, data: { version: 1, goal: { ...old.data.goal!, revision: old.data.goal!.revision + 1 } } };
    t.mock.method(ctx.sessionManager, 'getBranch', () => [prior] as never);
    g.restore(ctx, 'tree'); assert.equal(g.goal!.status, 'stopped', 'grant cannot authorize another revision');
    g.resume(); run(); g.stopGoal(ctx); const stopped = entries.length;
    g.stopGoal(ctx); assert.equal(entries.length, stopped, 'stop is idempotent and retains goal');
    g.settled(true); g.beforeStart(true); g.startRun(ctx); g.complete(g.goal!.id, 'Verified', ctx);
    const completed = { ...g.goal! }; g.shutdown('quit'); assert.deepEqual(g.goal, completed);
    assert.ok(entries.every(entry => entry.customType === GOAL_ENTRY));
  } finally { g.detach(); }
});

test('explicit resume during abort settlement survives the older run and queues exactly one continuation', () => {
  const { manager: g, ctx, run, notifications } = fixture();
  try {
    g.start('Resume race', ctx); run();
    g.endRun(); g.resume();
    g.beforeSettle({ outcome: 'aborted' } as AgentBeforeSettleEvent);
    g.settled(true);
    assert.equal(g.goal!.automatic, true);
    assert.ok(notifications.has('main', `goal:${g.goal!.id}`));
    run(); assert.equal(notifications.has('main', `goal:${g.goal!.id}`), false);
  } finally { g.detach(); }
});
