import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from 'node:util';
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { defaults } from "../../src/runtime/config.ts";
import { Dock } from "../../src/ui/dock.ts";
import { Transcript } from "../../src/ui/transcript.ts";
import { AskForm } from "../../src/ask/form.ts";
import { normalize, type AskResult, type AskParams } from "../../src/ask/schema.ts";
import { AskView } from "../../src/ask/view.ts";
import { questionTabs } from '../../src/ask/render.ts';
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

test('question titles keep visible tab/click identities through narrow layouts, Unicode, answer badges and Review', () => {
  const params: AskParams = { questions: [
    { title: 'Scope', question: 'Which part of the application should we change?', defaultAnswer: 'UI' },
    { question: '数据库🙂选型与部署位置', defaultAnswer: 'Postgres' },
    { title: '\x1b[31mDeploy\t now\x1b[0m', question: 'How should we deploy the application?', defaultAnswer: 'Local' },
    { title: 'Branch', question: 'Which branch should receive these changes?', defaultAnswer: 'main' },
  ], timeoutMs: 0 };
  const { view, form, tui } = fixture(params, 40, 80);
  const theme = globalThis[Symbol.for('@earendil-works/pi-coding-agent:theme') as unknown as keyof typeof globalThis] as unknown as Theme;
  for (const width of [1, 8, 16, 40, 80, 120]) {
    for (let page = 0; page <= form.questions.length; page++) {
      form.reviewing = page === form.questions.length;
      if (!form.reviewing) form.index = page;
      const tabs = questionTabs(form, theme, width), text = stripVTControlCharacters(tabs.line);
      assert.ok(visibleWidth(tabs.line) <= width);
      assert.ok(tabs.regions.some(region => region.page === page), 'active tab remains visible');
      assert.doesNotMatch(text, /Q\d|\t|\n/);
      for (const region of tabs.regions) {
        assert.ok(region.start >= 0 && region.end > region.start && region.end <= visibleWidth(tabs.line));
        assert.equal(visibleWidth(sliceByColumn(tabs.line, region.start, region.end - region.start)), region.end - region.start);
      }
      if (width >= 40) {
        assert.equal(tabs.regions.length, 5); assert.match(text, /Review/);
        assert.equal(text.match(/✓/g)?.length, 4);
      }
      if (width >= 80) assert.match(text, /Scope✓ 数据库🙂选型与部署位置✓ Deploy now✓ Branch✓ Review/);
    }
  }
  for (const width of [40, 80, 120]) {
    Object.defineProperty(tui.terminal, 'columns', { value: width, configurable: true });
    const rendered = view.render(width), row = rendered[1];
    const tabs = questionTabs(form, theme, width >= 50 ? width - 6 : width);
    const inset = width >= 50 ? 3 : 0;
    for (const region of tabs.regions) {
      const x = inset + region.end - 1;
      assert.ok(x < visibleWidth(row));
      assert.equal(view.handleMouse({ type: 'click', button: 'left', x, y: 1, screenX: x, screenY: 1,
        width, height: 40, shift: false, alt: false, ctrl: false })?.handled, true);
      assert.equal(form.reviewing, region.page === 4);
      if (!form.reviewing) assert.equal(form.index, region.page);
    }
  }
  form.reviewing = false; form.index = 0;
  assert.match(view.render(80).map(stripVTControlCharacters).join('\n'), /Which part of the application should we change\?/);
  form.reviewing = true;
  assert.match(view.render(80).map(stripVTControlCharacters).join('\n'), /Which part of the application should we change\?: ✎ UI/);
  view.dispose();
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
  multi.draft.customSelected = true; multi.draft.text = "draft"; multi.draft.comment = "reason";
  assert.deepEqual(multi.expire().responses[0], { kind: "freeform", text: "draft", comment: "reason", autoSelected: true });
  multi.choose('a');
  assert.deepEqual(multi.expire().responses[0], { kind: 'selection', selections: ['A'], optionIds: ['a'],
    text: 'draft', comment: 'reason', autoSelected: true });
  multi.choose();
  assert.deepEqual(multi.expire().responses[0], { kind: 'selection', selections: ['A'], optionIds: ['a'],
    comment: 'reason', autoSelected: true });
  multi.choose('a'); assert.equal(multi.skip().responses[0], undefined, 'deselected text is retained but not submitted');
  assert.equal(multi.draft.text, 'draft');
  assert.deepEqual(new AskForm(normalize({ question: "Empty" })).expire(), { status: "timed_out", responses: [] });
  const answered = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 15 });
  answered.view.render(40); answered.view.handleInput("\r"); answered.view.handleInput("\r"); t.mock.timers.tick(25);
  assert.equal(answered.results.length, 1); assert.equal(answered.results[0].status, "answered");
  const unlimited = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 0 });
  unlimited.view.render(40); t.mock.timers.tick(100); assert.deepEqual(unlimited.results, []); unlimited.view.cancel();
});


test("multi-line choices, tabs, preview and Review details retain identity through expansion and resizing", () => {
  const { view, form, tui } = fixture({ questions: [
    { question: 'Question '.repeat(30), allowMultiple: true,
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
  assert.ok(expanded.some(line => line.includes('e collapse')));
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
    view.handleInput(' ');
    view.handleInput('\x1b[B'); view.handleInput('\x1b[B'); view.handleInput('\r');
    assert.equal(form.draft.editing, true);
    view.handleInput('custom'); view.handleInput('\x1b');
    assert.equal(form.draft.editing, false); assert.equal(form.draft.text, 'custom');
    const rendered = () => view.render(40).map(stripVTControlCharacters).join('\n');
    assert.match(rendered(), allowMultiple ? /☑ ✎ custom/ : /◉ ✎ custom/);
    assert.doesNotMatch(rendered(), /Type your own answer/);
    if (allowMultiple) {
      view.handleInput(' '); assert.match(rendered(), /☐ ✎ custom/);
      assert.deepEqual(form.response(), { kind: 'selection', selections: ['A'], optionIds: ['option-1'] });
      view.handleInput(' '); assert.match(rendered(), /☑ ✎ custom/);
    } else {
      view.handleInput('\x1b[A'); view.handleInput(' ');
      assert.deepEqual(form.response(), { kind: 'selection', selections: ['B'], optionIds: ['option-2'] });
      view.handleInput('\x1b[B'); assert.match(rendered(), /○ ✎ custom/);
      view.handleInput(' '); assert.match(rendered(), /◉ ✎ custom/);
    }
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
      allowMultiple ? { kind: 'selection', selections: ['A'], optionIds: ['option-1'], text: 'custom' }
        : { kind: 'freeform', text: 'custom' },
      { kind: 'freeform', text: 'kept text' },
    ] }]);
  }
  const long = fixture({ question: 'Custom', options: ['A'], defaultAnswer: 'Long custom '.repeat(15) + 'CUSTOM_END', timeoutMs: 0 }, 40, 80);
  assert.match(long.view.render(80).join('\n'), /e expand/);
  long.view.handleInput('e');
  assert.match(long.view.render(80).join('\n'), /CUSTOM_END/);
  long.view.handleInput('d'); long.view.render(80); long.view.handleInput('\x1b[F');
  assert.match(long.view.render(80).join('\n'), /CUSTOM_END/);
  long.view.dispose();
});
