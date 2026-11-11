import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import type { Theme, ExtensionAPI, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth, Text, VStack } from '@earendil-works/pi-tui';
import { JobView } from '../../src/jobs/viewer/component.ts';
import { JobLogView } from '../../src/jobs/log-viewer.ts';
import { ViewerNavigation } from '../../src/ui/viewer/navigation.ts';
import { readingRows } from '../../src/ui/reading.ts';
import { agentDir, manager, owner, testShell } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { readerTerminal } from '../support/reader.ts';
import { host } from '../support/host.ts';
import { showJobs } from '../../src/jobs/viewer.ts';
import { JobsModule } from '../../src/jobs/index.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { BrowserView } from '../../src/ui/browser.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { Dock } from '../../src/ui/dock.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { defaults } from '../../src/runtime/config.ts';
test('/jobs opens command/output directly, Esc preserves list identity/filter, and details double-left closes the entire chain', {timeout: 15000}, async () => {
  const root = agentDir(), binding = new SessionBinding(), dock = new Dock();
  let api!: ExtensionAPI, ctx!: ExtensionContext, module!: JobsModule, notices!: Notifications;
  const h = await host({root, persisted: true, extend: pi => {
    api = pi; notices = new Notifications(pi, binding); module = new JobsModule(pi, binding, notices, new StatusPublisher(dock));
    pi.on('session_start', (_event, context) => {ctx = context; binding.bind(context);});
  }});
  const handle = acquireRuntime(root); if (handle.mode !== 'active') assert.fail('expected execution runtime');
  const jobs = handle.manager;
  try {
    module.bind();
    const job = await jobs.start({...owner, ownerSessionId: ctx.sessionManager.getSessionId(), cwd: root, name: 'chain fixture', command: 'echo chain-output; read line'}, testShell());
    await until(() => readFileSync(jobs.logPath(job, 'stdout'), 'utf8').includes('chain-output'));
    const steps = [
      (view: BrowserView | JobView) => { assert.ok(view instanceof BrowserView); view.handleInput('/'); view.handleInput('chain fixture'); view.handleInput('\r'); view.handleInput('\r'); },
      (view: BrowserView | JobView) => { assert.ok(view instanceof JobView); assert.match(view.render(120).join('\n'), /chain-output/); view.handleInput('\x1b'); },
      (view: BrowserView | JobView) => { assert.ok(view instanceof BrowserView); assert.equal(view.getSelectedItem()?.value, job.id); assert.match(view.render(120).join('\n'), /chain fixture/); view.handleInput('\r'); },
      (view: BrowserView | JobView) => { assert.ok(view instanceof JobView); view.handleInput('d'); view.render(120); view.handleInput('\x1b[D'); view.handleInput('\x1b[D'); },
    ];
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((resolve, reject) => {
      Promise.resolve(factory(terminal(40, 120), ctx.ui.theme, {} as never, resolve)).then(view => {
        view.render(120); const step = steps.shift(); assert.ok(step, 'closed chain must not reopen the list');
        assert.ok(view instanceof BrowserView || view instanceof JobView); step(view);
      }).catch(reject);
    });
    await showJobs(api, '', {...ctx, ui: {...ctx.ui, custom, select: async () => assert.fail('no candidate menu')}} as never,
      {jobs: module, dock, notifications: notices, keys: () => keys});
    assert.equal(steps.length, 0); assert.equal(h.faux.state.callCount, 0); assert.equal(jobs.peek(job.id).state, 'running');
  } finally { module.detach(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});


test('actual /jobs outer overlay budgets command and log independently; keyboard pause and final End use the same byte window', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), native = readerTerminal(30, 80);
  const base = new Text('base', 0, 0); native.tui.setLayoutRoot(new VStack([base])); native.tui.setFocus(base);
  let view: JobView | undefined, overlay: ReturnType<typeof native.tui.showOverlay> | undefined;
  try {
    const job = await jobs.start({...owner, cwd: root, command: '# command\n'.repeat(30) + 'for i in {1..80}; do echo "line-$i"; done; read line; echo final-native'}, testShell());
    await until(() => readFileSync(jobs.logPath(job, 'stdout'), 'utf8').includes('line-80'));
    view = new JobView(native.tui, theme, {} as never, {job, live: true, readonly: false, control: jobs, keys, navigation: new ViewerNavigation()},
      () => {overlay?.hide(); view?.dispose();});
    await view.initialize(); overlay = native.tui.showOverlay(view, {row: 0, col: 0, width: '100%', maxHeight: '100%'}); native.tui.renderNow();
    const log = view.output; assert.ok(log instanceof JobLogView);
    assert.match((await native.lines()).join('\n'), /line-80/);
    assert.ok(view.command.viewportHeight > 0); assert.ok(log.reader.viewportHeight > 0);
    assert.ok(view.command.viewportHeight + log.reader.viewportHeight < 30, 'chrome never consumes log screen rows');
    native.send('\x1b[H'); assert.equal(log.reader.following, false); const paused = log.reader.offset;
    assert.equal(log.reader.scrollbar, 'hidden');
    native.send('\t'); native.send('\x1b[F');
    assert.equal(view.command.following, true); assert.equal(log.reader.offset, paused, 'command focus cannot scroll the log');
    native.send('\t');
    jobs.write(job.id, 'finish\n', {source: 'model', kind: 'text'}); await jobs.wait(job.id);
    await log.refresh(); assert.equal(log.reader.offset, paused);
    native.send('\x1b[F'); await until(() => view!.render(80).join('\n').includes('final-native'));
    native.tui.renderNow(); assert.match((await native.lines()).join('\n'), /final-native/);
    native.send('\x1b'); assert.equal(native.tui.hasOverlay(), false);
    assert.equal((native.tui as unknown as {getFocusedComponent(): unknown}).getFocusedComponent(), base);
  } finally {overlay?.hide(); view?.dispose(); native.dispose(); await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true});}
});
const theme = {fg: (_color: string, text: string) => text, bold: (text: string) => text} as unknown as Theme;
const keys = defaults.jobs;
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'expected viewer state'); await sleep(20); }
}

test('one pipe viewer bounds multiline command and preserves per-stream search, viewport/follow and final reads across details', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), tui = terminal(40, 120);
  let view: JobView | undefined;
  try {
    const command = '# actual command\n' + '# command line\n'.repeat(80) + '# TAIL_MARKER\n' +
      'for i in {1..70}; do echo "stdout-$i"; echo "stderr-$i" >&2; done; read line; echo final-stdout; echo final-stderr >&2';
    const job = await jobs.start({...owner, name: 'A name is not the command', cwd: root, command}, testShell());
    await until(() => readFileSync(jobs.logPath(job, 'stderr'), 'utf8').includes('stderr-70'));
    view = new JobView(tui, theme, {} as never, {job, live: true, readonly: false, control: jobs, manager: jobs, keys, navigation: new ViewerNavigation()}, () => {});
    await view.initialize(); const stdout = view.output; assert.ok(stdout instanceof JobLogView);
    view.render(120); stdout.handleInput('\x1b[H'); stdout.render(120); const offset = stdout.reader.offset;
    stdout.handleInput('/'); stdout.handleInput('stdout-2'); stdout.handleInput('\r');
    view.handleInput('d'); view.render(120); view.handleInput('/'); view.handleInput('TAIL_MARKER'); view.handleInput('\r');
    assert.match(view.render(120).join('\n'), /TAIL_MARKER/, 'details retain the entire actual multiline command');
    view.handleInput('\x1b'); assert.strictEqual(view.output, stdout); assert.equal(stdout.reader.query, 'stdout-2');
    view.handleInput('s'); await until(() => view!.currentStream === 'stderr');
    const stderr = view.output; assert.ok(stderr instanceof JobLogView); assert.equal(stderr.reader.following, true);
    view.handleInput('s'); await until(() => view!.currentStream === 'input');
    view.handleInput('s'); await until(() => view!.currentStream === 'stdout');
    assert.strictEqual(view.output, stdout); assert.equal(stdout.reader.following, false); assert.equal(stdout.reader.query, 'stdout-2');
    stdout.reader.offset = offset;
    view.handleInput('c'); view.handleInput('\t'); view.handleInput('\x1b[F');
    assert.match(stripVTControlCharacters(view.render(120).join('\n')), /read line/, 'expanded command is bounded but scrollable');
    view.handleInput('\x1b');
    jobs.write(job.id, 'finish\n', {source: 'model', kind: 'text', text: 'finish'}); await jobs.wait(job.id);
    assert.equal(stdout.reader.offset, offset); assert.ok(!stdout.reader.following);
    view.handleInput('\x1b[F'); await until(() => view!.render(120).join('\n').includes('final-stdout'));
    view.handleInput('s'); await until(() => view!.currentStream === 'stderr');
    await until(() => view!.render(120).join('\n').includes('final-stderr'));
    for (const width of [40, 60, 120]) {
      const rendered = view.render(width); assert.ok(rendered.length <= readingRows(tui));
      assert.ok(rendered.every(line => visibleWidth(line) <= width));
      assert.ok(!rendered.join('\n').includes(job.id), 'IDs belong in details/search, not the human name');
    }
  } finally { view?.dispose(); await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});

test('same-screen PTY defaults to readonly browsing, resizes only the true screen and releases its own subscriptions/control', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), navigation = new ViewerNavigation();
  let view: JobView | undefined, detached = false;
  try {
    const job = await jobs.start({...owner, cwd: root, name: 'Console', mode: 'pty', command: 'printf "\\033[31m彩色\\033[0m"; while read line; do echo "$line"; done'}, testShell());
    const source = jobs.terminal(job.id)!;
    await until(() => source.getViewportLines().join('\n').includes('彩色'));
    let resizes = 0; const resize = source.resize.bind(source); source.resize = (cols, rows) => {resizes++; resize(cols, rows);};
    view = new JobView(terminal(40, 100), theme, {} as never, {job, live: true, readonly: false, control: jobs, manager: jobs, source, keys, navigation}, () => {detached = true;});
    await view.initialize();
    view.render(100); const rows = source.rows;
    assert.ok(rows < readingRows(terminal(40, 100)) - 4); assert.equal(source.cols, 100);
    view.render(100); assert.equal(resizes, 1, 'unchanged dimensions cannot trigger PTY redraw');
    view.handleInput('\x1b[A'); view.handleInput('x');
    const confirmation = stripVTControlCharacters(view.render(40).join('\n'));
    assert.match(confirmation, /Press x again/); assert.match(confirmation, /ctrl\+\] leave/);
    view.handleInput('c'); // c also cancels the armed stop.
    assert.equal(jobs.userControlled(job.id), false); assert.equal(jobs.peek(job.id).state, 'running');
    view.render(100); assert.ok(source.rows < rows, 'expanded command rows are never sent as part of the program screen');
    view.handleInput('i'); assert.equal(jobs.userControlled(job.id), true);
    view.handleInput('typed\r'); await until(() => source.getViewportLines().join('\n').includes('typed'));
    view.handleInput('\x02'); assert.equal(detached, false, 'tmux prefix is not the view exit key');
    view.handleInput('\x1d'); assert.equal(detached, true, 'native Ctrl+] leaves the view');
    assert.equal(jobs.userControlled(job.id), false); assert.equal(jobs.peek(job.id).state, 'running');
    assert.ok(source.getViewportLines().join('\n').includes('typed'), 'disposing a view cannot dispose its live terminal');
  } finally { view?.dispose(); await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});

test('dangerous shortcuts use shared two-step confirmation, report unconfirmed cleanup, and readonly logs hide control', {timeout: 10000}, async () => {
  const root = agentDir(), jobs = manager(root);
  const views: JobView[] = [];
  try {
    const job = await jobs.start({...owner, cwd: root, command: 'echo waiting; read line'}, testShell());
    let stops = 0;
    const control = Object.assign(Object.create(jobs), {stop: async () => {
      stops++; return {requested: true, job: {...jobs.peek(job.id), state: 'stopping', cleanup: {...job.cleanup, state: 'unconfirmed', error: 'real cleanup evidence'}}};
    }});
    const create = (readonly: boolean) => {
      const view = new JobView(terminal(40, 120), theme, {} as never, {job, live: true, readonly, control, keys, navigation: new ViewerNavigation()}, () => {});
      views.push(view); return view;
    };
    const view = create(false); await view.initialize();
    view.handleInput('x'); assert.equal(stops, 0); assert.match(stripVTControlCharacters(view.render(120).join('\n')), /again/);
    view.handleInput('x'); await until(() => stops === 1);
    await until(() => view.render(120).join('\n').includes('cleanup unconfirmed'));
    assert.ok(view.render(120).join('\n').includes('real cleanup evidence'));
    const readonly = create(true); await readonly.initialize(); readonly.handleInput('x'); readonly.handleInput('x');
    assert.equal(stops, 1); assert.ok(!readonly.render(120).join('\n').includes('stop process'));
    assert.ok(!readonly.render(120).join('\n').includes('delete history'));
    readonly.handleInput('d'); assert.match(readonly.render(120).join('\n'), new RegExp(job.id));
  } finally { for (const view of views) view.dispose(); await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});
