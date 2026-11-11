import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import xterm from '@xterm/headless';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {foregroundAnsi, parseColor} from '@earendil-works/pi-tui';
import {createPtyProcess} from '../../src/jobs/backends/pty.ts';
import {agentDir, bashPath} from '../support/jobs.ts';
import {GOAL_ENTRY, type Goal} from '../../src/goal/state.ts';

const storedGoal = (file: string): Goal | undefined => readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map(line => JSON.parse(line)).findLast(entry => entry.type === 'custom' && entry.customType === GOAL_ENTRY)?.data.goal ?? undefined;

const packageDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const bin = resolve(packageDir, JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).bin.pi);
const fixtureArgs = ['-ns', '-np', '-nc', '--no-mcp', '-e', resolve('tests/support/fixtures/cli-host.ts'),
  '--provider', 'cli-proof', '--model', 'offline'];
const args = ['-ne', '-e', resolve('src/index.ts'), ...fixtureArgs];
type Snapshot = {pid: number; sessionId: string; sessionFile: string; calls: number; api: string; idle: boolean; reason?: string};
function setup(mode: 'fullscreen' | 'regular') {
  const root = agentDir(), user = join(root, 'user'); mkdirSync(user);
  writeFileSync(join(user, 'settings.json'), JSON.stringify({tuiMode: mode, quietStartup: true,
    defaultProjectTrust: 'always', retry: {enabled: false}, compaction: {enabled: false}, shellPath: bashPath()}));
  const env = {...process.env, PI_CODING_AGENT_DIR: user, PI_SKIP_VERSION_CHECK: '1', PI_OFFLINE: '1', TERM: 'xterm-256color'} as Record<string, string>;
  for (const key of ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL', 'TMUX', 'STY', 'PI_TUI_WRITE_LOG',
    'PI_SUITE_TEST_RESPONSES_URL', 'PI_SUITE_TEST_GOAL_MODE']) delete env[key];
  const snapshot = () => existsSync(join(root, 'cli-state.json')) ? JSON.parse(readFileSync(join(root, 'cli-state.json'), 'utf8')) as Snapshot : undefined;
  return {root, user, env, snapshot};
}
const pause = () => new Promise(resolve => setTimeout(resolve, 20));

// The actual official bin has its own bundled classes/virtual modules; SDK-only checks miss this boundary.
test('official CLI keeps reading frames continuous, adapts metadata, forks tasks and quits Goals stopped', {timeout: 90000}, async () => {
  assert.equal(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).bin.pi, 'dist/bundle/cli.js');
  for (const mode of ['fullscreen', 'regular'] as const) {
    const {root, env, snapshot} = setup(mode);
    const screen = new xterm.Terminal({cols: 80, rows: 30, allowProposedApi: true});
    const pty = createPtyProcess(process.execPath, [bin, ...args], {cwd: root, env, cols: 80, rows: 30, name: 'xterm-256color'});
    let output = '', exited = false, exitCode: number | undefined, pendingFrame = '', frameId = 0;
    const frames: {id: number; lines: string[]}[] = [];
    const lines = () => Array.from({length: screen.rows}, (_, row) => screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true) ?? '');
    const data = pty.onData(chunk => {
      output = (output + chunk).slice(-64000);
      pendingFrame += chunk;
      // PTY chunks can coalesce a root frame and its successor. Segment the stock
      // host's synchronized commits, or a final-screen check would miss the flash.
      const end = '\x1b[?2026l';
      let boundary: number;
      while ((boundary = pendingFrame.indexOf(end)) >= 0) {
        const frame = pendingFrame.slice(0, boundary + end.length);
        pendingFrame = pendingFrame.slice(boundary + end.length);
        screen.write(frame, () => {
          frames.push({id: ++frameId, lines: lines()});
          if (frames.length > 100) frames.shift();
        });
      }
    });
    const exit = pty.onExit(event => {exited = true; exitCode = event.exitCode;});
    const responses = screen.onData(data => pty.write(data));
    const visible = (text: string) => lines().some(line => line.includes(text));
    const waitFor = async (label: string, predicate: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        assert.equal(exited, false, `${mode}: exited waiting for ${label}\n${output.slice(-6000)}`);
        assert.ok(Date.now() < deadline, `${mode}: timed out waiting for ${label}\n${lines().join('\n')}\n${output.slice(-2000)}`);
        await pause();
      }
    };
    const checkReadingFrames = async (after: number) => {
      await new Promise<void>(done => screen.write('', done));
      const commits = frames.filter(frame => frame.id > after);
      assert.ok(commits.length, 'navigation must paint at least one committed frame');
      for (const frame of commits) {
        const browser = frame.lines.some(line => line.includes('Subagents ▸'));
        const reader = frame.lines.some(line => line.includes('CLI_CHILD') && line.includes('completed'))
          && frame.lines.some(line => line.includes('following') || line.includes('paused'));
        assert.ok(browser || reader, `${mode}: root/blank flash in navigation frame ${frame.id}\n${frame.lines.join('\n')}`);
      }
    };
    try {
      await waitFor('startup', () => !!snapshot());
      pty.write('seed\r'); await waitFor('real tool/child/job execution', () => (snapshot()?.calls ?? 0) >= 6 && snapshot()?.idle === true);
      pty.write('\x1b[D'); await waitFor('native Dock selection', () => visible('↑↓ select'));
      pty.write('\x1b'); await waitFor('Dock selection released', () => !visible('↑↓ select'));
      for (const [command, title] of [['subagents', 'Subagents'], ['jobs', 'Jobs'], ['tasks', 'Tasks']]) {
        const header = `${title} ▸`;
        pty.write(`/${command}\r`); await waitFor(command, () => visible(header));
        if (command === 'subagents') {
          for (const [key, page] of [[']', 'Types'], ['[', 'Runs']] as const) {
            const before = frameId;
            pty.write(key); await waitFor(`tab ${page}`, () => visible(`Subagents ▸ ${page}`));
            await checkReadingFrames(before);
          }
          const entering = frameId;
          pty.write('\r'); await waitFor('child transcript tail', () => visible('Child history paragraph'));
          await checkReadingFrames(entering);
          screen.resize(120, 40); pty.resize(120, 40);
          await waitFor('single-line reader metadata', () => lines().some(line => line.includes('CLI_CHILD') && line.includes('completed') && line.includes('following')));
          const information = lines().findIndex(line => line.includes('CLI_CHILD') && line.includes('completed') && line.includes('following'));
          assert.ok(lines()[information + 1]?.trim(), 'one-line information must be followed by actions, not a reserved blank');
          screen.resize(80, 30); pty.resize(80, 30); await waitFor('reader resize', () => visible('Child history paragraph'));
          pty.write('/'); await waitFor('native reader search', () => lines().some(line => line.trim() === '>'));
          pty.write('CLI_CHILD_DONE\r'); await waitFor('search result', () => visible('CLI_CHILD_DONE') && !lines().some(line => line.startsWith('>')));
          pty.write('\x1b[H'); await waitFor('tool at top', () => visible('printf'));
          pty.write('o'); await waitFor('keyboard tool expansion', () => visible('CLI_TOOL_LINE_13'));
          assert.equal(visible('new output'), false, 'tool expansion is not provider output');
          const returning = frameId;
          pty.write('\x1b'); await waitFor('return to run list', () => visible(header));
          await checkReadingFrames(returning);
        } else if (command === 'jobs') {
          pty.write('\r'); await waitFor('job output viewer', () => !visible(header) && visible('previous bytes') && visible('CLI_STDOUT'));
          pty.write('\x1b'); await waitFor('return to jobs list', () => visible(header));
        }
        pty.write('\x1b'); await waitFor('closed page', () => !visible(header));
      }
      pty.write('/cli-probe\r'); await waitFor('shared host class identity', () => visible('CLI_NATIVE_IDENTITY_true'));
      pty.write('\x1b'); await waitFor('closed identity probe', () => !visible('CLI_NATIVE_IDENTITY_true'));
      const source = snapshot()!.sessionId;
      pty.write('/clone\r'); await waitFor('ordinary clone', () => snapshot()?.sessionId !== source && snapshot()?.calls === 0);
      pty.write('/tasks\r'); await waitFor('persisted task seed', () => visible('Tasks ▸') && visible('CLI_TASK'));
      screen.resize(40, 24); pty.resize(40, 24); await waitFor('narrow resize', () => visible('Tasks ▸'));
      screen.resize(120, 40); pty.resize(120, 40); await waitFor('wide resize', () => visible('Tasks ▸'));
      pty.write('\x1b'); await waitFor('closed resized page', () => !visible('Tasks ▸'));
      pty.write('after clone\r'); await waitFor('normal post-clone request', () => snapshot()?.calls === 1 && snapshot()?.idle === true);
      pty.write('/cli-live\r'); await waitFor('real active child', () => snapshot()?.reason === 'live');
      pty.write('/subagents\r'); await waitFor('active run list', () => visible('Subagents ▸'));
      pty.write('\x1b[A\r'); await waitFor('active run transcript', () => !visible('Subagents ▸') && visible('CLI_LIVE'));
      pty.write('m'); await waitFor('native message Editor', () => visible('▸ Input'));
      pty.write('中文 editor draft'); await waitFor('native Unicode draft', () => visible('中文 editor draft'));
      pty.write('\x1b'); await waitFor('cancelled Editor', () => !visible('中文 editor draft'));
      pty.write('\x1b'); await waitFor('return from active run', () => visible('Subagents ▸'));
      pty.write('\x1b'); await waitFor('closed active run list', () => !visible('Subagents ▸'));
      pty.write('/cli-goal-setup\r'); await waitFor('controlled Goal responses', () => snapshot()?.reason === 'goal-ready');
      pty.write('/goal CLI_QUIT_GOAL\r');
      const goalFile = snapshot()!.sessionFile;
      await waitFor('active Goal waiting on external deadline', () => storedGoal(goalFile)?.status === 'active' && !!storedGoal(goalFile)?.resumeAt);
      pty.write('/exit\r'); const deadline = Date.now() + 5000; while (!exited && Date.now() < deadline) await pause();
      assert.equal(exited, true, 'native host exits normally');
      assert.equal(exitCode, 0, 'native quit completes child/job cleanup without a failing exit');
      assert.equal(storedGoal(goalFile)?.status, 'stopped');
      assert.equal(storedGoal(goalFile)?.automatic, false);
      assert.equal(storedGoal(goalFile)?.resumeAt, undefined, 'quit revokes the scheduled wake');
      const rpcOptions = {cwd: root, env: {...env, PI_SUITE_TEST_GOAL_MODE: '1'},
        cliPath: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')), args: [...args, '--session', goalFile]};
      let resumed = new RpcClient(rpcOptions);
      try {
        await resumed.start(); await resumed.getState(); await new Promise(done => setTimeout(done, 250));
        assert.equal(snapshot()?.calls, 0, 'cold startup must not request the provider');
        assert.equal(storedGoal(goalFile)?.status, 'stopped');
        await resumed.promptAndWait('CLI_ORDINARY_INPUT');
        assert.equal(snapshot()?.calls, 1);
        assert.equal(storedGoal(goalFile)?.status, 'stopped', 'ordinary input is not resume');
        const resumedIdle = resumed.waitForIdle(15000);
        await resumed.prompt('/goal resume');
        await resumedIdle;
        const until = Date.now() + 15000;
        while (!storedGoal(goalFile)?.resumeAt) { assert.ok(Date.now() < until, 'explicit resume did not restore execution'); await pause(); }
        assert.equal(storedGoal(goalFile)?.status, 'active');
        // SIGKILL cannot run Suite's quit hook: recovery must revoke the persisted active
        // lease itself, rather than relying on graceful shutdown to have saved stopped.
        const beforeCrash = readFileSync(goalFile, 'utf8');
        process.kill(snapshot()!.pid, 'SIGKILL');
        await resumed.stop();
        assert.equal(readFileSync(goalFile, 'utf8'), beforeCrash, 'forced exit does not rewrite the active snapshot');
        resumed = new RpcClient(rpcOptions);
        await resumed.start(); await resumed.getState();
        assert.equal(storedGoal(goalFile)?.status, 'stopped', 'cold recovery also revokes any unsaved active lease');
        assert.equal(snapshot()?.calls, 0);
        await resumed.promptAndWait('CLI_AUDIT');
        assert.equal(storedGoal(goalFile)?.status, 'completed', 'completion-only audit does not need resume');
        assert.equal(storedGoal(goalFile)?.progress, 'CLI completed-work audit');
        assert.doesNotMatch(resumed.getStderr(), /TypeError|Extension errors/);
      } finally { await resumed.stop(); }
      assert.doesNotMatch(output, /TypeError|Extension errors/);
    } finally {
      if (!exited) {
        pty.kill(); const deadline = Date.now() + 3000; while (!exited && Date.now() < deadline) await pause();
      }
      responses.dispose(); data.dispose(); exit.dispose(); pty.close(); screen.dispose(); rmSync(root, {recursive: true, force: true});
    }
  }
});

test('official RPC export loads Suite without cleansing command and uses normal persisted fork', {timeout: 30000}, async () => {
  const {root, env, snapshot} = setup('fullscreen');
  const cliPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
  assert.ok(cliPath.endsWith('/dist/bundle/rpc-entry.js') || cliPath.endsWith('\\dist\\bundle\\rpc-entry.js'));
  const client = new RpcClient({cwd: root, env, cliPath, args});
  try {
    await client.start();
    const commands = await client.getCommands();
    assert.ok(commands.some(command => command.name === 'tasks'));
    assert.equal(commands.some(command => command.name === 'responses'), false);
    await client.promptAndWait('seed'); assert.ok(snapshot()!.calls >= 6);
    const before = await client.getState(), {entries, leafId} = await client.getEntries();
    assert.ok(entries.length && leafId);
    assert.equal((await client.clone()).cancelled, false);
    const after = await client.getState(); assert.notEqual(after.sessionId, before.sessionId);
    assert.equal(snapshot()!.calls, 0);
    const sourceTasks = readFileSync(join(root, '.pi', 'tasks', `tasks-${before.sessionId}.json`), 'utf8');
    const {generation: sourceGeneration, ...sourceData} = JSON.parse(sourceTasks);
    const {generation: targetGeneration, ...targetData} = JSON.parse(readFileSync(join(root, '.pi', 'tasks', `tasks-${after.sessionId}.json`), 'utf8'));
    assert.deepEqual(targetData, sourceData, 'ordinary fork keeps the complete task/counter snapshot');
    assert.notEqual(targetGeneration, sourceGeneration, 'the fork has its own task reference generation');
    await client.promptAndWait('after clone'); assert.equal(snapshot()!.calls, 1);
    const resetCalls = snapshot()!.calls;
    await client.prompt('/cli-task-reset');
    await client.promptAndWait('reset and verify stale references');
    assert.equal(snapshot()!.calls - resetCalls, 9, 'real model tool chain performed clear/reuse/stale read/start guards');
    const reset = JSON.parse(readFileSync(join(root, '.pi', 'tasks', `tasks-${after.sessionId}.json`), 'utf8'));
    assert.deepEqual(reset.tasks, []); assert.equal(reset.nextId, 1);
    assert.notEqual(reset.generation, JSON.parse(sourceTasks).generation);
    assert.equal(readFileSync(join(root, '.pi', 'tasks', `tasks-${before.sessionId}.json`), 'utf8'), sourceTasks,
      'target reset must not alter the fork source');
    assert.doesNotMatch(client.getStderr(), /TypeError|Extension errors/);
  } finally {await client.stop(); rmSync(root, {recursive: true, force: true});}
});

type WireItem = {type?: string; id?: string; phase?: string; encrypted_content?: string};

test('official Responses persists new state across resume and keeps original same-model/cross-model phase behavior', {timeout: 30000}, async () => {
  const {root, env, snapshot} = setup('fullscreen');
  const requests: {model: string; input: WireItem[]}[] = [];
  const server = createServer(async (request, response) => {
    const body: Buffer[] = []; for await (const chunk of request) body.push(chunk);
    requests.push(JSON.parse(Buffer.concat(body).toString()));
    const n = requests.length, id = `resp_normal_${n}`;
    const reasoning = {type: 'reasoning', id: `rs_normal_${n}`, encrypted_content: `cipher_normal_${n}`,
      summary: [{type: 'summary_text', text: 'normal reasoning'}]};
    const message = {type: 'message', id: `msg_normal_${n}`, role: 'assistant', phase: 'final_answer', status: 'completed',
      content: [{type: 'output_text', text: `NORMAL_RESPONSE_${n}`, annotations: []}]};
    response.writeHead(200, {'content-type': 'text/event-stream'});
    for (const event of [
      {type: 'response.created', response: {id}},
      {type: 'response.output_item.added', output_index: 0, item: {...reasoning, summary: []}},
      {type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: reasoning.id, summary_index: 0, delta: 'normal reasoning'},
      {type: 'response.output_item.done', output_index: 0, item: reasoning},
      {type: 'response.output_item.added', output_index: 1, item: {...message, content: []}},
      {type: 'response.content_part.added', output_index: 1, content_index: 0, item_id: message.id, part: {type: 'output_text', text: '', annotations: []}},
      {type: 'response.output_text.delta', output_index: 1, content_index: 0, item_id: message.id, delta: `NORMAL_RESPONSE_${n}`},
      {type: 'response.output_item.done', output_index: 1, item: message},
      {type: 'response.completed', response: {id, status: 'completed', output: [reasoning, message],
        usage: {input_tokens: 4, output_tokens: 5, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 1}}}},
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  env.PI_SUITE_TEST_RESPONSES_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const cliPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
  let client = new RpcClient({cwd: root, env, cliPath, args});
  try {
    await client.start(); await client.promptAndWait('normal request');
    assert.equal(requests.length, 1);
    const file = snapshot()!.sessionFile, first = readFileSync(file, 'utf8');
    assert.ok(first.includes('cipher_normal_1') && first.includes('resp_normal_1') && first.includes('msg_normal_1'));
    await client.stop();
    client = new RpcClient({cwd: root, env, cliPath, args: [...args, '--session', file]});
    await client.start(); await client.promptAndWait('after resume');
    assert.equal(requests.length, 2);
    assert.ok(requests[1].input.some(item => item.id === 'rs_normal_1' && item.encrypted_content === 'cipher_normal_1'));
    assert.ok(requests[1].input.some(item => item.id === 'msg_normal_1' && item.phase === 'final_answer'));
    await client.setModel('cli-proof', 'other'); await client.promptAndWait('other model');
    assert.equal(requests.length, 3); assert.equal(requests[2].model, 'other');
    const crossed = requests[2].input.filter(item => item.type === 'message'); assert.ok(crossed.length);
    assert.ok(crossed.every(item => item.phase === undefined),
      'original transformMessages does not restore cross-model phase');
    assert.ok(readFileSync(file, 'utf8').includes('cipher_normal_1'), 'wire conversion must not rewrite stored history');
    assert.doesNotMatch(client.getStderr(), /TypeError|Extension errors/);
  } finally {
    await client.stop(); server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done())); rmSync(root, {recursive: true, force: true});
  }
});

// Semantic tests cover the grammar. This single stock-bin scenario checks its actual consumers,
// terminal color conversion, cached history, package resources and native reload boundaries.
test('official CLI shares command roles across native calls, ToolCommand and Jobs at three widths', {timeout: 60000}, async () => {
  for (const trueColor of ['1', '0']) {
    const {root, user, env, snapshot} = setup('fullscreen');
    env.PI_SUITE_TEST_HIGHLIGHT = '1'; env.PI_TRUE_COLOR = trueColor;
    const palette = JSON.parse(readFileSync(resolve('themes/oh-my-pi.json'), 'utf8'));
    const copy = structuredClone(palette); copy.name = 'command-proof';
    mkdirSync(join(user, 'themes')); writeFileSync(join(user, 'themes', 'command-proof.json'), JSON.stringify(copy));
    const screen = new xterm.Terminal({cols: 80, rows: 40, allowProposedApi: true});
    const packageArgs = args.map(arg => arg === resolve('src/index.ts') ? resolve('.') : arg);
    const pty = createPtyProcess(process.execPath, [bin, ...packageArgs, '--use-theme', 'oh-my-pi'], {cwd: root, env, cols: 80, rows: 40, name: 'xterm-256color'});
    let exited = false, output = '';
    const data = pty.onData(chunk => {output = (output + chunk).slice(-32000); screen.write(chunk);});
    const exit = pty.onExit(() => {exited = true;});
    const responses = screen.onData(chunk => pty.write(chunk));
    const lines = () => Array.from({length: screen.rows}, (_, row) => screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true) ?? '');
    const expected = (token: string) => {
      let color = palette.colors[token];
      while (palette.vars[color]) color = palette.vars[color];
      const ansi = foregroundAnsi(parseColor(color), trueColor === '1' ? 'truecolor' : '256color');
      return trueColor === '1' ? parseInt(color.slice(1), 16) : Number(/(\d+)m$/.exec(ansi)![1]);
    };
    const hasColor = (word: string, token: string, native = false) => lines().some((line, row) => {
      if (native && !line.trimStart().startsWith('$ FOO=')) return false;
      const col = line.indexOf(word);
      if (col < 0) return false;
      const cell = screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.getCell(col);
      return cell?.getFgColor() === expected(token) && (trueColor === '1' ? cell.isFgRGB() : cell.isFgPalette());
    });
    const visible = (text: string) => lines().some(line => line.includes(text));
    const waitFor = async (label: string, predicate: () => boolean) => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        assert.equal(exited, false, `CLI exited during ${label}\n${output.slice(-3000)}`);
        assert.ok(Date.now() < deadline, `${trueColor}: ${label}\n${lines().join('\n')}\n${output.slice(-2000)}`);
        await pause();
      }
    };
    const checkCommand = async () => {
      await waitFor('command roles', () => hasColor('node', 'syntaxFunction') && hasColor('--version', 'syntaxType') && hasColor('2>&1', 'syntaxOperator'));
    };
    try {
      await waitFor('startup', () => !!snapshot());
      pty.write('highlight\r'); await waitFor('real native and job calls', () => (snapshot()?.calls ?? 0) >= 3 && snapshot()?.idle === true);
      for (const columns of [40, 80, 120]) {
        screen.resize(columns, 40); pty.resize(columns, 40);
        await checkCommand();
        pty.write('\x0f'); await waitFor('expanded ToolCommand', () => visible('command:'));
        await checkCommand();
        pty.write('\x0f'); await waitFor('collapsed ToolCommand', () => !visible('command:'));
      }
      pty.write('/jobs\r'); await waitFor('Jobs list', () => visible('Jobs ▸'));
      pty.write('\r'); await waitFor('Jobs command pane', () => !visible('Jobs ▸') && visible('command'));
      pty.write('c');
      for (const columns of [40, 80, 120]) {
        screen.resize(columns, 40); pty.resize(columns, 40);
        await checkCommand();
        await waitFor('Unicode command remains visible', () => visible('中文😀'));
      }
      pty.write('\x1b'); await waitFor('return to Jobs', () => visible('Jobs ▸'));
      pty.write('\x1b'); await waitFor('return to chat', () => !visible('Jobs ▸'));
      pty.write('/cli-highlight-theme command-proof\r');
      await waitFor('copied user theme selected', () => snapshot()?.reason === 'theme-command-proof');
      copy.vars.syntaxCyan = '#ff99cc'; writeFileSync(join(user, 'themes', 'command-proof.json'), JSON.stringify(copy));
      const original = palette.vars.syntaxCyan; palette.vars.syntaxCyan = copy.vars.syntaxCyan;
      await checkCommand();
      palette.vars.syntaxCyan = original;
      pty.write('/cli-highlight-theme oh-my-pi\r'); await checkCommand();
      writeFileSync(join(user, 'pi-suite.json'), JSON.stringify({ui: {highlightBuiltinCommands: false}}));
      pty.write('/reload\r');
      await waitFor('native history after disabled/reload', () => hasColor('node', 'toolTitle', true));
      pty.write('\x0f'); await waitFor('ToolCommand remains enhanced after disabled/reload', () => visible('command:') && hasColor('node', 'syntaxFunction'));
      assert.doesNotMatch(output, /TypeError|Extension errors/);
      pty.write('/exit\r'); await waitFor('normal quit', () => exited);
    } finally {
      if (!exited) {
        pty.kill(); const deadline = Date.now() + 3000; while (!exited && Date.now() < deadline) await pause();
      }
      responses.dispose(); data.dispose(); exit.dispose(); pty.close(); screen.dispose(); rmSync(root, {recursive: true, force: true});
    }
  }
});
