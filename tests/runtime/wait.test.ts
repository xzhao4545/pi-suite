import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { WaitRegistry, type Settlement, type Waitable } from "../../src/runtime/wait.ts";

/** In-memory source: every object is visible to the session; consume marks it seen. */
class Fake implements Waitable {
  items = new Map<string, Settlement>();
  seen = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(readonly prefix: string) {}
  set(id: string, state: string, extra: Partial<Settlement> = {}): void {
    this.items.set(id, { id, state, summary: `${id} ${state}`, settled: ["completed", "failed"].includes(state), ...extra });
    for (const listener of this.listeners) listener();
  }
  settlement(id: string): Settlement { return this.items.get(id)!; }
  unread(): Settlement[] { return [...this.items.values()].filter(item => (item.settled || item.question) && !this.seen.has(item.id)); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  consume(item: Settlement): void { this.seen.add(item.id); }
}
function fixture() {
  const registry = new WaitRegistry(), jobs = new Fake("job_"), agents = new Fake("agent_");
  registry.register(jobs); registry.register(agents);
  jobs.set("job_00000001", "running"); jobs.set("job_00000002", "running"); agents.set("agent_00000001", "running");
  return { registry, jobs, agents };
}

test("waiting on an agent returns when an unrelated job settles, and consumes that result", async () => {
  const { registry, jobs } = fixture();
  const waiting = registry.wait(["agent_00000001"], "all", 5000);
  jobs.set("job_00000001", "completed");
  const result = await waiting;
  assert.equal(result.reason, "other"); assert.deepEqual(result.pending, ["agent_00000001"]);
  assert.deepEqual(result.others.map(item => item.id), ["job_00000001"]);
  assert.ok(jobs.seen.has("job_00000001"), "the returned result is not delivered again");
});

test("a question from any visible child ends the wait, even one not in ids", async () => {
  const { registry, agents } = fixture();
  agents.set("agent_00000002", "running");
  const waiting = registry.wait(["job_00000001"], "all", 5000);
  agents.set("agent_00000002", "waiting", { question: true, summary: "agent_00000002 waiting(parent) · 待答 1 题" });
  const result = await waiting;
  assert.equal(result.reason, "question"); assert.match(result.others[0].summary, /待答/);
});

test("a user steer ends a running wait, and one queued before the wait ends it at once", async () => {
  const { registry } = fixture();
  const waiting = registry.wait(["job_00000001"], "all", 5000);
  await sleep(10); registry.userSteered();
  assert.equal((await waiting).reason, "user");
  const early = await registry.wait(["job_00000002"], "all", 5000);
  assert.equal(early.reason, "user", "the steer is still undelivered");
  registry.steeringDelivered();
  const timed = await registry.wait(["job_00000002"], "all", 30);
  assert.equal(timed.reason, "timeout"); assert.equal(timed.timedOut, true);
});

test("mode all waits for every waited id; partial progress of waited ids does not return", async () => {
  const { registry, jobs } = fixture();
  let returned = false;
  const all = registry.wait(["job_00000001", "job_00000002"], "all", 5000).then(value => { returned = true; return value; });
  jobs.set("job_00000001", "completed"); await sleep(20);
  assert.equal(returned, false, "one of two waited ids settling is not the all condition");
  jobs.set("job_00000002", "failed");
  const result = await all;
  assert.equal(result.reason, "condition"); assert.deepEqual(result.pending, []); assert.deepEqual(result.others, []);
});
