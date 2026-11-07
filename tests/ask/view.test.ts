import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { defaults } from "../../src/runtime/config.ts";
import { Dock } from "../../src/ui/dock.ts";
import { Transcript } from "../../src/ui/transcript.ts";
import { AskForm } from "../../src/ask/form.ts";
import { normalize, type AskResult, type AskParams } from "../../src/ask/schema.ts";
import { AskView } from "../../src/ask/view.ts";
import { terminal } from "../support/terminal.ts";

function fixture(params: AskParams, rows = 24, columns = 40) {
  initTheme("dark", false);
  // Native components use the same global theme singleton as the actual Pi host.
  const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme") as unknown as keyof typeof globalThis] as unknown as Theme;
  const tui = terminal(rows, columns); const dock = new Dock(); dock.setAsk(true);
  const transcript = new Transcript(tui, process.cwd());
  const results: AskResult[] = [];
  const form = new AskForm(normalize(params));
  const view = new AskView(form, tui, theme, dock, defaults, transcript, result => results.push(result), params.timeoutMs ?? defaults.ask.timeout);
  return { view, form, results, dock, tui };
}

test("inline layout fits all specified terminal sizes and preserves filtered selections", () => {
  for (const [columns, rows] of [24, 30, 40, 60].flatMap(rows => [40, 80, 120].map(columns => [columns, rows]))) {
    const { view, form, dock } = fixture({ question: "中文长标题🙂".repeat(15), allowMultiple: true,
      options: Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, title: `选择${i}🙂`, description: "完整说明\n".repeat(100) + "说明末尾" })),
      defaultOptionIds: ["30"], timeoutMs: 0 }, rows, columns);
    const lines = view.render(columns);
    assert.ok(lines.length <= dock.askBudget(rows));
    lines.forEach(line => assert.ok(visibleWidth(line) <= columns));
    view.handleInput("/"); view.handleInput("选择1"); view.handleInput("\r"); view.render(columns);
    assert.ok(form.draft.selected.has("30"));
    view.handleInput("d"); const detail = view.render(columns);
    assert.ok(detail.length <= Math.floor(rows * 0.8));
    view.handleInput("\x1b[F");
    assert.ok(view.render(columns).some(line => line.includes("说明末尾")));
    view.handleInput("\x1b");
    assert.ok(form.draft.selected.has("30")); view.dispose();
  }
});

test("mixed batches require final confirmation and retain each question's independent defaults", () => {
  const { view, form, results } = fixture({ questions: [
    { question: "Database", options: [{ id: "pg", title: "Postgres", recommended: true }], defaultOptionId: "pg" },
    { question: "Checks", allowMultiple: true, options: ["types", "tests"], defaultOptionIds: ["option-1", "option-2"] },
    { question: "Branch", defaultAnswer: "feature/work" },
  ], timeoutMs: 0 });
  view.render(40); view.handleInput("\r");
  assert.equal(form.index, 1); view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(form.index, 2); view.handleInput("\r"); view.handleInput("\r");
  assert.equal(form.reviewing, true); assert.equal(results.length, 0);
  view.handleInput("\x1b[D"); assert.equal(form.index, 2);
  view.handleInput("\r"); view.handleInput("\r"); assert.equal(form.reviewing, true);
  assert.equal(form.drafts[2].text, "feature/work", "reconfirming text never clears its draft");
  view.render(40); view.handleInput("\r");
  assert.equal(results[0].status, "answered");
  assert.deepEqual(results[0].responses, [
    { kind: "selection", selections: ["Postgres"], optionIds: ["pg"] },
    { kind: "selection", selections: ["tests"], optionIds: ["option-2"] },
    { kind: "freeform", text: "feature/work" },
  ]);
});

test("history and answer share one view and focus changes retain text drafts", () => {
  const { view, form } = fixture({ question: "Branch", defaultAnswer: "feature/a", timeoutMs: 0 });
  view.render(40); view.handleInput("\r"); view.handleInput("\x08"); const history = view.render(40);
  assert.ok(history.some(line => line.includes("Branch")));
  view.handleInput("\t"); view.handleInput("x"); view.render(40);
  assert.equal(form.draft.text, "feature/ax");
  view.handleInput("\x08"); view.render(40); assert.equal(form.draft.text, "feature/ax"); view.dispose();
});

test("idle expiry keeps draft/recommended/first choices and unanswered slots; activity resets and settlement occurs once", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const timed = fixture({ questions: [
    { question: "Draft", options: ["first", "second"], defaultOptionId: "option-2" },
    { question: "Recommended", options: [{ id: "first", title: "first" }, { id: "rec", title: "recommended", recommended: true }] },
    { question: "First", options: ["first", "second"] },
    { question: "Empty text" },
  ], timeoutMs: 60 });
  t.mock.timers.tick(100); assert.deepEqual(timed.results, []);
  timed.view.render(40); t.mock.timers.tick(40);
  timed.view.handleInput("\x1b[C"); t.mock.timers.tick(40); assert.deepEqual(timed.results, []);
  t.mock.timers.tick(20);
  assert.deepEqual(timed.results, [{ status: "timed_out", responses: [
    { kind: "selection", selections: ["second"], optionIds: ["option-2"], autoSelected: true },
    { kind: "selection", selections: ["recommended"], optionIds: ["rec"], autoSelected: true },
    { kind: "selection", selections: ["first"], optionIds: ["option-1"], autoSelected: true }, undefined,
  ] }]);
  timed.view.handleInput("\r"); t.mock.timers.tick(100); assert.equal(timed.results.length, 1);
  const multi = new AskForm(normalize({ question: "Multi", allowMultiple: true,
    options: [{ id: "a", title: "A", recommended: true }, { id: "b", title: "B", recommended: true }] }));
  assert.deepEqual(multi.expire().responses[0], { kind: "selection", selections: ["A", "B"], optionIds: ["a", "b"], autoSelected: true });
  multi.draft.freeform = true; multi.draft.text = "draft"; multi.draft.comment = "reason";
  assert.deepEqual(multi.expire().responses[0], { kind: "freeform", text: "draft", comment: "reason", autoSelected: true });
  assert.deepEqual(new AskForm(normalize({ question: "Empty" })).expire(), { status: "timed_out", responses: [] });
  const answered = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 15 });
  answered.view.render(40); answered.view.handleInput("\r"); answered.view.handleInput("\r"); t.mock.timers.tick(25);
  assert.equal(answered.results.length, 1); assert.equal(answered.results[0].status, "answered");
  const unlimited = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 0 });
  unlimited.view.render(40); t.mock.timers.tick(100); assert.deepEqual(unlimited.results, []); unlimited.view.cancel();
});


test("multi-line choices, tabs, preview and Review details retain identity through expansion and resizing", () => {
  const { view, form, tui } = fixture({ questions: [
    { question: 'Question '.repeat(30), context: 'Background '.repeat(80), allowMultiple: true,
      options: [{ id: 'first', title: 'First', description: 'description line one\ndescription line two' },
        { id: 'second', title: 'Second '.repeat(12), description: 'Preview '.repeat(100) + 'PREVIEW_END' }], defaultOptionIds: ['first'] },
    { question: 'Text question', defaultAnswer: 'Answer '.repeat(30) + 'ANSWER_END' },
  ], timeoutMs: 0 }, 40, 80);
  const mouse = (x: number, y: number, type: 'click' | 'wheel' = 'click') => ({ type, button: 'left' as const, x, y, screenX: x, screenY: y,
    width: tui.terminal.columns, height: tui.terminal.rows, shift: false, alt: false, ctrl: false, wheelDelta: 1 });
  const initial = view.render(80);
  const description = initial.findIndex(line => line.includes('description line two'));
  assert.ok(description > 0);
  view.handleMouse(mouse(8, description));
  assert.equal(form.draft.selected.has('first'), false, 'clicking a continuation row chooses its actual option');
  view.handleInput('e'); const expanded = view.render(80);
  assert.ok(expanded.some(line => line.includes('d 全文')));
  const expandedHeight = expanded.length;
  view.handleInput('\x1b[C'); assert.equal(view.render(80).length, expandedHeight, 'page changes retain height');
  assert.equal(form.draft.text.endsWith('ANSWER_END'), true);
  view.handleInput('\t'); view.handleInput('\r'); // View details remains reachable while text is focused.
  assert.ok(view.render(80).some(line => line.includes('Text question')));
  view.handleInput('\x1b'); view.handleInput('\r'); view.handleInput('\r'); // Review
  view.handleInput('\x1b[B'); view.handleInput('d'); view.render(80); view.handleInput('\x1b[F');
  assert.ok(view.render(80).some(line => line.includes('ANSWER_END')), 'Review full reading contains the answer');
  view.handleInput('\x1b'); view.handleInput('\x1b[C'); // first question
  Object.defineProperties(tui.terminal, { columns: { value: 120, configurable: true }, rows: { value: 60, configurable: true } });
  view.render(120); form.draft.cursor = 1; let wide = view.render(120);
  const selected = new Set(form.draft.selected);
  for (let index = 0; index < 80; index++) view.handleMouse(mouse(105, wide.findIndex(line => line.includes('Preview')) > 0 ? wide.findIndex(line => line.includes('Preview')) : 8, 'wheel'));
  wide = view.render(120);
  assert.equal(form.draft.cursor, 1, 'preview wheel does not move the list cursor');
  assert.deepEqual(form.draft.selected, selected);
  view.dispose();
});

test("every choice permits text and text pages navigate outside explicit editing without losing drafts", () => {
  for (const allowMultiple of [false, true]) {
    const { view, form, results } = fixture({ questions: [
      { question: 'Choice', options: ['A', 'B'], allowMultiple }, { question: 'Text' },
    ], timeoutMs: 0 });
    assert.match(view.render(40).join('\n'), /Type your own answer/);
    view.handleInput('\x1b[B'); view.handleInput('\x1b[B'); view.handleInput('\r');
    assert.equal(form.draft.editing, true);
    view.handleInput('custom'); view.handleInput('\x1b');
    assert.equal(form.draft.editing, false); assert.equal(form.draft.text, 'custom');
    view.handleInput('\x1b[C'); assert.equal(form.index, 1); assert.equal(form.draft.editing, false);
    view.handleInput('\x1b[D'); assert.equal(form.index, 0);
    view.handleInput('\x1b[C'); view.handleInput('\r'); view.handleInput('kept');
    view.handleInput('\x1b'); assert.equal(form.draft.editing, false);
    assert.deepEqual(results, []); assert.equal(form.draft.text, 'kept');
    view.handleInput('\x1b[C'); assert.equal(form.reviewing, true);
    view.handleInput('\x1b[C'); assert.equal(form.index, 0);
    view.handleInput('\x1b[C'); assert.equal(form.index, 1);
    view.handleInput('\r'); view.handleInput(' text'); view.handleInput('\r');
    assert.equal(form.reviewing, true); assert.equal(form.draft.editing, false);
    view.handleInput('\r');
    assert.deepEqual(results, [{ status: 'answered', responses: [
      { kind: 'freeform', text: 'custom' }, { kind: 'freeform', text: 'kept text' },
    ] }]);
  }
});
