import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession,
  type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext, type Theme} from '@earendil-works/pi-coding-agent';
import {fauxProvider, fauxAssistantMessage, fauxToolCall} from '@earendil-works/pi-ai';
import {stripVTControlCharacters} from 'node:util';
import {CURSOR_MARKER, Text, TuiAltScreen, getKeybindings, visibleWidth} from '@earendil-works/pi-tui';
import {configPaths, writeConfigFields} from '../../src/runtime/config-fields.ts';
import {loadConfig, readConfig} from '../../src/runtime/config.ts';
import {prepareClipboard} from '../../src/runtime/clipboard.ts';
import {BrowserView, browseState} from '../../src/ui/browser.ts';
import {ScrollView} from '../../src/ui/scroll.ts';
import {DetailsView} from '../../src/ui/details.ts';
import {openReading, readingRows} from '../../src/ui/reading.ts';
import {terminal} from '../support/terminal.ts';
import {agentDir} from '../support/jobs.ts';

test('browser searches full data, preserves identity and readers across resize/reopen and disposes events', () => {
  const tui = terminal(30, 120), state = browseState();
  let items = Array.from({length: 35}, (_, i) => ({value: `run:${i}`, label: 'Same name', search: `command-${i}`,
    details: () => `Run ${i}\n` + 'Long details\n'.repeat(40)}));
  let selected: string | undefined, released = 0;
  const options = {title: 'Records', state, items: () => items,
    subscribe: () => () => {released++;}};
  const view = new BrowserView(tui, options, value => {selected = value;});
  view.handleInput('command-34'); assert.equal(state.query, '', 'plain text is not an implicit filter');
  view.handleInput('/'); view.handleInput('command-34'); view.handleInput('\r');
  assert.equal(view.getSelectedItem()?.value, 'run:34');
  for (const width of [40, 60, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
  view.handleInput('\t'); view.handleInput('\x1b[6~');
  const reader = state.readers.get('run:34')!; assert.ok(reader.offset > 0);
  view.handleInput('\x1b'); view.handleInput('\r'); assert.equal(selected, 'run:34'); view.dispose();
  const next = new BrowserView(tui, options, () => {}); next.render(120);
  assert.strictEqual(state.readers.get('run:34'), reader); assert.equal(next.getSelectedItem()?.value, 'run:34');
  next.handleInput('\x1b'); assert.equal(state.query, '');
  for (let i = 0; i < 5; i++) next.handleInput('\x1b[B');
  const before = next.getSelectedItem()!.value; items = items.filter(item => item.value !== before); next.render(120);
  assert.equal(next.getSelectedItem()?.value, `run:${Number(before.slice(4)) + 1}`);
  next.handleInput('/'); next.handleInput('missing'); assert.match(next.render(120).join('\n'), /No matches · press Esc to clear filter/);
  next.handleInput('\t'); next.handleInput('\t'); assert.equal(state.focus, 'list', 'empty results cannot focus an unavailable detail');
  next.dispose(); assert.equal(released, 2);
});

test('shared frames keep inline input local and native follow-end persists through streaming, pause and resume', async () => {
  let lines = Array.from({length: 40}, (_, i) => `line ${i}`);
  const reader = new ScrollView({render: () => [...lines], invalidate() {}}, true);
  const tui = terminal(24, 120), state = browseState();
  let closes = 0, message = '';
  const result = Promise.withResolvers<string>();
  const action = {key: 'm' as const, label: 'Message', input: () => ({prompt: 'Message probe: ', submit: async (text: string) => {message = text; return result.promise;}})};
  const detail = new DetailsView(tui, () => 'Probe', new Text(''), () => {closes++;}, [action], reader);
  const browser = new BrowserView(tui, {title: 'Runs', state, items: () => [{value: 'probe', label: 'probe', details: () => lines.join('\n')}], actions: () => [action]}, () => {closes++;});
  try {
    detail.render(120); const end = reader.offset;
    lines.push('streamed tail'); assert.ok(detail.render(120).some(line => line.includes('streamed tail'))); assert.ok(reader.offset > end);
    reader.scroll(-3); const paused = reader.offset;
    lines.push('unread tail'); reader.markNewOutput();
    assert.match(detail.render(120).map(stripVTControlCharacters).join('\n'), /↓ new output · End to follow/); assert.equal(reader.offset, paused);
    reader.scroll(999); assert.equal(reader.following, true);
    lines.push('latest tail'); assert.ok(detail.render(120).some(line => line.includes('latest tail'))); assert.equal(reader.hasNewOutput, false);
    reader.handleInput('/'); reader.handleInput('line 10'); reader.handleInput('\r'); assert.equal(reader.following, false);
    reader.handleInput('\x1b[F'); assert.equal(reader.following, true);
    for (const view of [detail, browser]) {
      view.render(120); view.handleInput('m');
      assert.ok(view.render(120).some(line => line.includes('Message probe:')));
      view.handleInput('x'); view.handleInput('/'); view.handleInput('\x1b[A'); view.handleInput('\r');
      assert.equal(closes, 0); assert.equal(message, 'x/');
      result.resolve('probe: steered'); await new Promise(resolve => setImmediate(resolve));
      assert.match(view.render(120).map(stripVTControlCharacters).join('\n'), /probe: steered/);
      view.handleInput('m'); view.handleInput('discard'); view.handleInput('\x1b'); assert.equal(closes, 0);
      view.handleInput('m'); view.handleInput('\r'); assert.equal(closes, 0);
      assert.ok(!view.render(120).some(line => line.includes('Message probe:')));
    }
    assert.equal(browser.getSelectedItem()?.value, 'probe'); assert.equal(state.focus, 'list');
  } finally {detail.dispose(); browser.dispose();}
});

test('reading overlays share the actual height ceiling and fullscreen viewport keys defer to readers and lists', async () => {
  for (const fullscreen of [false, true]) {
    const tui = fullscreen ? new TuiAltScreen(terminal(24, 120).terminal) : terminal(24, 120);
    const custom: ExtensionUIContext['custom'] = async (factory, options) => new Promise((resolve, reject) => {
      Promise.resolve(factory(tui, {} as never, getKeybindings() as never, resolve)).then(view => {
        const overlay = typeof options?.overlayOptions === 'function' ? options.overlayOptions() : options?.overlayOptions;
        assert.equal(options?.overlay, true);
        assert.deepEqual(overlay, fullscreen ? {anchor: 'top-left', width: '100%', maxHeight: '100%', margin: 0}
          : {anchor: 'center', width: '90%', maxHeight: '70%', margin: 0});
        assert.ok(view instanceof DetailsView); assert.equal(view.capturesViewportInput, true);
        assert.equal(view.render(120).length, readingRows(tui), 'footer is inside the same ceiling as the overlay');
        tui.setFocus(view);
        if (fullscreen) {
          // Exercise Pi's real dispatch boundary, not a replacement viewport/router.
          const input = tui as unknown as {handleViewportInput(data: string): unknown};
          assert.equal(input.handleViewportInput('\x1b[6~'), undefined);
          const list = new BrowserView(tui, {title: 'Records', state: browseState(), items: () => []}, () => {});
          tui.setFocus(list); assert.equal(input.handleViewportInput('\x1b[6~'), undefined); list.dispose(); tui.setFocus(view);
        }
        view.handleInput('\x1b[6~'); assert.ok(view.reader.offset > 0);
        view.handleInput('\x1b');
      }).catch(reject);
    });
    await openReading<void>({ui: {custom}} as ExtensionContext, (tui, _theme, _keys, done) =>
      new DetailsView(tui, () => 'Reader', new Text('line\n'.repeat(80), 0, 0), done));
  }
});

test('browser focus chrome distinguishes panes and text modes without repainting records or spending rows', () => {
  const theme = {fg: (tone: string, text: string) => `\x1b[${({accent: 36, muted: 90, borderMuted: 90, error: 31, syntaxKeyword: 35} as Record<string, number>)[tone] ?? 37}m${text}\x1b[39m`,
    bg: (_tone: string, text: string) => `\x1b[44m${text}\x1b[49m`, getBgAnsi: () => '\x1b[44m', bold: (text: string) => `\x1b[1m${text}\x1b[22m`} as unknown as Theme;
  for (const width of [40, 79, 80, 120]) {
    const tui = terminal(30, width), state = browseState(); state.query = 'record';
    const view = new BrowserView(tui, {title: 'Records', state, items: () => [{value: 'record', label: 'record · failed', status: 'failed',
      details: () => new Text(`${theme.fg('syntaxKeyword', 'const')} record\n`.repeat(40), 0, 0)}],
      actions: () => [{key: 'm', label: 'Message', input: () => ({prompt: 'Message: ', submit: async () => 'Sent'})}]}, () => {}, theme);
    const screen = () => {
      const lines = view.render(width);
      assert.equal(lines.length, readingRows(tui));
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      const raw = lines.join('\n');
      assert.ok(raw.includes(theme.fg('error', 'failed')), 'record status remains colored in either focus');
      assert.ok(raw.includes(theme.fg('syntaxKeyword', 'const')), 'reader syntax remains colored in either focus');
      return {raw, plain: stripVTControlCharacters(raw)};
    };
    try {
      const initial = screen(); assert.match(initial.plain, /▸ List/); assert.ok(initial.raw.includes('\x1b[44m'));
      assert.ok(initial.raw.includes(theme.fg('accent', theme.bold('▸ List'))));
      assert.ok(!initial.raw.includes(CURSOR_MARKER), 'a kept filter is not a text cursor');
      const reader = state.readers.get('record')!;
      view.handleInput('\t'); const details = screen();
      assert.match(details.plain, /(?:^| │ )▸ Details/m); assert.doesNotMatch(details.plain, /^▸ List/m);
      assert.ok(!details.raw.includes('\x1b[44m'), 'inactive selection retains identity without active background');
      reader.scroll(3); const offset = reader.offset;
      view.handleInput('\t'); screen(); assert.equal(reader.offset, offset); assert.equal(state.query, 'record');
      assert.strictEqual(state.readers.get('record'), reader); assert.equal(state.selected, 'record');
      view.handleInput('/'); const filter = screen(); assert.match(filter.plain, /▸ Filter:/);
      assert.equal(filter.raw.split(CURSOR_MARKER).length - 1, 1); assert.doesNotMatch(filter.plain, /(?:^| │ )▸ (?:List|Details)/m);
      view.focused = false; assert.ok(!screen().raw.includes(CURSOR_MARKER)); view.focused = true;
      view.handleInput('\t'); view.handleInput('\t'); view.handleInput('/');
      const search = screen(); assert.match(search.plain, /▸ Search/); assert.doesNotMatch(search.plain, /▸ Details/);
      assert.equal(search.raw.split(CURSOR_MARKER).length - 1, 1);
      view.handleInput('\x1b'); view.handleInput('\t'); view.handleInput('m');
      const composer = screen(); assert.match(composer.plain, /▸ Input Message:/);
      assert.doesNotMatch(composer.plain, /(?:^| │ )▸ (?:List|Details)/m); assert.ok(!composer.raw.includes('\x1b[44m'));
      assert.equal(composer.raw.split(CURSOR_MARKER).length - 1, 1);
      view.handleInput('\x1b'); assert.match(screen().plain, /▸ List/);
    } finally {view.dispose();}
  }
});

test('configuration edits share locks, preserve other fields and enforce layer/schema contracts', async () => {
  const root = agentDir(), project = join(root, 'project'); mkdirSync(project);
  const paths = configPaths(project, root);
  writeFileSync(paths.user, JSON.stringify({ask: {timeout: 55}, agents: {types: {worker: {thinking: 'low'}}}}));
  try {
    assert.equal(loadConfig(project, root).runtime.openAIResponsesAutoRecovery, false);
    await Promise.all([
      writeConfigFields(project, [{path: ['commands', 'exit'], value: false}], root),
      writeConfigFields(project, [{path: ['agents', 'types', 'worker', 'model'], value: 'provider/model'}], root),
      writeConfigFields(project, [{path: ['runtime', 'openAIResponsesAutoRecovery'], value: true}], root),
    ]);
    assert.equal(loadConfig(project, root).commands.exit, false);
    assert.deepEqual(readConfig(paths.user).runtime, {openAIResponsesAutoRecovery: true});
    await writeConfigFields(project, [{path: ['runtime', 'openAIResponsesAutoRecovery'], value: false, layer: 'project'}], root);
    assert.equal(loadConfig(project, root).runtime.openAIResponsesAutoRecovery, false);
    assert.equal(readConfig(paths.user).runtime?.openAIResponsesAutoRecovery, true);
    await writeConfigFields(project, [{path: ['runtime', 'openAIResponsesAutoRecovery'], value: undefined, layer: 'project'}], root);
    assert.equal(loadConfig(project, root).runtime.openAIResponsesAutoRecovery, true);
    assert.equal(readConfig(paths.project).runtime, undefined);
    const beforeInvalid = readConfig(paths.user);
    await assert.rejects(writeConfigFields(project, [
      {path: ['commands', 'exit'], value: true},
      {path: ['runtime', 'openAIResponsesAutoRecovery'], value: 'true'},
    ], root), /Invalid/);
    await assert.rejects(writeConfigFields(project, [{path: ['runtime', 'unknown'], value: true}], root), /Invalid/);
    assert.deepEqual(readConfig(paths.user), beforeInvalid, 'invalid recovery edits cannot commit other fields');
    await writeConfigFields(project, [{path: ['runtime', 'openAIResponsesAutoRecovery'], value: undefined, layer: 'user'}], root);
    assert.equal(loadConfig(project, root).runtime.openAIResponsesAutoRecovery, false);
    assert.deepEqual(readConfig(paths.user).agents?.types?.worker, {model: 'provider/model', thinking: 'low'});
    assert.equal(readConfig(paths.user).ask?.timeout, 55);
    assert.equal(loadConfig(project, root).ui.highlightBuiltinCommands, true);
    await writeConfigFields(project, [{ path: ['ui', 'highlightBuiltinCommands'], value: false }], root);
    await writeConfigFields(project, [{ path: ['ui', 'maxRows'], value: 7, layer: 'project' }], root);
    assert.deepEqual(loadConfig(project, root).ui, { maxRows: 7, highlightBuiltinCommands: false });
    await writeConfigFields(project, [{ path: ['ui', 'highlightBuiltinCommands'], value: true, layer: 'project' }], root);
    assert.equal(loadConfig(project, root).ui.highlightBuiltinCommands, true);
    await writeConfigFields(project, [{ path: ['ui', 'highlightBuiltinCommands'], value: undefined, layer: 'project' }], root);
    assert.equal(loadConfig(project, root).ui.highlightBuiltinCommands, false);
    await assert.rejects(writeConfigFields(project, [{ path: ['ui', 'highlightBuiltinCommands'], value: 'true' }], root), /Invalid/);
    await writeConfigFields(project, [{path: ['commands', 'exit'], value: true, layer: 'project'}], root);
    assert.equal(loadConfig(project, root).commands.exit, true);
    await writeConfigFields(project, [{path: ['commands', 'exit'], value: undefined, layer: 'project'}], root);
    assert.equal(loadConfig(project, root).commands.exit, false);
    await assert.rejects(writeConfigFields(project, [{path: ['ask', 'timeout'], value: -1}], root), /Invalid/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('actual extension loader readies first commands/tools and suite edits apply exit registration on reload', async () => {
  const root = agentDir(); process.env.PI_CODING_AGENT_DIR = root;
  const faux = fauxProvider({provider: 'settings-test', models: [{id: 'offline'}]});
  const settingsManager = SettingsManager.inMemory({retry: {enabled: false}, compaction: {enabled: false}});
  let ctx!: ExtensionContext; const errors: unknown[] = [];
  const loader = new DefaultResourceLoader({cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    additionalExtensionPaths: [resolve('src/index.ts')], extensionFactories: [pi => {
      pi.registerProvider(faux.provider); pi.on('session_start', (_event, context) => {ctx = context;});
    }]});
  await loader.reload();
  const {session, extensionsResult} = await createAgentSession({cwd: root, agentDir: root, resourceLoader: loader,
    settingsManager, sessionManager: SessionManager.inMemory(root), model: faux.getModel()});
  try {
    assert.deepEqual(extensionsResult.errors, []);
    const ui = {setStatus() {}, setWidget() {}, notify() {}, addAutocompleteProvider() {}, onTerminalInput() { return () => {}; }, getEditorText: () => '',
      custom: async (factory: Parameters<ExtensionUIContext['custom']>[0]) => new Promise((done, reject) => Promise.resolve(factory(terminal(), ctx.ui.theme, getKeybindings() as never, done)).then(view => {
        view.render(120); view.handleInput?.('\x1b'); view.dispose?.();
      }).catch(reject))} as unknown as ExtensionUIContext;
    await session.bindExtensions({mode: 'tui', uiContext: ui, onError: error => {errors.push(error);}});
    assert.deepEqual(errors, []);
    assert.ok(session.extensionRunner.getCommand('subagents')); assert.equal(session.extensionRunner.getCommand('agents'), undefined);
    for (const tool of ['agent_start', 'agent_workflow', 'job_start', 'ask_user']) assert.ok(session.getToolDefinition(tool));
    assert.ok(session.extensionRunner.getCommand('exit'));
    faux.setResponses([fauxAssistantMessage(fauxToolCall('agent_start', {prompt: 'FIRST_REAL_CHILD', background: false})),
      fauxAssistantMessage('First child completed'), fauxAssistantMessage('Parent completed')]);
    await session.prompt('Verify first child through the actual loader');
    const childResult = session.sessionManager.getBranch().findLast(entry => entry.type === 'message'
      && entry.message.role === 'toolResult' && entry.message.toolName === 'agent_start');
    assert.ok(childResult?.type === 'message' && childResult.message.role === 'toolResult');
    assert.equal(childResult.message.isError, false);
    assert.match(JSON.stringify(childResult.message.details), /completed/);
    let calls = 0;
    const custom: ExtensionUIContext['custom'] = async factory => new Promise((done, reject) => Promise.resolve(factory(terminal(), ctx.ui.theme, getKeybindings() as never, done)).then(view => {
      const screen = view.render(120).join('\n');
      if (calls++ === 0) {assert.match(screen, /commands/); view.handleInput?.('exit'); view.handleInput?.('\r');}
      else if (calls === 2) view.handleInput?.('\r'); // user layer
      else if (calls === 3) {view.handleInput?.('\x1b[B'); view.handleInput?.('\r');} // false
      else {assert.match(screen, /false/); view.handleInput?.('\x1b');}
    }).catch(reject));
    await session.extensionRunner.getCommand('suite')!.handler('', {...ctx, ui: {...ctx.ui, custom}} as ExtensionCommandContext);
    assert.equal(loadConfig(root).commands.exit, false);
    assert.ok(session.extensionRunner.getCommand('exit'), 'saved value does not change active registration');
    await session.reload(); assert.deepEqual(errors, []); assert.equal(session.extensionRunner.getCommand('exit'), undefined);
    await writeConfigFields(root, [{path: ['commands', 'exit'], value: true}]); await session.reload();
    const entered = Promise.withResolvers<void>();
    faux.setResponses([async (_context, options) => {entered.resolve(); await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => resolve(), {once: true})); return fauxAssistantMessage('aborted');}]);
    const prompt = session.prompt('Keep generating'); await entered.promise;
    let requested = false;
    await session.extensionRunner.getCommand('exit')!.handler('', {...ctx, shutdown: () => {requested = true;}, waitForIdle: () => session.waitForIdle()} as ExtensionCommandContext);
    await prompt; assert.equal(requested, true); assert.equal(session.isIdle, true);
  } finally {await session.abort(); await session.extensionRunner.emit({type: 'session_shutdown', reason: 'quit'}); session.dispose(); rmSync(root, {recursive: true, force: true});}
});

test('tmux preparation uses native clipboard routing, skips non-tui and reports blocked channels', async () => {
  const original = process.env.TMUX; process.env.TMUX = 'test';
  const calls: string[][] = [], warnings: string[] = [];
  const ctx = {mode: 'tui', ui: {notify: (message: string) => warnings.push(message)}} as unknown as ExtensionContext;
  const pi = {exec: async (_cmd: string, args: string[]) => {calls.push(args); return {code: 0, stdout: calls.length === 1 ? 'external|clipboard,focus' : '', stderr: '', killed: false, truncated: false};}};
  try {
    await prepareClipboard(pi, ctx); assert.deepEqual(calls[1], ['set-option', '-s', 'set-clipboard', 'on']);
    await prepareClipboard(pi, {...ctx, mode: 'rpc'}); assert.equal(calls.length, 2);
    await prepareClipboard({exec: async () => ({code: 0, stdout: 'external|focus', stderr: '', killed: false, truncated: false})}, ctx);
    assert.match(warnings[0], /no clipboard capability/);
    await assert.rejects(prepareClipboard({exec: async () => ({code: 1, stdout: '', stderr: 'no server', killed: false, truncated: false})}, ctx), /no server/);
  } finally {if (original === undefined) delete process.env.TMUX; else process.env.TMUX = original;}
});
