import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from 'node:util';
import { ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import { Value } from "typebox/value";
import { normalize, askSchema, type AskParams, type AskResult } from "../../src/ask/schema.ts";
import { AskForm } from "../../src/ask/form.ts";
import { askDetails, askToolResult } from "../../src/ask/result.ts";
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
      // Model-facing text: status and answer only; non-answered statuses label retained answers as not consent.
      assert.deepEqual(result.content, [{ type: "text", text: {
        answered: "answered (custom): draft", skipped: "skipped (custom, not consent): draft",
        timed_out: "timed_out (custom, auto-selected, not consent): draft", cancelled: "cancelled" }[status] }]);
      const details = result.details as { status: string; cancelled: boolean; response: { text: string; autoSelected?: true } | null };
      assert.equal(details.status, status); assert.equal(details.cancelled, status === "skipped" || status === "cancelled");
      if (status === "timed_out") assert.equal(details.response?.autoSelected, true);
      if (status === "skipped") assert.equal(details.response?.text, 'draft');
    } finally { await h.dispose(); }
  }
});

test("ask text contracts preserve answers, comments and parent provenance without echoing request details", () => {
  const single = { question: '选型', context: '背景', options: [{ title: '方案A', description: '说明', recommended: true }, '方案B'] };
  const batch = { question: '批量标题', questions: [{ question: '数据\n库选型', options: ['PostgreSQL'] },
    { question: '是否加缓存' }, { question: '部'.repeat(61) }] };
  const selected = { kind: 'selection' as const, selections: ['方案A'], optionIds: ['option-1'] };
  const cases: [AskParams, AskResult, string][] = [
    [single, { status: 'answered', responses: [{ kind: 'selection', selections: ['方案B'], optionIds: ['option-2'], comment: '按此执行' }] },
      'answered: 方案B (option-2)\ncomment: 按此执行'],
    [{ ...single, options: ['A', 'B', 'C'], allowMultiple: true }, { status: 'answered', responses: [{ kind: 'selection', selections: ['A', 'C'], optionIds: ['option-1', 'option-3'], text: '另外加个日志' }] },
      'answered: A, C (option-1, option-3) + custom: 另外加个日志'],
    [single, { status: 'answered', responses: [{ kind: 'freeform', text: '用 SQLite' }] }, 'answered (custom): 用 SQLite'],
    [single, { status: 'timed_out', responses: [{ ...selected, autoSelected: true }] }, 'timed_out (auto-selected, not consent): 方案A (option-1)'],
    [single, { status: 'timed_out', responses: [] }, 'timed_out (not consent): unanswered'],
    [single, { status: 'skipped', responses: [selected] }, 'skipped (not consent): 方案A (option-1)'],
    [single, { status: 'skipped', responses: [undefined] }, 'skipped: unanswered'],
    [single, { status: 'cancelled', responses: [] }, 'cancelled'],
    [batch, { status: 'skipped', responses: [{ kind: 'selection', selections: ['PostgreSQL'], optionIds: ['option-1'] },
      { kind: 'freeform', text: '先不加', comment: '之后评估' }, undefined] },
      `skipped (not consent) · 2/3 answered\n1. 数据 库选型 → PostgreSQL (option-1)\n2. 是否加缓存 → custom: 先不加\n   comment: 之后评估\n3. ${'部'.repeat(59)}… → unanswered`],
    [batch, { status: 'timed_out', responses: [undefined, { kind: 'freeform', text: '先不加', autoSelected: true }, undefined] },
      `timed_out (auto-selected, not consent) · 1/3 answered\n1. 数据 库选型 → unanswered\n2. 是否加缓存 → custom: 先不加\n3. ${'部'.repeat(59)}… → unanswered`],
  ];
  for (const [params, result, text] of cases) {
    const questions = normalize(params), expected = askDetails(params, questions, result);
    assert.deepEqual(askToolResult(params, questions, result), { content: [{ type: 'text', text }], details: expected });
    assert.deepEqual(askToolResult(params, questions, result, 'parent'), {
      content: [{ type: 'text', text: `${text}\nsource: parent` }], details: { ...expected, source: 'parent' },
    });
  }
});

test("external schemas and semantic normalization reject conflicting defaults and batch settings", () => {
  for (const timeoutMs of [-1, Infinity, 0.5, 2147483648]) assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs }), false);
  const titled: AskParams = { questions: [{ title: 'Scope', question: 'Which application area?' }, { question: 'Which database?' }] };
  assert.equal(Value.Check(askSchema, titled), true);
  assert.equal(normalize(titled)[0].title, 'Scope');
  const details = askDetails(titled, normalize(titled), { status: 'skipped', responses: [] });
  assert.ok('questions' in details);
  assert.equal(details.questions[0].title, 'Scope');
  for (const title of ['', 'x'.repeat(61)]) assert.equal(Value.Check(askSchema, {
    questions: [{ title, question: 'A' }, { question: 'B' }],
  }), false);
  assert.equal(Value.Check(askSchema, { question: 'Single', title: 'Scope' }), false, 'titles belong to batch question entries');
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

test("native skip and history retain preset and custom selections together and keep unanswered positions", async () => {
  let ctx!: ExtensionContext;
  const h = await host({ extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); },
    ui: ui => ({ ...ui, custom: (async factory => new Promise(resolve => {
      Promise.resolve(factory(terminal(), ui.theme, {} as never, resolve)).then(component => {
        const view = component as AskView; view.render(80);
        view.handleInput(' '); view.handleInput('\x1b[C'); view.handleInput('\x1b[C');
        view.handleInput(' '); view.handleInput('\x1b[B'); view.handleInput(' ');
        view.handleInput('f'); view.handleInput('multi text'); view.handleInput('\x1b');
        view.handleInput('\x1b[C'); view.handleInput('\r'); view.handleInput('partial');
        view.handleInput('\x1b'); view.handleInput('\x1b');
      });
    })) as ExtensionUIContext['custom'] }) });
  try {
    const params = { questions: [
      { question: 'Single', options: ['A', 'B'] }, { question: 'Unanswered', options: ['X'] },
      { question: 'Multi', options: ['C', 'D'], allowMultiple: true }, { question: 'Text' },
    ], timeoutMs: 0 };
    const tool = h.session.getToolDefinition('ask_user')!;
    const result = await tool.execute('partial', params, new AbortController().signal, undefined, ctx as never);
    const expected = { status: 'skipped', cancelled: true, kind: 'batch',
      answers: [
        { status: 'answered', response: { kind: 'selection', selections: ['A'], optionIds: ['option-1'] } },
        { status: 'unanswered' },
        { status: 'answered', response: { kind: 'selection', selections: ['C', 'D'], optionIds: ['option-1', 'option-2'], text: 'multi text' } },
        { status: 'answered', response: { kind: 'freeform', text: 'partial' } },
      ] };
    assert.equal(result.terminate, false);
    assert.ok(result.content[0].type === 'text');
    assert.equal(result.content[0].text, ['skipped (not consent) · 3/4 answered', '1. Single → A (option-1)', '2. Unanswered → unanswered',
      '3. Multi → C, D (option-1, option-2) + custom: multi text', '4. Text → custom: partial'].join('\n'));
    assert.partialDeepStrictEqual(result.details, expected);
    const history = new ToolExecutionComponent('ask_user', 'partial', params, { outputPad: 0 }, tool, terminal(), process.cwd());
    history.updateResult({ ...result, isError: false }); history.setExpanded(true);
    const text = history.render(120).map(stripVTControlCharacters).join('\n');
    assert.match(text, /☑ C/); assert.match(text, /☑ D/); assert.match(text, /☑ ✎ multi text/);
    assert.doesNotMatch(text, /Type your own answer/);
    // Persisted details, not the model-facing encoding, own historical expansion.
    history.updateResult({ ...result, content: [{ type: 'text', text: JSON.stringify(result.details) }], isError: false });
    assert.equal(history.render(120).map(stripVTControlCharacters).join('\n'), text);
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
