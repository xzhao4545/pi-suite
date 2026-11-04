import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import { normalize, askSchema } from "../../src/ask/schema.ts";
import { AskForm } from "../../src/ask/form.ts";
import { AskQueue } from "../../src/ask/queue.ts";

test("default initialization preserves explicit deselection, edits and raw option identity", () => {
  const form = new AskForm(normalize({ questions: [
    { question: "Checks", allowMultiple: true, options: [{ id: "types", title: "Types", recommended: true }, { id: "tests", title: "Tests" }], defaultOptionIds: ["types", "tests"] },
    { question: "Branch", defaultAnswer: "feature/default" },
  ] }));
  form.choose("types"); form.draft.query = "Types";
  form.index = 1; form.draft.text = "feature/edited"; form.index = 0;
  assert.deepEqual(form.response(), { kind: "selection", selections: ["Tests"], optionIds: ["tests"] });
  assert.deepEqual(form.response(1), { kind: "freeform", text: "feature/edited" });
  assert.equal(form.complete, true);
  const recommended = new AskForm(normalize({ question: "Database", options: [{ id: "pg", title: "Postgres", recommended: true }] }));
  assert.equal(recommended.response(), undefined);
  recommended.choose("pg");
  assert.deepEqual(recommended.response(), { kind: "selection", selections: ["Postgres"], optionIds: ["pg"] });
});

test("external schemas and semantic normalization reject conflicting defaults and batch settings", () => {
  for (const timeoutMs of [-1, Infinity, 0.5, 2147483648]) assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs }), false);
  assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs: 0 }), true);
  for (const params of [
    { question: "Q", options: ["a"], defaultOptionId: "missing" },
    { question: "Q", options: ["a"], allowMultiple: true, defaultOptionId: "option-1" },
    { question: "Q", options: ["a"], defaultOptionIds: ["option-1"] },
    { question: "Q", options: ["a"], defaultAnswer: "x", defaultOptionId: "option-1" },
    { question: "Q", options: ["a"], defaultAnswer: "x", allowFreeform: false },
    { question: "Q", options: [{ id: "a", title: "A" }, { id: "a", title: "B" }] },
    { questions: [{ question: "A" }, { question: "B" }], allowMultiple: true },
  ]) assert.throws(() => normalize(params));
});

test("queued asks start in order and cancelled queued asks never display", async () => {
  const queue = new AskQueue(); const shown: number[] = [];
  let settle!: () => void;
  const first = queue.enqueue(() => new Promise(resolve => { shown.push(1); settle = () => resolve({ status: "answered", responses: [] }); }));
  const abort = new AbortController();
  const second = queue.enqueue(async () => { shown.push(2); return { status: "timed_out", responses: [] }; }, abort.signal);
  const third = queue.enqueue(async () => { shown.push(3); return { status: "timed_out", responses: [] }; });
  abort.abort(); assert.equal((await second).status, "cancelled");
  assert.deepEqual(shown, [1]); settle(); await first; await third;
  assert.deepEqual(shown, [1, 3]);
});
