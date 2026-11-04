import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
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
  return { view, form, results, dock };
}

test("inline layout fits all specified terminal sizes and preserves filtered selections", () => {
  for (const [columns, rows] of [[40, 24], [60, 30], [120, 40]]) {
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
  view.render(40); view.handleInput("\t"); view.handleInput("\r");
  assert.equal(form.index, 1); view.handleInput(" ");
  view.handleInput("\t"); view.handleInput("\r");
  assert.equal(form.index, 2); view.handleInput("\r");
  assert.equal(form.reviewing, true); assert.equal(results.length, 0);
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
  view.render(40); view.handleInput("\x08"); const history = view.render(40);
  assert.ok(history.some(line => line.includes("Branch")));
  view.handleInput("\t"); view.handleInput("x"); view.render(40);
  assert.equal(form.draft.text, "feature/ax");
  view.handleInput("\x08"); view.render(40); assert.equal(form.draft.text, "feature/ax"); view.dispose();
});

test("timeout starts at first render and never submits defaults; answer and expiry settle once", async () => {
  const timed = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 15 });
  await delay(25); assert.deepEqual(timed.results, []);
  timed.view.render(40); await delay(25);
  assert.deepEqual(timed.results, [{ status: "timed_out", responses: [] }]);
  timed.view.handleInput("\r"); assert.equal(timed.results.length, 1);
  const answered = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 15 });
  answered.view.render(40); answered.view.handleInput("\r"); await delay(25);
  assert.equal(answered.results.length, 1); assert.equal(answered.results[0].status, "answered");
  const unlimited = fixture({ question: "Q", defaultAnswer: "yes", timeoutMs: 0 });
  unlimited.view.render(40); await delay(25); assert.deepEqual(unlimited.results, []); unlimited.view.cancel();
});
