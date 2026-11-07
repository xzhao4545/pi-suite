import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import { normalize, askSchema } from "../../src/ask/schema.ts";
import { AskForm } from "../../src/ask/form.ts";
import { askDetails } from "../../src/ask/index.ts";
import { AskQueue } from "../../src/ask/queue.ts";
import { host } from "../support/host.ts";
import { terminal } from "../support/terminal.ts";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AskView } from "../../src/ask/view.ts";

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
  const expired = form.expire();
  const details = askDetails({ questions: [{ question: "A" }, { question: "B" }] }, form.questions, expired);
  assert.equal(details.cancelled, false);
  const missing = new AskForm(normalize({ questions: [{ question: "A" }, { question: "B", defaultAnswer: "draft" }] }));
  const missingDetails = askDetails({ questions: [{ question: "A" }, { question: "B" }] }, missing.questions, missing.expire());
  assert.ok("answers" in missingDetails);
  assert.deepEqual(missingDetails.answers,
    [{ status: "unanswered" }, { status: "answered", response: { kind: "freeform", text: "draft", autoSelected: true } }]);
  const recommended = new AskForm(normalize({ question: "Database", options: [{ id: "pg", title: "Postgres", recommended: true }] }));
  assert.equal(recommended.response(), undefined);
  recommended.choose("pg");
  assert.deepEqual(recommended.response(), { kind: "selection", selections: ["Postgres"], optionIds: ["pg"] });
});

test("native ask results terminate only system cancellation and preserve automatic-answer provenance", async () => {
  for (const status of ["answered", "skipped", "timed_out", "cancelled"] as const) {
    let ctx!: ExtensionContext;
    const h = await host({ extend: pi => { pi.on("session_start", (_event, context) => { ctx = context; }); },
      ui: ui => ({ ...ui, custom: (async factory => new Promise(resolve => {
        Promise.resolve(factory(terminal(), ui.theme, {} as never, resolve)).then(component => {
          const view = component as AskView; view.render(40);
          if (status === "answered") { view.handleInput("\r"); view.handleInput("\r"); }
          else if (status === "skipped") view.handleInput("\x1b");
          else if (status === "cancelled") view.cancel();
        });
      })) as ExtensionUIContext["custom"] }) });
    try {
      const result = await h.session.getToolDefinition("ask_user")!.execute("ask-contract", {
        question: "Q", defaultAnswer: "draft", timeoutMs: status === "timed_out" ? 1 : 0,
      }, new AbortController().signal, undefined, ctx as never);
      assert.equal(result.terminate, status === "cancelled");
      const details = result.details as { status: string; cancelled: boolean; response: { text: string; autoSelected?: true } | null };
      assert.equal(details.status, status); assert.equal(details.cancelled, status === "skipped" || status === "cancelled");
      if (status === "timed_out") assert.equal(details.response?.autoSelected, true);
      if (status === "skipped") assert.equal(details.response?.text, 'draft');
    } finally { await h.dispose(); }
  }
});

test("external schemas and semantic normalization reject conflicting defaults and batch settings", () => {
  for (const timeoutMs of [-1, Infinity, 0.5, 2147483648]) assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs }), false);
  assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs: 0 }), true);
  assert.equal(Value.Check(askSchema, { question: 'Q', allowFreeform: false }), false);
  assert.equal(Value.Check(askSchema, { questions: [{ question: 'A', allowFreeform: false }, { question: 'B' }] }), false);
  for (const params of [
    { question: "Q", options: ["a"], defaultOptionId: "missing" },
    { question: "Q", options: ["a"], allowMultiple: true, defaultOptionId: "option-1" },
    { question: "Q", options: ["a"], defaultOptionIds: ["option-1"] },
    { question: "Q", options: ["a"], defaultAnswer: "x", defaultOptionId: "option-1" },
    { question: "Q", options: [{ id: "a", title: "A" }, { id: "a", title: "B" }] },
    { questions: [{ question: "A" }, { question: "B" }], allowMultiple: true },
  ]) assert.throws(() => normalize(params));
});

test("native skip returns selected options, text and unanswered positions to the model and details", async () => {
  let ctx!: ExtensionContext;
  const h = await host({ extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); },
    ui: ui => ({ ...ui, custom: (async factory => new Promise(resolve => {
      Promise.resolve(factory(terminal(), ui.theme, {} as never, resolve)).then(component => {
        const view = component as AskView; view.render(80);
        view.handleInput(' '); view.handleInput('\x1b[C'); view.handleInput('\x1b[C');
        view.handleInput(' '); view.handleInput('\x1b[B'); view.handleInput(' ');
        view.handleInput('\x1b[C'); view.handleInput('\r'); view.handleInput('partial');
        view.handleInput('\x1b'); view.handleInput('\x1b');
      });
    })) as ExtensionUIContext['custom'] }) });
  try {
    const result = await h.session.getToolDefinition('ask_user')!.execute('partial', { questions: [
      { question: 'Single', options: ['A', 'B'] }, { question: 'Unanswered', options: ['X'] },
      { question: 'Multi', options: ['C', 'D'], allowMultiple: true }, { question: 'Text' },
    ], timeoutMs: 0 }, new AbortController().signal, undefined, ctx as never);
    const expected = { status: 'skipped', cancelled: true, kind: 'batch',
      answers: [
        { status: 'answered', response: { kind: 'selection', selections: ['A'], optionIds: ['option-1'] } },
        { status: 'unanswered' },
        { status: 'answered', response: { kind: 'selection', selections: ['C', 'D'], optionIds: ['option-1', 'option-2'] } },
        { status: 'answered', response: { kind: 'freeform', text: 'partial' } },
      ] };
    assert.equal(result.terminate, false);
    assert.ok(result.content[0].type === 'text');
    assert.partialDeepStrictEqual(JSON.parse(result.content[0].text), expected);
    assert.partialDeepStrictEqual(result.details, expected);
  } finally { await h.dispose(); }
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
