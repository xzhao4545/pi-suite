import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../src/runtime/config.ts";
import { SessionBinding } from "../../src/runtime/binding.ts";
import { Notifications } from "../../src/runtime/notifications.ts";
import { Dock } from "../../src/ui/dock.ts";
import { StatusPublisher } from "../../src/ui/status.ts";
import { terminal } from "../support/terminal.ts";

test("configuration uses user defaults plus project section overrides and rejects malformed files", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-suite-config-"));
  try {
    const user = join(root, "user"), project = join(root, "project");
    mkdirSync(user); mkdirSync(join(project, ".pi"), { recursive: true });
    writeFileSync(join(user, "pi-suite.json"), JSON.stringify({ ask: { timeout: 300000, historyKey: "alt+h" }, modules: { ask: false } }));
    writeFileSync(join(project, ".pi", "pi-suite.json"), JSON.stringify({ ask: { timeout: 0 } }));
    const config = loadConfig(project, user);
    assert.deepEqual(config.ask, { timeout: 0, historyKey: "alt+h" }); assert.equal(config.modules.ask, false);
    writeFileSync(join(project, ".pi", "pi-suite.json"), '{"ask":{"timeout":-1}}');
    assert.throws(() => loadConfig(project, user), /Invalid pi-suite/);
    writeFileSync(join(project, ".pi", "pi-suite.json"), '{"ask":{"historyKey":"unknown-key"}}');
    assert.throws(() => loadConfig(project, user), /Invalid pi-suite/);
    writeFileSync(join(project, ".pi", "pi-suite.json"), "{"); assert.throws(() => loadConfig(project, user), SyntaxError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("binding revocation fences wakeups; blocked notifications coalesce without crossing sessions", () => {
  const binding = new SessionBinding(); const sent: string[] = []; let idle = true;
  const ctx = (id: string) => ({ sessionManager: { getSessionId: () => id }, isIdle: () => idle, hasPendingMessages: () => false }) as unknown as ExtensionContext;
  const notifications = new Notifications({ sendMessage: message => { sent.push(String(message.content)); } } as ExtensionAPI, binding);
  const old = binding.bind(ctx("a")); const release = notifications.hold();
  notifications.enqueue("a", "job:1", "old"); notifications.enqueue("a", "job:1", "new");
  binding.revoke(); binding.bind(ctx("b")); release();
  assert.equal(binding.isCurrent(old), false); assert.deepEqual(sent, []);
  idle = false; binding.bind(ctx("a")); notifications.flush(); assert.deepEqual(sent, []);
  idle = true; notifications.flush(); notifications.flush(); assert.deepEqual(sent, ["new"]);
});

test("status publishing deduplicates IDs, clears old bindings and honors status/dock placement", () => {
  const dock = new Dock(); const publisher = new StatusPublisher(dock);
  let renders = 0;
  const invalidate = dock.invalidate.bind(dock);
  dock.invalidate = () => { renders++; invalidate(); };
  const writes: [string, string | undefined][] = [];
  const ui = { setStatus: (key: string, text?: string) => { writes.push([key, text]); } } as ExtensionContext["ui"];
  publisher.bind(ui, { goal: "status", agents: "status", jobs: "dock" });
  publisher.setGoal("goal 待答"); publisher.setActivities("agents", ["a", "a", "b"]); publisher.setActivities("jobs", ["j"]);
  assert.deepEqual(writes.at(-1), ["pi-suite:runtime", "agents 2"]);
  const length = writes.length, before = renders;
  publisher.setActivities("agents", ["b", "a"]); publisher.setActivities("jobs", ["another-job"]); publisher.setGoal("goal 待答");
  assert.equal(writes.length, length); assert.equal(renders, before, 'unchanged summaries do not invalidate Dock');
  assert.ok(dock.render(40).some(line => line.includes("jobs 1")));
  assert.ok(dock.render(40).every(line => !line.includes("agents 2") && !line.includes("goal")));
  publisher.detach(); assert.deepEqual(writes.slice(-2), [["goal", undefined], ["pi-suite:runtime", undefined]]);
  writes.length = 0;
  publisher.bind(ui, {goal: "status", agents: "status", jobs: "status"}, false);
  publisher.setActivities("jobs", ["job"]); publisher.detach();
  assert.ok(writes.every(([key]) => key !== "goal"), 'a disabled goal module leaves another provider’s status untouched');

  publisher.bind(ui, {goal: 'status', agents: 'status', jobs: 'hidden'});
  const running = {id: 'agent:a', text: 'agent 中文'.repeat(20), suffix: 'running', priority: 25};
  publisher.setActivities('agents', ['a'], [running]);
  const countWrites = writes.length;
  publisher.setActivities('agents', ['a'], [{...running, suffix: 'waiting(parent)', priority: 100}]);
  assert.equal(writes.length, countWrites, 'state-only changes update details without rewriting counts');
  publisher.setActivities('jobs', ['job'], [{id: 'job', text: 'hidden job', priority: 110}]);
  dock.register('tasks', () => [
    {id: 'parent', text: 'parent', priority: 40}, {id: 'child', parentId: 'parent', text: 'child', priority: 40},
    {id: 'other', text: 'other', priority: 30},
  ]);
  const compact = dock.render(40);
  assert.match(compact[0], /waiting\(parent\)/); assert.match(compact.at(-1)!, /\+2/);
  assert.ok(compact.every(line => !line.includes('hidden job') && !line.includes('child')));
  const tui = terminal(40, 40);
  dock.bind({mode: 'tui', ui: {setWidget: (_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) => factory(tui)}} as unknown as ExtensionContext, 6);
  assert.deepEqual(dock.render(40).map(line => line.includes('child') ? 'child' : line.includes('parent') && !line.includes('waiting') ? 'parent' : 'other'),
    ['other', 'parent', 'child', 'other']);
  dock.bind({mode: 'tui', ui: {setWidget: (_key: string, factory: (tui: ReturnType<typeof terminal>) => unknown) => factory(tui)}} as unknown as ExtensionContext, 1);
  assert.deepEqual(dock.render(40), []); dock.setAsk(true); assert.equal(dock.askBudget(40), 1);
  publisher.detach();
});
