import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentBeforeSettleEvent, ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { SessionBinding } from "../../src/runtime/binding.ts";
import { Notifications } from "../../src/runtime/notifications.ts";
import { GoalManager } from "../../src/goal/manager.ts";
import { Dock } from "../../src/ui/dock.ts";
import { StatusPublisher } from "../../src/ui/status.ts";

function fixture() {
  const binding = new SessionBinding();
  const statuses = new Map<string, string | undefined>(); const sent: string[] = [];
  const pi = { appendEntry() {}, sendMessage: (m: { content: unknown }) => { sent.push(String(m.content)); } } as unknown as ExtensionAPI;
  const notifications = new Notifications(pi, binding);
  const status = new StatusPublisher(new Dock());
  const ctx = { isIdle: () => false, hasPendingMessages: () => false, abort() {},
    sessionManager: { getSessionId: () => "main", getBranch: () => [] },
    ui: { setStatus: (key: string, text?: string) => statuses.set(key, text) },
  } as unknown as ExtensionContext;
  binding.bind(ctx); status.bind(ctx.ui, { goal: "status", agents: "status", jobs: "status" });
  const manager = new GoalManager(pi, binding, notifications, status);
  const run = () => { manager.beforeStart(true); manager.startRun(); };
  return { manager, binding, notifications, ctx, run, statuses, sent };
}

test("late usage preserves pause; edited or replaced goals reject obsolete tool ownership", () => {
  const { manager: g, ctx, run } = fixture();
  g.start("Original", ctx, 1); run(); const old = g.goal!.id;
  g.pause(ctx);
  g.messageEnd({ message: { role: "assistant", usage: { totalTokens: 2 } } } as MessageEndEvent, ctx);
  assert.equal(g.goal!.usedTokens, 2); assert.equal(g.goal!.status, "paused");
  g.edit("Edited", 100, ctx); g.resume(); run();
  g.edit("Revised during stream", undefined, ctx);
  assert.throws(() => g.requireOwned(old, ctx), /does not own/);
  g.start("Replacement", ctx); run();
  assert.throws(() => g.requireOwned(old, ctx), /does not own/);
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
    run(); g.complete(g.goal!.id, "Verified", ctx); assert.equal(statuses.get("goal"), "goal 完成");
    g.start("New goal", ctx); const id = g.goal!.id; t.mock.timers.tick(5000);
    assert.equal(g.goal!.id, id); assert.equal(statuses.get("goal"), "goal 待运行");
    run(); g.wait(id, "Late event", 100, ctx); binding.revoke(); t.mock.timers.tick(100);
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
