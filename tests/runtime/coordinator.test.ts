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
import { host } from "../support/host.ts";
import { agentRuntime } from "../../src/agents/runtime.ts";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";
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
  publisher.setGoal("⏳ goal"); publisher.setActivities("agents", ["a", "a", "b"]); publisher.setActivities("jobs", ["j"]);
  assert.deepEqual(writes.at(-1), ["pi-suite:runtime", "🤖2"]);
  const length = writes.length, before = renders;
  publisher.setActivities("agents", ["b", "a"]); publisher.setActivities("jobs", ["another-job"]); publisher.setGoal("⏳ goal");
  assert.equal(writes.length, length); assert.equal(renders, before, 'unchanged summaries do not invalidate Dock');
  assert.ok(dock.render(40).some(line => line.includes("Jobs") && line.includes("1 active")));
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
  dock.register('tasks', { title: 'Tasks', rows: () => [
    {id: 'parent', text: 'parent', priority: 40}, {id: 'child', parentId: 'parent', text: 'child', priority: 45},
    {id: 'other', text: 'other', priority: 30},
  ] });
  const tui = terminal(40, 40);
  const dockContext = {mode: 'tui', ui: {setWidget: (_key: string, factory?: (tui: ReturnType<typeof terminal>) => unknown) => factory?.(tui),
    onTerminalInput: () => () => {}}} as unknown as ExtensionContext;
  dock.bind(dockContext, 12);
  const panel = dock.render(40);
  assert.match(panel[0], /waiting\(parent\)/);
  assert.ok(panel.every(line => !line.includes('hidden job')));
  assert.ok(panel.findIndex(line => line.includes('child')) > panel.findIndex(line => line.includes('├─ parent')));
  dock.bind(dockContext, 1);
  assert.equal(dock.render(40).length, 1);
  const askHeight = dock.askBudget(40);
  dock.setAsk(true); assert.deepEqual(dock.render(40), []);
  assert.equal(dock.askBudget(40), askHeight, 'Ask height is independent of the idle Dock cap');
  publisher.detach();
});

test('empty editor enters Dock with left and Enter opens the selected agent through the suite binding', {timeout: 15000}, async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const tui = terminal(40, 120), gate = Promise.withResolvers<void>(), started = Promise.withResolvers<void>(), opened = Promise.withResolvers<void>();
  let dock!: Dock, ctx!: ExtensionContext, input!: (data: string) => {consume?: boolean} | undefined, detached = 0;
  const h = await host({tools: ['agent_start'], extend: pi => { pi.on('session_start', (_event, context) => {ctx = context;}); },
    ui: ui => ({...ui,
      setWidget: (_key, factory) => { if (typeof factory === 'function') dock = factory(tui, ui.theme) as Dock; },
      onTerminalInput: handler => { input = handler; return () => {detached++;}; },
      custom: async factory => new Promise(resolve => {
        Promise.resolve(factory(tui, ui.theme, {} as never, resolve)).then(view => {
          assert.match(view.render(120).join('\n'), /Subagents.*Transcript/);
          view.handleInput?.('\x1b'); opened.resolve();
        });
      }),
    }),
  });
  try {
    h.faux.setResponses([async () => {started.resolve(); await gate.promise; return fauxAssistantMessage('done');}]);
    await h.session.getToolDefinition('agent_start')!.execute('dock-start', {prompt: 'Dock agent', name: 'Dock contract'}, new AbortController().signal, undefined, ctx as never);
    await started.promise;
    const manager = agentRuntime(), run = [...manager.runs.values()][0];
    run.record.usage = {tokens: {input: 12000, output: 3400, cacheRead: 0, cacheWrite: 0, total: 15400}, cost: 0};
    run.record.toolUses = 4; manager.changed();
    const entries = h.session.sessionManager.getBranch().length;
    run.startedMonotonic = performance.now() - 12340; t.mock.timers.tick(1000);
    assert.equal(h.session.sessionManager.getBranch().length, entries, 'Dock ticking never appends session entries');
    assert.deepEqual(input('\x1b[D'), {consume: true});
    for (const width of [40, 120]) {
      const lines = dock.render(width);
      assert.ok(lines.some(line => line.includes('Enter') && line.includes('Esc')));
      assert.ok(lines.some(line => line.includes('> Dock con')));
      assert.ok(lines.some(line => line.includes('1 running')));
      assert.ok(lines.some(line => line.includes('running · 12.3s')));
      if (width === 120) assert.match(lines.join('\n'), /↑12000 ↓3400 · 4 tools/);
      else assert.ok(lines.every(line => !line.includes('↑12000')), 'narrow rows omit tokens before tools');
      assert.ok(lines.length <= dock.budget() && lines.every(line => visibleWidth(line) <= width));
    }
    assert.equal(input('\x1b[13;1:3u'), undefined, 'kitty release cannot open the agent');
    assert.deepEqual(input('\r'), {consume: true}); await opened.promise;
    assert.ok(dock.render(120).every(line => !line.includes('Enter open')));
    assert.equal(h.notices.some(notice => notice.type === 'error'), false);
  } finally {
    gate.resolve(); await Promise.all([...agentRuntime().runs.values()].map(run => run.done.promise));
    await h.dispose(); t.mock.timers.reset(); assert.equal(detached, 1, 'shutdown releases the terminal listener');
  }
});

test('Dock leaves nonempty editors and other focused components untouched; selection follows row identity', async () => {
  const dock = new Dock(), tui = terminal(40, 120), opened: string[] = [];
  let text = 'editing', input!: (data: string) => {consume?: boolean} | undefined, detached = 0;
  const editor = {render: () => [], invalidate() {}, capturesViewportInput: false, getText: () => text, setText: (value: string) => {text = value;}};
  tui.setFocus(editor);
  let rows = [{id: 'a', text: 'agent a', priority: 25}, {id: 'b', text: 'agent b', priority: 25}];
  dock.register('agents', {title: 'Agents', rows: () => rows, open: id => {opened.push(id);}});
  dock.register('tasks', {title: 'Tasks', rows: () => [{id: 'task', text: 'task', priority: 100}]});
  const ctx = {mode: 'tui', ui: {getEditorText: () => text, notify() {},
    setWidget: (_key: string, factory?: (terminal: typeof tui) => unknown) => factory?.(tui),
    onTerminalInput: (handler: typeof input) => {input = handler; return () => {detached++;};},
  }} as unknown as ExtensionContext;
  dock.bind(ctx, 12);
  assert.equal(input('\x1b[D'), undefined, 'left remains editor cursor movement');
  text = ''; editor.capturesViewportInput = true;
  assert.equal(input('\x1b[D'), undefined, 'autocomplete retains editor navigation'); editor.capturesViewportInput = false;
  assert.deepEqual(input('\x1b[D'), {consume: true}); input('\x1b[B');
  rows = [rows[1], rows[0]]; assert.ok(dock.render(120).some(line => line.includes('> agent b')));
  rows = [rows[1]]; assert.ok(dock.render(120).some(line => line.includes('> agent a')));
  input('\r'); await Promise.resolve(); assert.deepEqual(opened, ['a']);
  for (const hide of [(value: boolean) => dock.setAsk(value), (value: boolean) => dock.setDetail(value)]) {
    input('\x1b[D'); hide(true); assert.equal(input('\x1b[D'), undefined); hide(false);
    assert.ok(dock.render(120).every(line => !line.includes('Enter open')));
  }
  input('\x1b[D'); tui.setFocus({render: () => [], invalidate() {}});
  assert.equal(input('\x1b[D'), undefined); tui.setFocus(editor);
  assert.ok(dock.render(120).every(line => !line.includes('Enter open')));
  input('\x1b[D'); assert.equal(input('x'), undefined);
  input('\x1b[D'); assert.deepEqual(input('\x1b[C'), {consume: true});
  const oldInput = input; dock.bind(ctx, 12); assert.equal(detached, 1);
  dock.detach(); assert.equal(detached, 2); assert.equal(oldInput('\x1b[D'), undefined);
  rows = []; dock.bind(ctx, 12); assert.equal(input('\x1b[D'), undefined); dock.detach();
});
