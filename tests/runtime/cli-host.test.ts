import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import xterm from '@xterm/headless';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {createPtyProcess} from '../../src/jobs/backends/pty.ts';
import {agentDir, bashPath} from '../support/jobs.ts';

const packageDir = dirname(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const bin = resolve(packageDir, JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).bin.pi);
const args = ['-ne', '-ns', '-np', '-nc', '--no-mcp', '-e', resolve('src/index.ts'), '-e', resolve('tests/support/fixtures/cli-host.ts'),
  '--provider', 'cli-proof', '--model', 'offline'];
type Snapshot = {sessionId: string; sessionFile: string; calls: number; layout: string; preparedFork: boolean; idle: boolean};
function setup(mode: 'fullscreen' | 'regular') {
  const root = agentDir(), user = join(root, 'user'); mkdirSync(user);
  writeFileSync(join(user, 'settings.json'), JSON.stringify({tuiMode: mode, quietStartup: true,
    defaultProjectTrust: 'always', retry: {enabled: false}, compaction: {enabled: false}, shellPath: bashPath()}));
  const env = {...process.env, PI_CODING_AGENT_DIR: user, PI_SKIP_VERSION_CHECK: '1', TERM: 'xterm-256color'} as Record<string, string>;
  for (const key of ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL', 'TMUX', 'STY', 'PI_TUI_WRITE_LOG']) delete env[key];
  const snapshot = () => existsSync(join(root, 'cli-state.json')) ? JSON.parse(readFileSync(join(root, 'cli-state.json'), 'utf8')) as Snapshot : undefined;
  return {root, env, snapshot};
}
const pause = () => new Promise(resolve => setTimeout(resolve, 20));

// Launch the package's actual bin, not dist/index.js or an SDK session with a mock uiContext.
test('published CLI shares patched native classes and renders real Subagents/Jobs/Tasks pages through PTY input', {timeout: 60000}, async () => {
  for (const mode of ['fullscreen', 'regular'] as const) {
    const {root, env, snapshot} = setup(mode);
    const screen = new xterm.Terminal({cols: 80, rows: 30, allowProposedApi: true});
    const pty = createPtyProcess(process.execPath, [bin, ...args], {cwd: root, env, cols: 80, rows: 30, name: 'xterm-256color'});
    let output = '', exited = false;
    const data = pty.onData(chunk => {output = (output + chunk).slice(-64000); screen.write(chunk);});
    const exit = pty.onExit(() => {exited = true;});
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
      for (const [command, title] of [['subagents', 'Subagents'], ['jobs', 'Jobs'], ['tasks', 'Tasks']]) {
        const header = `${title} ▸`;
        pty.write(`/${command}\r`); await waitFor(command, () => visible(header));
        if (command === 'subagents') {
          pty.write('\r'); await waitFor('child transcript tail', () => visible('Child history paragraph'));
          if (mode === 'fullscreen') {
            pty.write('\x1b[H'); await waitFor('tool at top', () => visible('printf'));
            const row = lines().findIndex(line => line.includes('printf'));
            pty.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
            await waitFor('native tool expansion', () => visible('CLI_TOOL_LINE_13'));
            assert.equal(visible('new output'), false, 'tool expansion is not provider output');
          }
          pty.write('\x1b'); await waitFor('return to run list', () => visible(header));
        } else if (command === 'jobs') {
          pty.write('\r'); await waitFor('job output viewer', () => !visible(header) && visible('previous bytes') && visible('CLI_STDOUT'));
          pty.write('\x1b'); await waitFor('return to jobs list', () => visible(header));
        }
        pty.write('\x1b'); await waitFor('closed page', () => !visible(header));
      }
      pty.write('/cli-probe\r'); await waitFor('shared host class identity', () => visible('CLI_NATIVE_IDENTITY_true'));
      pty.write('\x1b'); await waitFor('closed identity probe', () => !visible('CLI_NATIVE_IDENTITY_true'));
      assert.equal(snapshot()!.layout, 'function'); assert.equal(snapshot()!.preparedFork, true);
      const source = snapshot()!.sessionId;
      pty.write('/responses fork\r'); await waitFor('real prepared fork', () => snapshot()?.sessionId !== source && snapshot()?.calls === 0);
      const fork = snapshot()!;
      assert.ok(!readFileSync(fork.sessionFile, 'utf8').includes('resp_cli_'), 'persisted fork contains no old replay state');
      pty.write('/tasks\r'); await waitFor('fork task seed', () => visible('Tasks ▸') && visible('CLI_TASK'));
      screen.resize(40, 24); pty.resize(40, 24); await waitFor('narrow resize', () => visible('Tasks ▸'));
      screen.resize(120, 40); pty.resize(120, 40); await waitFor('wide resize', () => visible('Tasks ▸'));
      pty.write('\x1b'); await waitFor('closed resized page', () => !visible('Tasks ▸'));
      pty.write('after fork\r'); await waitFor('normal post-fork request', () => snapshot()?.calls === 1 && snapshot()?.idle === true);
      assert.ok(readFileSync(fork.sessionFile, 'utf8').includes('resp_cli_'), 'new Responses fields remain normally persisted');
      pty.write('/exit\r'); const deadline = Date.now() + 5000; while (!exited && Date.now() < deadline) await pause();
      assert.equal(exited, true, 'native host exits normally');
      assert.doesNotMatch(output, /TypeError|renderLayout.*not a function|Extension errors/);
    } finally {
      if (!exited) {
        pty.kill(); const deadline = Date.now() + 3000; while (!exited && Date.now() < deadline) await pause();
      }
      responses.dispose(); data.dispose(); exit.dispose(); pty.close(); screen.dispose(); rmSync(root, {recursive: true, force: true});
    }
  }
});

test('exported RPC shares patched module graph; unsupported bundle rejects before page rendering', {timeout: 30000}, async () => {
  const {root, env, snapshot} = setup('fullscreen');
  const client = new RpcClient({cwd: root, env, cliPath: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')), args});
  try {
    await client.start();
    const commands = await client.getCommands(); assert.ok(commands.some(command => command.name === 'responses'));
    await client.promptAndWait('seed'); assert.ok(snapshot()!.calls >= 6);
    const before = await client.getState();
    assert.equal(await client.prompt('/responses fork'), 'handled');
    const after = await client.getState(); assert.notEqual(after.sessionId, before.sessionId);
    assert.equal(snapshot()!.preparedFork, true); assert.equal(snapshot()!.layout, 'function'); assert.equal(snapshot()!.calls, 0);
    assert.ok(!readFileSync(snapshot()!.sessionFile, 'utf8').includes('resp_cli_'));
    await client.promptAndWait('after fork'); assert.equal(snapshot()!.calls, 1);
    assert.ok(readFileSync(snapshot()!.sessionFile, 'utf8').includes('resp_cli_'));
    assert.doesNotMatch(client.getStderr(), /TypeError|Extension errors/);
  } finally {await client.stop(); rmSync(root, {recursive: true, force: true});}

  // The stock 1.5.0 bundle is a negative control: reject its stale virtual modules
  // during extension loading, not after a user opens a page in the async renderer.
  const legacy = setup('fullscreen');
  const unsupported = new RpcClient({cwd: legacy.root, env: legacy.env, cliPath: join(packageDir, 'dist/bundle/cli.js'), args});
  try {
    await assert.rejects(async () => {await unsupported.start(); await unsupported.getState();}, /requires the patched Node host/);
    assert.match(unsupported.getStderr(), /requires the patched Node host/);
    assert.doesNotMatch(unsupported.getStderr(), /TypeError.*renderLayout/);
  } finally {await unsupported.stop(); rmSync(legacy.root, {recursive: true, force: true});}
});
