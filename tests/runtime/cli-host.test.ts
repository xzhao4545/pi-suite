import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import xterm from '@xterm/headless';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {createPtyProcess} from '../../src/jobs/backends/pty.ts';
import {agentDir, bashPath} from '../support/jobs.ts';

const packageDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const bin = resolve(packageDir, JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).bin.pi);
const fixtureArgs = ['-ns', '-np', '-nc', '--no-mcp', '-e', resolve('tests/support/fixtures/cli-host.ts'),
  '--provider', 'cli-proof', '--model', 'offline'];
const args = ['-ne', '-e', resolve('src/index.ts'), ...fixtureArgs];
type Snapshot = {sessionId: string; sessionFile: string; calls: number; api: string; idle: boolean; reason?: string};
function setup(mode: 'fullscreen' | 'regular') {
  const root = agentDir(), user = join(root, 'user'); mkdirSync(user);
  writeFileSync(join(user, 'settings.json'), JSON.stringify({tuiMode: mode, quietStartup: true,
    defaultProjectTrust: 'always', retry: {enabled: false}, compaction: {enabled: false}, shellPath: bashPath()}));
  const env = {...process.env, PI_CODING_AGENT_DIR: user, PI_SKIP_VERSION_CHECK: '1', PI_OFFLINE: '1', TERM: 'xterm-256color'} as Record<string, string>;
  for (const key of ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL', 'TMUX', 'STY', 'PI_TUI_WRITE_LOG',
    'PI_SUITE_TEST_RESPONSES_URL']) delete env[key];
  const snapshot = () => existsSync(join(root, 'cli-state.json')) ? JSON.parse(readFileSync(join(root, 'cli-state.json'), 'utf8')) as Snapshot : undefined;
  return {root, user, env, snapshot};
}
const pause = () => new Promise(resolve => setTimeout(resolve, 20));

// The actual official bin has its own bundled classes/virtual modules; SDK-only checks miss this boundary.
test('official published CLI renders keyboard Subagents/Jobs/Tasks with shared native classes and ordinary clone', {timeout: 60000}, async () => {
  assert.equal(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).bin.pi, 'dist/bundle/cli.js');
  for (const mode of ['fullscreen', 'regular'] as const) {
    const {root, env, snapshot} = setup(mode);
    const screen = new xterm.Terminal({cols: 80, rows: 30, allowProposedApi: true});
    const pty = createPtyProcess(process.execPath, [bin, ...args], {cwd: root, env, cols: 80, rows: 30, name: 'xterm-256color'});
    let output = '', exited = false, exitCode: number | undefined;
    const data = pty.onData(chunk => {output = (output + chunk).slice(-64000); screen.write(chunk);});
    const exit = pty.onExit(event => {exited = true; exitCode = event.exitCode;});
    const responses = screen.onData(data => pty.write(data));
    const lines = () => Array.from({length: screen.rows}, (_, row) => screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true) ?? '');
    const visible = (text: string) => lines().some(line => line.includes(text));
    const waitFor = async (label: string, predicate: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        assert.equal(exited, false, `${mode}: exited waiting for ${label}\n${output.slice(-6000)}`);
        assert.ok(Date.now() < deadline, `${mode}: timed out waiting for ${label}\n${lines().join('\n')}\n${output.slice(-2000)}`);
        await pause();
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
          pty.write('\r'); await waitFor('child transcript tail', () => visible('Child history paragraph'));
          pty.write('/'); await waitFor('native reader search', () => lines().some(line => line.trim() === '>'));
          pty.write('CLI_CHILD_DONE\r'); await waitFor('search result', () => visible('CLI_CHILD_DONE') && !lines().some(line => line.startsWith('>')));
          pty.write('\x1b[H'); await waitFor('tool at top', () => visible('printf'));
          pty.write('o'); await waitFor('keyboard tool expansion', () => visible('CLI_TOOL_LINE_13'));
          assert.equal(visible('new output'), false, 'tool expansion is not provider output');
          pty.write('\x1b'); await waitFor('return to run list', () => visible(header));
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
      pty.write('/exit\r'); const deadline = Date.now() + 5000; while (!exited && Date.now() < deadline) await pause();
      assert.equal(exited, true, 'native host exits normally');
      assert.equal(exitCode, 0, 'native quit completes child/job cleanup without a failing exit');
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
    assert.equal(readFileSync(join(root, '.pi', 'tasks', `tasks-${after.sessionId}.json`), 'utf8'), sourceTasks);
    await client.promptAndWait('after clone'); assert.equal(snapshot()!.calls, 1);
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
