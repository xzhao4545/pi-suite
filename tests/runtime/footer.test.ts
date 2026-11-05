import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { FooterComponent, type ExtensionContext, type ExtensionUIContext, type ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { host, goalId } from "../support/host.ts";
import { agentDir, testShell } from "../support/jobs.ts";
import { terminal } from "../support/terminal.ts";
import { agentRuntime } from "../../src/agents/runtime.ts";
import { acquireRuntime } from "../../src/jobs/runtime.ts";
import { loadConfig } from "../../src/runtime/config.ts";
import { AskView } from "../../src/ask/view.ts";
import { Dock } from "../../src/ui/dock.ts";

test("native Pi footer reads the goal status slot and budgets one visible status row at all widths", async () => {
  const h = await host();
  try {
    const footer = new FooterComponent(h.session, { getGitBranch: () => null, getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
      getExtensionStatuses: () => new Map([...h.statuses].filter((entry): entry is [string, string] => entry[1] !== undefined)),
    });
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", { goalId: goalId(context), reason: "External event" }))]);
    await h.session.prompt("/goal Display waiting goal"); await h.idle();
    for (const width of [40, 60, 120]) {
      const lines = footer.render(width);
      assert.equal(lines.length, 3); assert.match(lines[2], /goal 待任务/);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    const calls = h.faux.state.callCount;
    await h.session.prompt("/goal clear");
    assert.equal(footer.render(40).length, 2); assert.equal(h.faux.state.callCount, calls);
    footer.dispose();
  } finally { await h.dispose(); }
});

test("published pi-starship footer coexists with real suite execution and ask at phone and desktop sizes", {timeout: 15000}, async () => {
  // Load the complete MIT release through Pi's own extension loader, including its
  // formatter, runtime snapshots and ANSI wrapping. Version/integrity live in the lock and sources.json.
  const release = createRequire(import.meta.url).resolve("@narumitw/pi-starship/package.json");
  assert.equal(JSON.parse(readFileSync(release, "utf8")).version, "0.65.2");
  const root = agentDir(), caps = getCapabilities(), tui = terminal();
  let rows = 24, columns = 40, ctx!: ExtensionContext, footer: (Component & {dispose?(): void}) | undefined, dock!: Dock;
  Object.defineProperties(tui.terminal, {rows: {get: () => rows}, columns: {get: () => columns}});
  setCapabilities({...caps, trueColor: true});
  const statuses = new Map<string, string>(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const askReady = Promise.withResolvers<AskView>();
  const data: ReadonlyFooterDataProvider = {getGitBranch: () => null, getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {}, getExtensionStatuses: () => statuses};
  const base = 'format = "会话模块共存目标验收 $model$thinking$context $extension_status"\n';
  const options = '[extension_status]\nseparator = " · "\nicons = {goal = "", "pi-suite:runtime" = ""}\n';
  writeFileSync(join(root, "pi-starship.toml"), base + options);
  const h = await host({root, tools: ["task_edit"], additionalExtensionPaths: [join(dirname(release), "dist/index.ts")],
    extend: pi => { pi.on("session_start", (_event, context) => { ctx = context; }); },
    ui: ui => ({...ui,
      setStatus(key, value) { ui.setStatus(key, value); if (value === undefined) statuses.delete(key); else statuses.set(key, value); },
      setFooter(factory) { footer?.dispose?.(); footer = factory?.(tui, ui.theme, data); },
      setWidget(_key, content) { if (typeof content === "function") dock = content(tui, ui.theme) as Dock; },
      custom: (async factory => new Promise(resolve => {
        Promise.resolve(factory(tui, ui.theme, {} as never, resolve)).then(view => { assert.ok(view instanceof AskView); askReady.resolve(view); });
      })) as ExtensionUIContext["custom"],
    })});
  const text = (lines: string[]) => lines.map(stripVTControlCharacters).join(" ");
  const sizes = [[40, 24], [60, 30], [120, 40]] as const;
  const render = (asking?: AskView) => sizes.map(([width, height]) => {
    columns = width; rows = height;
    const foot = footer!.render(width), panel = dock.render(width), ask = asking?.render(width) ?? [];
    assert.ok([...foot, ...panel, ...ask].every(line => visibleWidth(line) <= width));
    assert.ok(panel.length + ask.length <= dock.budget(height), "suite components share their height allowance");
    assert.ok(foot.length + panel.length + ask.length < height * 0.4, "configured external footer leaves chat space");
    assert.ok(!text(panel).includes("goal") && !text(panel).includes("agents 1") && !text(panel).includes("jobs 1"));
    return foot;
  });
  const configure = async (toml: string, display = "status") => {
    writeFileSync(join(root, "pi-starship.toml"), toml);
    writeFileSync(join(root, "pi-suite.json"), JSON.stringify({goal: {display}}));
    await h.session.reload(); assert.ok(footer); assert.ok(dock instanceof Dock);
  };
  try {
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", {goalId: goalId(context), reason: "External event"})),
      async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage("child done"); },
      fauxAssistantMessage(fauxToolCall("ask_user", {question: "是否继续当前任务？", options: ["继续", "等待"], timeoutMs: 0}))]);
    await h.session.prompt("/goal Footer coexistence"); await h.idle();
    await h.session.getToolDefinition("task_edit")!.execute("tasks", {changes: [
      {op: "add", title: "当前任务中文长标题".repeat(7), children: ["执行任务一", "执行任务二"]},
      {op: "update", id: "2", status: "doing"},
    ]}, new AbortController().signal, undefined, ctx as never);
    const child = await agentRuntime().start({prompt: "FOOTER_CHILD", background: true}, {ctx}, loadConfig(root)); await entered.promise;
    const runtime = acquireRuntime(root); assert.equal(runtime.mode, "active"); if (runtime.mode !== "active") assert.fail("jobs unavailable");
    await runtime.manager.start({command: "read line", cwd: root, ownerSessionId: ctx.sessionManager.getSessionId(), anchorEntryId: null}, testShell());
    const calls = h.faux.state.callCount, initial = render();
    assert.ok(initial[0].length > initial[2].length, "the full external format wraps at narrow widths");
    for (const lines of initial) { assert.match(text(lines), /goal\s+待任务/); assert.match(text(lines), /agents 1 · jobs 1/); assert.ok(!text(lines).includes("🔌")); }
    assert.match(text(dock.render(120)), /任务/);

    await configure(base + '[extension_status]\nicons = {goal = "🎯", "pi-suite:runtime" = ""}\nstyles = {goal = "bold fg:#123456"}\n');
    for (const lines of render()) { assert.ok(text(lines).includes("🎯")); assert.match(lines.join(""), /38;2;18;52;86/); }
    ctx.ui.setStatus("earlier", "Earlier provider");
    await configure(base + options + "max_statuses = 1\n");
    for (const lines of render()) { assert.ok(!text(lines).includes("goal") && !text(lines).includes("agents 1")); assert.match(text(lines), /Earlier provider/); }
    await configure(base + options + "disabled = true\n");
    for (const lines of render()) assert.ok(!text(lines).includes("goal") && !text(lines).includes("agents 1"));
    await configure('format = "$model$thinking$context"\n' + options);
    for (const lines of render()) assert.ok(!text(lines).includes("goal") && !text(lines).includes("agents 1"));
    assert.equal(h.faux.state.callCount, calls, "format and size changes do not wake either model");

    await configure(base + options);
    const asking = h.session.prompt("Ask before continuing this goal");
    const view = await askReady.promise;
    await new Promise(resolve => setImmediate(resolve));
    const notice = await runtime.manager.start({command: "echo queued_notice", closeInput: true, cwd: root,
      ownerSessionId: ctx.sessionManager.getSessionId(), anchorEntryId: null}, testShell()); await runtime.manager.wait(notice.id);
    for (const lines of render(view)) { assert.match(text(lines), /goal\s+待答/); assert.match(text(lines), /agents 1 · jobs 1/); }
    assert.equal(h.faux.state.callCount, calls + 1, "the explicit ask turn is the only new model call"); assert.notEqual(child.settled, true);
    view.cancel(); await asking;
    // Explicit placement remains available when an external format omits the slot.
    await configure('format = "$model$context"\n' + options, "dock");
    for (const [width, height] of sizes) {
      columns = width; rows = height;
      assert.ok(!text(footer!.render(width)).includes("goal")); assert.match(text(dock.render(width)), /goal/);
      assert.ok(dock.render(width).length <= dock.budget(height));
    }
    assert.equal(h.faux.state.callCount, calls + 1);
  } finally { gate.resolve(); await h.dispose(); setCapabilities(caps); rmSync(root, {recursive: true, force: true}); }
});
