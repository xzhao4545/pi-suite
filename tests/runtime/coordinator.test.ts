import { contentText } from '@earendil-works/pi-ai';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from 'node:util';
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../src/runtime/config.ts";
import { SessionBinding } from "../../src/runtime/binding.ts";
import { Notifications } from "../../src/runtime/notifications.ts";
import { Dock } from "../../src/ui/dock.ts";
import { dockWindow } from '../../src/ui/dock/rows.ts';
import { StatusPublisher } from "../../src/ui/status.ts";
import { recordStyle, selectedRow, stateTone } from '../../src/ui/browser-chrome.ts';
import { BrowserView, browseState } from '../../src/ui/browser.ts';
import { jobLabel, jobStatus } from '../../src/jobs/index.ts';
import type { JobSummary } from '../../src/jobs/types.ts';
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
  const notifications = new Notifications({ sendMessage: message => { sent.push(contentText(message.content)); } } as ExtensionAPI, binding);
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
  assert.ok(panel.findIndex(line => line.includes('Tasks')) < panel.findIndex(line => line.includes('Agents')), 'source order is independent of waiting priority');
  assert.match(panel.join('\n'), /waiting\(parent\)/);
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
          assert.match(stripVTControlCharacters(view.render(120).join('\n')), /Dock contract · running/);
          view.handleInput?.('\x1b'); opened.resolve();
        });
      }),
    }),
  });
  try {
    h.faux.setResponses([async () => {started.resolve(); await gate.promise; return fauxAssistantMessage('done');}]);
    await h.session.getToolDefinition('agent_start')!.execute('dock-start', {prompt: 'Dock agent', name: 'Dock contract'}, new AbortController().signal, undefined, ctx as never);
    await started.promise;
    const manager = agentRuntime().owner, run = [...manager.runs.values()][0];
    run.record.usage = {tokens: {input: 12000, output: 3400, cacheRead: 0, cacheWrite: 0, total: 15400}, cost: 0};
    run.record.toolUses = 4; manager.changed();
    const entries = h.session.sessionManager.getBranch().length;
    run.startedMonotonic = performance.now() - 12750; t.mock.timers.tick(1000);
    assert.equal(h.session.sessionManager.getBranch().length, entries, 'Dock ticking never appends session entries');
    assert.deepEqual(input('\x1b[D'), {consume: true});
    for (const width of [40, 120]) {
      const lines = dock.render(width).map(stripVTControlCharacters);
      assert.ok(lines.some(line => line.includes('Enter') && line.includes('Esc')));
      assert.ok(lines.some(line => line.includes('Dock con')));
      assert.ok(lines.some(line => line.includes('1 running')));
      assert.match(lines.join('\n'), /running · 12s\b/);
      if (width === 120) assert.match(lines.join('\n'), /↑12k ↓3\.4k · 4 tools/);
      else assert.ok(lines.every(line => !line.includes('↑12k')), 'narrow rows omit tokens before tools');
      assert.ok(lines.length <= dock.budget() && lines.every(line => visibleWidth(line) <= width));
    }
    assert.equal(input('\x1b[13;1:3u'), undefined, 'kitty release cannot open the agent');
    assert.deepEqual(input('\r'), {consume: true}); await opened.promise;
    assert.ok(dock.render(120).every(line => !line.includes('Enter open')));
    assert.equal(h.notices.some(notice => notice.type === 'error'), false);
  } finally {
    gate.resolve(); await Promise.all([...agentRuntime().owner.runs.values()].map(run => run.done.promise));
    await h.dispose(); t.mock.timers.reset(); assert.equal(detached, 1, 'shutdown releases the terminal listener');
  }
});

test('Dock leaves nonempty editors and other focused components untouched; selection follows row identity', async () => {
  const dock = new Dock(), tui = terminal(40, 120), opened: string[] = [];
  const theme = {fg: (_tone: string, text: string) => text, bold: (text: string) => text,
    bg: (_tone: string, text: string) => `\x1b[44m${text}\x1b[49m`, getBgAnsi: () => '\x1b[44m'} as unknown as Theme;
  const selected = () => stripVTControlCharacters(dock.render(120).find(line => line.includes('\x1b[44m')) ?? '');
  let text = 'editing', input!: (data: string) => {consume?: boolean} | undefined, detached = 0;
  const editor = {render: () => [], invalidate() {}, capturesViewportInput: false, getText: () => text, setText: (value: string) => {text = value;}};
  tui.setFocus(editor);
  let rows = [{id: 'a', text: 'agent a', priority: 25}, {id: 'b', text: 'agent b', priority: 25}];
  dock.register('agents', {title: 'Agents', rows: () => rows, open: id => {opened.push(id);}});
  dock.register('tasks', {title: 'Tasks', rows: () => [{id: 'task', text: 'task', priority: 100}]});
  const ctx = {mode: 'tui', ui: {getEditorText: () => text, notify() {},
    setWidget: (_key: string, factory?: (terminal: typeof tui, palette: Theme) => unknown) => factory?.(tui, theme),
    onTerminalInput: (handler: typeof input) => {input = handler; return () => {detached++;};},
  }} as unknown as ExtensionContext;
  dock.bind(ctx, 12);
  assert.equal(input('\x1b[D'), undefined, 'left remains editor cursor movement');
  text = ''; editor.capturesViewportInput = true;
  assert.equal(input('\x1b[D'), undefined, 'autocomplete retains editor navigation'); editor.capturesViewportInput = false;
  assert.deepEqual(input('\x1b[D'), {consume: true}); input('\x1b[B');
  rows = [rows[1], rows[0]]; assert.match(selected(), /agent b/);
  rows = [rows[1]]; assert.match(selected(), /agent a/);
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

test('Tasks join Dock navigation and section shortcuts with read-only details and unchanged committed data', {timeout: 15000}, async () => {
  const tui = terminal(40, 120);
  let dock!: Dock, ctx!: ExtensionContext, input!: (data: string) => unknown, views = 0;
  const h = await host({tools: ['task_edit', 'task_list'], extend: pi => pi.on('session_start', (_event, context) => {ctx = context;}), ui: ui => ({...ui,
    setWidget: (_key, factory) => {if (typeof factory === 'function') dock = factory(tui, ui.theme) as Dock;},
    onTerminalInput: handler => {input = handler; return () => {};},
    custom: async factory => new Promise((resolve, reject) => {
      Promise.resolve(factory(tui, ui.theme, {} as never, resolve)).then(view => {
        const screen = view.render(120).join('\n');
        assert.match(screen, /Tasks ▸ inspect child red/);
        assert.doesNotMatch(screen, /read ?only/i);
        assert.ok(screen.includes('## literal *text* red'), 'task text is neither terminal control nor Markdown syntax');
        assert.deepEqual((view as {actions?: unknown[]}).actions, [], 'task reader never admits mutations');
        views++; view.handleInput?.('\x1b');
      }).catch(reject);
    }),
  })});
  try {
    const tool = (name: string) => h.session.getToolDefinition(name)!;
    const discovery = await tool('task_list').execute('discover', {}, undefined, undefined, ctx as never);
    const generation = (discovery.details as {generation: string}).generation;
    await tool('task_edit').execute('create', {generation, op: 'batch', changes: [
      {op: 'add', title: 'inspect group', children: ['inspect child \x1b[31mred\x1b[0m', 'second child']},
      {op: 'update', id: '1.1', description: '## literal *text* \x1b[31mred\x1b[0m'},
    ]}, undefined, undefined, ctx as never);
    const snapshot = async () => (await tool('task_list').execute('read', {state: 'all'}, undefined, undefined, ctx as never)).details;
    const before = await snapshot();
    for (const section of ['jobs', 'agents']) dock.register(section, {title: section === 'jobs' ? 'Jobs' : 'Agents',
      rows: () => [{id: section, text: section, priority: 100}], open: () => {assert.fail('only Tasks should open');}});
    input('\x1b[D'); input('\x1b[B');
    const screen = () => dock.render(120).map(stripVTControlCharacters).join('\n');
    assert.match(screen(), /│    .*1\.1 inspect child/);
    input(']'); assert.match(screen(), /├─ agents/);
    input(']'); assert.match(screen(), /├─ jobs/);
    input(']'); assert.match(screen(), /├─ .*1 inspect group/);
    input('['); assert.match(screen(), /├─ jobs/);
    input(']'); input('\x1b[B'); input('\r');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(views, 1); assert.deepEqual(await snapshot(), before);
    assert.ok(dock.render(120).every(line => !line.includes('> ')));
    for (const budget of [1, 2, 3, 6, 12]) {
      dock.bind(ctx, budget);
      if (budget === 1) assert.match(dock.render(120).join('\n'), /Tasks/, 'idle budget prefers visible Tasks over urgent Agents/Jobs');
      input('\x1b[D');
      for (const section of ['Tasks', 'Agents', 'Jobs']) {
        for (const width of [40, 60, 120]) {
          const lines = dock.render(width).map(stripVTControlCharacters);
          assert.ok(lines.length <= dock.budget() && lines.every(line => visibleWidth(line) <= width));
          const positions = ['Tasks', 'Agents', 'Jobs'].map(label => lines.findIndex(line => line.includes(label))).filter(index => index >= 0);
          assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'focus and priority never move source positions');
          assert.ok(lines.some(line => line.includes(section)), 'tiny budgets retain the selected source/object');
          if (section === 'Tasks') assert.doesNotMatch(lines.join('\n'), /read ?only/i, 'view action expresses the read-only task viewer without redundant labels');
        }
        input(']');
      }
      input('\x1b');
      assert.match(dock.render(120).join('\n'), /Tasks/, 'leaving selection restores Tasks despite the retained last source');
    }
    dock.register('tasks', {title: 'Tasks', rows: () => []});
    dock.bind(ctx, 1);
    assert.match(dock.render(120).join('\n'), /Agents/, 'absent Tasks retain the existing urgent section policy');
  } finally {await h.dispose();}
});

test('structured states preserve name colors, task strike and active selection backgrounds at every Dock budget', () => {
  const colors: Record<string, number> = {accent: 36, success: 32, warning: 33, error: 31, dim: 90, muted: 90, borderMuted: 90};
  const theme = {fg: (tone: string, text: string) => `\x1b[${colors[tone] ?? 37}m${text}\x1b[39m`,
    bg: (_tone: string, text: string) => `\x1b[44m${text}\x1b[49m`, getBgAnsi: () => '\x1b[44m', bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`} as unknown as Theme;
  const roles = {starting: 'success', running: 'success', queued: 'warning', waiting: 'warning', 'waiting(parent)': 'warning', stopping: 'warning',
    'cleanup pending': 'warning', 'cleanup unconfirmed': 'warning', failed: 'error', limited: 'error', timed_out: 'error', completed: 'dim', stopped: 'dim'};
  for (const [state, tone] of Object.entries(roles)) assert.equal(stateTone(state), tone);
  const job = {id: 'job_12345678', name: 'running', command: 'echo name', state: 'running', mode: 'pipe', exitCode: null,
    cleanup: {state: 'pending'}} as JobSummary;
  const label = recordStyle(jobLabel(job), job.state, theme);
  assert.ok(label.startsWith('running\x1b[90m · '), 'the name is not a status even when both have identical text');
  assert.ok(label.includes('\x1b[32mrunning\x1b[39m') && label.includes('\x1b[33mcleanup pending\x1b[39m'));
  assert.ok(!label.includes(job.id));
  assert.ok(selectedRow('→ ' + label, 120, theme).includes('\x1b[36m→ \x1b[39m'));
  assert.ok(!selectedRow('→ ' + label, 120, theme, false).includes('\x1b[44m'));
  const ansiTree = theme.fg('borderMuted', '│    ') + theme.fg('success', 'child');
  assert.equal(stripVTControlCharacters(selectedRow(ansiTree, 20, theme, true, '')).trimEnd(), '│    child');
  assert.ok(selectedRow(ansiTree, 20, theme, true, '').includes(ansiTree), 'trusted tree ANSI is neither sliced nor repainted');
  assert.ok(recordStyle('worker · waiting(parent)', 'waiting(parent)', theme).includes('\x1b[33mwaiting(parent)'));

  const browser = new BrowserView(terminal(), {title: 'Native contract', state: browseState(), items: () => [
    {value: 'native', label: 'native task', status: 'doing', details: () => 'literal details'},
  ]}, () => {}, theme);
  try {
    const active = browser.render(60).find(line => stripVTControlCharacters(line).includes('→ native task'))!;
    assert.equal(browser.getSelectedItem()?.value, 'native');
    assert.ok(active.includes('\x1b[36m→ ') && active.includes('\x1b[32mnative task'));
    assert.ok(active.includes('\x1b[44m'), 'native list selection receives the shared background');
    browser.handleInput('\t');
    const inactive = browser.render(60).find(line => stripVTControlCharacters(line).includes('→ native task'))!;
    assert.equal(browser.getSelectedItem()?.value, 'native');
    assert.ok(inactive.includes('\x1b[90m→ ') && inactive.includes('\x1b[32mnative task'));
    assert.ok(!inactive.includes('\x1b[44m'), 'details focus mutes only the native marker, not task state');
  } finally { browser.dispose(); }

  const dock = new Dock(), tui = terminal(40, 120), publisher = new StatusPublisher(dock);
  let input!: (data: string) => unknown;
  const ctx = {mode: 'tui', ui: {getEditorText: () => '', notify() {},
    setWidget: (_key: string, factory?: (screen: typeof tui, theme: Theme) => unknown) => factory?.(tui, theme),
    onTerminalInput: (handler: typeof input) => {input = handler; return () => {};}}} as unknown as ExtensionContext;
  publisher.bind({setStatus() {}} as unknown as ExtensionContext['ui'], {goal: 'hidden', agents: 'dock', jobs: 'dock'});
  const taskText = theme.fg('dim', theme.strikethrough('done task'));
  const taskRows = [{id: 'task', text: taskText, suffix: '7/8', priority: 30},
    {id: 'doing', parentId: 'task', text: theme.fg('success', 'doing child 中文'.repeat(10)), suffix: '2/8', priority: 30},
    {id: 'blocked', parentId: 'task', text: theme.fg('warning', 'blocked child'), priority: 30},
    {id: 'done', parentId: 'task', text: theme.fg('dim', theme.strikethrough('done child')), priority: 30}];
  dock.register('tasks', {title: 'Tasks', readOnly: true, rows: () => taskRows, open() {}});
  const cleanup = {text: 'cleanup pending', state: 'cleanup pending'};
  publisher.setActivities('jobs', [job.id], [{id: job.id, text: job.name, suffix: jobStatus(job), compactSuffixes: [[cleanup]], priority: 100}]);
  publisher.setActivities('agents', ['run'], [{id: 'run', text: 'worker', suffix: [{text: 'waiting(parent)', state: 'waiting(parent)'}], priority: 100}],
    [{text: '1 waiting(parent)', state: 'waiting(parent)'}]);
  dock.setOpen('agents', () => {}); dock.setOpen('jobs', () => {});
  // Keep idle and selected membership/row budgets identical while checking layout.
  for (const row of taskRows) row.priority = 110;
  dock.bind(ctx, 8);
  const idle = new Map([24, 40, 120].map(width => [width, dock.render(width)]));
  input('\x1b[D');
  for (const row of taskRows) {
    for (const width of [24, 40, 120]) {
      const selected = dock.render(width).find(line => line.includes('\x1b[44m'))!;
      const plain = stripVTControlCharacters(selected).trimEnd();
      const unselected = idle.get(width)!.find(line => stripVTControlCharacters(line).trimEnd() === plain);
      assert.ok(unselected, `selection preserves prefix, object and suffix budget: ${row.id}, width ${width}`);
      assert.ok(selected.includes('\x1b[1m') && !stripVTControlCharacters(selected).includes('\x1b'), 'bold selection contains no broken ANSI');
      const name = row.id === 'task' ? 'done task' : `${row.id} child`;
      assert.equal(stripVTControlCharacters(selected).indexOf(name), width >= 40 ? row.parentId ? 5 : 3 : 0);
      if (row.id === 'done') assert.ok(selected.includes('\x1b[9mdone child'), 'selected completed child retains strike');
    }
    input('\x1b[B');
  }
  input('\x1b');
  for (const row of taskRows) row.priority = 30;
  for (const budget of [1, 2, 8]) {
    dock.bind(ctx, budget); input('\x1b[D');
    assert.ok(dock.render(120).join('\n').includes('\x1b[9mdone task'), 'selection preserves Tasks deletion line');
    input(']');
    assert.ok(dock.render(120).join('\n').includes('\x1b[33mwaiting(parent)'));
    if (budget === 8) assert.ok(dock.render(120).join('\n').includes('\x1b[33m1 waiting(parent)'));
    input(']');
    for (const width of [24, 40, 120]) {
      const lines = dock.render(width), selected = lines.find(line => line.includes('\x1b[44m'))!;
      assert.ok(selected && !selected.includes('\x1b[36mrunning'), 'only the marker/chrome use accent');
      assert.ok(selected.includes('\x1b[33m'), `compact warning at budget ${budget}, width ${width}: ${JSON.stringify(selected)}`);
      assert.ok(lines.length <= budget && lines.every(line => visibleWidth(line) <= width));
    }
    input('\x1b');
    assert.ok(dock.render(120).every(line => !line.includes('\x1b[44m') && !line.includes('> ')), 'deactivated identities cannot paint selection');
  }
  dock.detach(); publisher.detach();
});

test('Dock windows keep selected rows and place exact overflow gaps before, between and after siblings', () => {
  const flat = Array.from({length: 12}, (_, index) => ({id: `row:${index}`, text: `row ${index}`, priority: index === 6 ? 100 : 1}));
  for (const capacity of [1, 2, 3, 4, 6, 12]) for (const focus of flat) {
    const window = dockWindow(flat, capacity, focus.id);
    assert.ok(window.rows.length <= capacity);
    assert.ok(window.rows.some(row => row.id === focus.id));
    assert.equal(new Set(window.rows.map(row => row.id)).size, window.rows.length);
    const actual = window.rows.filter(row => !row.id.startsWith('overflow:'));
    assert.deepEqual(actual, [...actual].sort((a, b) => flat.indexOf(a) - flat.indexOf(b)));
  }
  const tail = dockWindow(flat, 6, flat.at(-1)!.id).rows;
  assert.match(tail[0].text, /^↑ … \d+ more items$/);
  assert.equal(tail.at(-1)!.id, flat.at(-1)!.id, 'no trailing overflow after the last object');
  const middle = dockWindow(flat, 5, flat[6].id).rows;
  assert.match(middle[0].text, /^↑/); assert.match(middle.at(-1)!.text, /^↓/);
  const gaps = dockWindow(flat, 6).rows;
  assert.ok(gaps.some(row => row.text.startsWith('↕')), 'disjoint priority membership labels its real interior gap');
  const tree = Array.from({length: 4}, (_, group) => [
    {id: `group:${group}`, text: `group ${group}`, priority: 1},
    ...Array.from({length: 4}, (_, child) => ({id: `child:${group}:${child}`, parentId: `group:${group}`, text: `child ${child}`, priority: 2})),
  ]).flat();
  for (const capacity of [1, 2, 4, 8, 12]) for (const focus of tree) {
    const window = dockWindow(tree, capacity, focus.id, 'groups');
    assert.ok(window.rows.length <= capacity && window.rows.some(row => row.id === focus.id));
    if (!window.compactHint) for (const row of window.rows) if (row.parentId) assert.ok(window.rows.some(parent => parent.id === row.parentId));
  }
  const lastChild = dockWindow(tree, 6, tree.at(-1)!.id, 'groups').rows;
  assert.equal(lastChild.at(-1)!.id, tree.at(-1)!.id);
  assert.ok(lastChild.some(row => /more groups/.test(row.text)));
  assert.ok(lastChild.every(row => !/\p{Script=Han}/u.test(row.text)));
});
