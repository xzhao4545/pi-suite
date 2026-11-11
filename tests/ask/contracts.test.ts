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
      // One numbered encoding for both shapes; automation belongs to each answer.
      assert.deepEqual(result.content, [{ type: "text", text: {
        answered: "answered\n1. Q → custom: draft", skipped: "skipped (not consent)\n1. Q → custom: draft",
        timed_out: "timed_out (not consent)\n1. Q → custom: draft (auto-selected)", cancelled: "cancelled" }[status] }]);
      const details = result.details as { status: string; cancelled: boolean; response: { text: string; autoSelected?: true } | null };
      assert.equal(details.status, status); assert.equal(details.cancelled, status === "skipped" || status === "cancelled");
      if (status === "timed_out") assert.equal(details.response?.autoSelected, true);
      if (status === "skipped") assert.equal(details.response?.text, 'draft');
    } finally { await h.dispose(); }
  }
});

test("ask text contracts preserve answers, comments and parent provenance without echoing request details", () => {
  const single = { question: '选型', options: [{ title: '方案A', description: '说明', recommended: true }, '方案B'] };
  const batch = { question: '批量标题', questions: [{ question: '数据\n库选型', options: ['PostgreSQL'] },
    { question: '是否加缓存' }, { question: '部🙂'.repeat(31) }] };
  const selected = { kind: 'selection' as const, selections: ['方案A'], optionIds: ['option-1'] };
  const duplicate = { question: '同名选项', allowMultiple: true,
    options: [{ id: 'first', title: 'Same' }, { id: 'second', title: 'Same' }, 'Other'] };
  const longText = '保留🙂所有内容'.repeat(30) + '\n  末尾';
  const cases: [AskParams, AskResult, string][] = [
    [single, { status: 'answered', responses: [{ kind: 'selection', selections: ['方案B'], optionIds: ['option-2'], comment: '按此执行' }] },
      'answered\n1. 选型 → 方案B\n   comment: 按此执行'],
    [{ ...single, options: ['A', 'B', 'C'], allowMultiple: true }, { status: 'answered', responses: [{ kind: 'selection', selections: ['A', 'C'], optionIds: ['option-1', 'option-3'], text: '另外加个日志' }] },
      'answered\n1. 选型 → A, C + custom: 另外加个日志'],
    [single, { status: 'answered', responses: [{ kind: 'freeform', text: '用 SQLite' }] }, 'answered\n1. 选型 → custom: 用 SQLite'],
    [single, { status: 'timed_out', responses: [{ ...selected, autoSelected: true }] }, 'timed_out (not consent)\n1. 选型 → 方案A (auto-selected)'],
    [single, { status: 'timed_out', responses: [] }, 'timed_out (not consent)\n1. 选型 → unanswered'],
    [single, { status: 'skipped', responses: [selected] }, 'skipped (not consent)\n1. 选型 → 方案A'],
    [single, { status: 'skipped', responses: [undefined] }, 'skipped (not consent)\n1. 选型 → unanswered'],
    [single, { status: 'cancelled', responses: [] }, 'cancelled'],
    [batch, { status: 'skipped', responses: [{ kind: 'selection', selections: ['PostgreSQL'], optionIds: ['option-1'] },
      { kind: 'freeform', text: '先不加', comment: '之后评估' }, undefined] },
      `skipped (not consent)\n1. 数据 库选型 → PostgreSQL\n2. 是否加缓存 → custom: 先不加\n   comment: 之后评估\n3. ${'部🙂'.repeat(11)}部… → unanswered`],
    [batch, { status: 'timed_out', responses: [undefined, { kind: 'freeform', text: '先不加', autoSelected: true }, undefined] },
      `timed_out (not consent)\n1. 数据 库选型 → unanswered\n2. 是否加缓存 → custom: 先不加 (auto-selected)\n3. ${'部🙂'.repeat(11)}部… → unanswered`],
    [duplicate, { status: 'answered', responses: [{ kind: 'selection', selections: ['Same'], optionIds: ['second'] }] },
      'answered\n1. 同名选项 → #2 Same'],
    [duplicate, { status: 'answered', responses: [{ kind: 'selection', selections: ['Same', 'Same', 'Other'], optionIds: ['first', 'second', 'option-3'] }] },
      'answered\n1. 同名选项 → #1 Same, #2 Same, Other'],
    [{ question: '原文', options: [longText], allowMultiple: true }, { status: 'answered', responses: [{ kind: 'selection', selections: [longText], optionIds: ['option-1'], text: longText, comment: longText }] },
      `answered\n1. 原文 → ${longText} + custom: ${longText}\n   comment: ${longText}`],
    [single, { status: 'answered', responses: [{ kind: 'freeform', text: longText, comment: longText }] },
      `answered\n1. 选型 → custom: ${longText}\n   comment: ${longText}`],
    [{ questions: [{ question: '自动' }, { question: '显式' }] }, { status: 'skipped', responses: [
      { kind: 'freeform', text: 'draft', autoSelected: true }, { kind: 'freeform', text: 'user' }] },
      'skipped (not consent)\n1. 自动 → custom: draft (auto-selected)\n2. 显式 → custom: user'],
  ];
  for (const [params, result, text] of cases) {
    const questions = normalize(params), expected = askDetails(params, questions, result);
    assert.deepEqual(askToolResult(params, questions, result), { content: [{ type: 'text', text }], details: expected });
    assert.deepEqual(askToolResult(params, questions, result, 'parent'), {
      content: [{ type: 'text', text: `${text}\nsource: parent` }], details: { ...expected, source: 'parent' },
    });
    assert.ok(!('context' in expected));
    if ('questions' in expected) assert.ok(expected.questions.every(question => !('context' in question)));
    assert.doesNotMatch(text, /option-\d/);
  }
  assert.deepEqual(askDetails(single, normalize(single), { status: 'answered', responses: [selected] }), {
    status: 'answered', cancelled: false, question: '选型', options: [
      { id: 'option-1', title: '方案A', description: '说明', recommended: true }, { id: 'option-2', title: '方案B' },
    ], response: selected,
  });
});

test("external schemas and semantic normalization reject conflicting defaults and batch settings", () => {
  for (const timeoutMs of [-1, Infinity, 0.5, 2147483648]) assert.equal(Value.Check(askSchema, { question: "Q", timeoutMs }), false);
  const titled: AskParams = { questions: [{ title: 'Scope', question: 'Which application area?' }, { question: 'Which database?' }] };
  assert.equal(Value.Check(askSchema, titled), true);
  assert.equal(normalize(titled)[0].title, 'Scope');
  const details = askDetails(titled, normalize(titled), { status: 'skipped', responses: [] });
  assert.ok('questions' in details);
  assert.equal(details.questions[0].title, 'Scope');
  assert.deepEqual(details.answers, [{ status: 'unanswered' }, { status: 'unanswered' }]);
  const legacy = { question: 'Single', context: 'HISTORICAL_CONTEXT', options: [{ title: 'A', description: 'OPTION_DESCRIPTION' }] };
  const legacyBatch = { questions: [legacy, { question: 'B', context: 'OTHER_CONTEXT' }] };
  for (const params of [legacy, legacyBatch]) {
    assert.equal(Value.Check(askSchema, params), false, 'context is rejected at the current parameter boundary');
    const questions = normalize(params);
    assert.ok(questions.every(question => !('context' in question)));
    assert.equal(questions[0].options[0].description, 'OPTION_DESCRIPTION');
    assert.doesNotMatch(JSON.stringify(askDetails(params, questions, { status: 'skipped', responses: [] })), /CONTEXT/);
  }
  // TypeBox's static property types do not carry annotations; read them through a narrow shape.
  const annotation = (schema: unknown) => (schema as { description?: string }).description ?? '';
  assert.match(annotation(askSchema.properties.timeoutMs), /inactivity/);
  assert.match(annotation((askSchema.properties.questions as { items?: { properties: { title?: unknown } } }).items?.properties.title), /tab title/);
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
    assert.equal(result.content[0].text, ['skipped (not consent)', '1. Single → A', '2. Unanswered → unanswered',
      '3. Multi → C, D + custom: multi text', '4. Text → custom: partial'].join('\n'));
    assert.partialDeepStrictEqual(result.details, expected);
    const history = new ToolExecutionComponent('ask_user', 'partial', params, { outputPad: 0 }, tool, terminal(), process.cwd());
    history.updateResult({ ...result, isError: false }); history.setExpanded(true);
    const text = history.render(120).map(stripVTControlCharacters).join('\n');
    assert.match(text, /☑ C/); assert.match(text, /☑ D/); assert.match(text, /☑ ✎ multi text/);
    assert.doesNotMatch(text, /Type your own answer/);
    // Persisted details, not the model-facing encoding, own historical expansion.
    history.updateResult({ ...result, content: [{ type: 'text', text: JSON.stringify(result.details) }], isError: false });
    assert.equal(history.render(120).map(stripVTControlCharacters).join('\n'), text);
    // Old persisted details render literally without entering current normalization
    // or being rewritten. A fresh tool result never carries these legacy fields.
    const legacySingle = { question: 'Legacy single', context: 'SINGLE_CONTEXT',
      options: [{ title: 'Legacy option', description: 'OPTION_DESCRIPTION' }] };
    const legacyBatch = { questions: [{ ...legacySingle, context: 'BATCH_CONTEXT' }, { question: 'Other' }] };
    for (const legacyParams of [legacySingle, legacyBatch]) {
      const questions = normalize(legacyParams), response = { kind: 'selection' as const, selections: ['Legacy option'], optionIds: ['option-1'] };
      const record = askDetails(legacyParams, questions, { status: 'timed_out', responses: [{ ...response, autoSelected: true }] });
      const legacyDetails = 'questions' in record ? { ...record,
        questions: record.questions.map((question, index) => Object.freeze({ ...question, context: index ? undefined : 'BATCH_CONTEXT' })), source: 'parent' as const,
      } : { ...record, context: 'SINGLE_CONTEXT', source: 'parent' as const };
      Object.freeze(legacyDetails);
      const snapshot = JSON.stringify(legacyDetails);
      const restored = new ToolExecutionComponent('ask_user', 'legacy', legacyParams, { outputPad: 0 }, tool, terminal(), process.cwd());
      restored.updateResult({ content: [{ type: 'text', text: 'OLD_MODEL_CONTENT' }], details: legacyDetails, isError: false });
      restored.setExpanded(true);
      const rendered = restored.render(120).map(stripVTControlCharacters).join('\n');
      assert.match(rendered, /context: (SINGLE|BATCH)_CONTEXT/);
      assert.match(rendered, /description: OPTION_DESCRIPTION/);
      assert.match(rendered, /source: parent/); assert.match(rendered, /auto-selected · not consent/);
      assert.doesNotMatch(rendered, /OLD_MODEL_CONTENT/);
      assert.equal(JSON.stringify(legacyDetails), snapshot);
    }
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
