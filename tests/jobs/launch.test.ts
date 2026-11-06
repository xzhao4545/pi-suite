import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSessionEntries, type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentCommand } from '../../src/jobs/launch/presets.ts';
import { agentDir, manager, owner, settled, testShell } from '../support/jobs.ts';
import { host } from '../support/host.ts';
import { terminal } from '../support/terminal.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { JobsModule } from '../../src/jobs/index.ts';
import { attachJob } from '../../src/jobs/viewer.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { Dock } from '../../src/ui/dock.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { TerminalView } from '../../src/ui/terminal.ts';

test('preset field merging and exact policy matching keep user-only rules and deny precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-launch-config-'));
  const user = join(root, 'user'), project = join(root, 'project');
  mkdirSync(user); mkdirSync(join(project, '.pi'), { recursive: true });
  const userConfig = {
    jobs: { agents: { pi: { command: '/opt/custom pi', args: ['--verbose'] }, local: { command: 'local-cli' } },
      launchPolicy: [{ command: 'echo exact', decision: 'allow' }, { command: 'echo exact', decision: 'deny' }, { command: 'echo ok', decision: 'allow' }] },
  };
  writeFileSync(join(user, 'pi-suite.json'), JSON.stringify(userConfig));
  writeFileSync(join(project, '.pi', 'pi-suite.json'), JSON.stringify({ jobs: { agents: { pi: { args: ['--no-extensions'] } } } }));
  const config = loadConfig(project, user);
  assert.deepEqual(config.jobs.agents.pi, { command: '/opt/custom pi', args: ['--no-extensions'] });
  assert.deepEqual(config.jobs.agents.local, { command: 'local-cli', args: [] });
  assert.equal(config.jobs.agents.cursor.command, 'agent');
  assert.equal(config.jobs.launchPolicy('echo exact'), 'deny');
  assert.equal(config.jobs.launchPolicy('echo ok'), 'allow');
  assert.equal(config.jobs.launchPolicy(' echo ok'), 'ask');
  assert.equal(config.jobs.launchPolicy('echo ok; echo extra'), 'ask');
  writeFileSync(join(project, '.pi', 'pi-suite.json'), JSON.stringify({ jobs: { launchPolicy: [] } }));
  assert.throws(() => loadConfig(project, user), /user-only/);
  writeFileSync(join(project, '.pi', 'pi-suite.json'), JSON.stringify({ jobs: { agents: { missing: { args: [] } } } }));
  assert.throws(() => loadConfig(project, user), /missing needs command/);
  writeFileSync(join(project, '.pi', 'pi-suite.json'), JSON.stringify({ jobs: { agents: { invalid: { command: ' ' } } } }));
  assert.throws(() => loadConfig(project, user), /Invalid pi-suite configuration/);
});

test('literal CLI prompts round-trip through Bash; pi fork arguments never become shell syntax', { timeout: 10000 }, async () => {
  const jobs = manager(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-launch-'));
  const prompt = '--mode=bad 中文 $HOME `touch INJECTED` $(touch INJECTED) \' " \\ \nsecond line';
  const capture = { command: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))'] };
  try {
    const command = agentCommand({ preset: 'test', prompt }, { test: capture });
    const started = await jobs.start({ ...owner, cwd, command }, testShell());
    const done = await settled(jobs, started.id);
    assert.equal(done.exitCode, 0);
    assert.deepEqual(JSON.parse(readFileSync(jobs.logPath(done, 'stdout'), 'utf8')), [prompt]);
    assert.equal(existsSync(join(cwd, 'INJECTED')), false);
    // This controlled executable captures Pi's switches instead of interpreting them itself.
    const script = join(cwd, 'capture.js');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const fork = agentCommand({ preset: 'pi', prompt, fork: true }, { pi: { command: process.execPath, args: [script, '--'] } }, '/tmp/a session\'s.jsonl');
    const forked = await jobs.start({ ...owner, cwd, command: fork }, testShell());
    const result = await settled(jobs, forked.id);
    assert.deepEqual(JSON.parse(readFileSync(jobs.logPath(result, 'stdout'), 'utf8')), ['--fork', '/tmp/a session\'s.jsonl', '--', prompt]);
    assert.throws(() => agentCommand({ preset: 'pi', prompt, fork: true }, { pi: capture }), /unpersisted/);
    assert.throws(() => agentCommand({ preset: 'test', prompt, fork: true }, { test: capture }), /only by the pi/);
    assert.throws(() => agentCommand({ preset: 'constructor', prompt }, { test: capture }), /Unknown CLI agent/);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test('real Pi 1.5 CLI preserves literal @ prompts in fork, pipe, JSON and the shared PTY viewer', {timeout: 30000}, async () => {
  const root = agentDir(), target = join(root, 'cli-sessions'), capture = join(root, 'received.json'), extension = join(root, 'offline-provider.ts');
  mkdirSync(target);
  // The provider runs inside the real CLI. It records the received model context so
  // argv handling and fork ancestry are checked without credentials or a paid endpoint.
  writeFileSync(extension, `import {writeFileSync} from 'node:fs';
import {fauxProvider, fauxAssistantMessage} from '@earendil-works/pi-ai';
export default pi => {
  const faux = fauxProvider({provider: 'cli-offline', models: [{id: 'offline'}]});
  faux.setResponses(Array(8).fill(context => {
    const messages = context.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string'
      ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\\n'));
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify({messages, prompt: messages.at(-1), calls: faux.state.callCount}));
    return fauxAssistantMessage('CLI_READY');
  }));
  pi.registerProvider(faux.provider);
}`);
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle', 'cli.js');
  const base = {command: process.execPath, args: [cli, '--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-tools',
    '--provider', 'cli-offline', '--model', 'offline', '--thinking', 'off', '-e', extension, '--session-dir', target]};
  const prompt = '@literal 中文 $HOME `touch INJECTED` $(touch INJECTED) \' " \\ \nnext line';
  // A real matching file would expose any accidental native @file interpretation.
  writeFileSync(join(root, prompt.slice(1)), 'ATTACHMENT_SENTINEL');
  const pipeCommand = agentCommand({preset: 'pi', prompt}, {pi: base});
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({
    modules: {ask: false, tasks: false, goal: false, agents: false},
    jobs: {agents: {pi: base}, launchPolicy: [{command: pipeCommand, decision: 'allow'}]},
  }));
  for (const mode of [['--mode', 'rpc'], ['--mode=rpc']]) {
    assert.throws(() => agentCommand({preset: 'pi', prompt}, {pi: {...base, args: [...base.args, ...mode]}}), /RPC mode/);
  }
  let pi!: ExtensionAPI, ctx!: ExtensionContext;
  const ready = Promise.withResolvers<TerminalView>();
  const h = await host({root, persisted: true, tools: ['job_start', 'wait'], extend: api => { pi = api; pi.on('session_start', (_event, context) => { ctx = context; }); },
    ui: ui => ({...ui, custom: (async factory => new Promise(resolve => {
      Promise.resolve(factory(terminal(30, 60), ui.theme, {} as never, resolve)).then(view => { assert.ok(view instanceof TerminalView); ready.resolve(view); });
    })) as ExtensionUIContext['custom']})});
  const runtime = acquireRuntime(root); assert.equal(runtime.mode, 'active'); if (runtime.mode !== 'active') assert.fail('Jobs unavailable');
  const jobs = runtime.manager, binding = new SessionBinding(); binding.bind(ctx);
  const notices = new Notifications(pi, binding), dock = new Dock(), facade = new JobsModule(pi, binding, notices, new StatusPublisher(dock));
  const received = () => JSON.parse(readFileSync(capture, 'utf8')) as {prompt: string; messages: string[]; calls: number};
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 6000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'Real Pi CLI did not reach the expected state'); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  try {
    h.faux.setResponses([fauxAssistantMessage('SOURCE_REPLY')]); await h.session.prompt('SOURCE_PARENT');
    const source = h.session.sessionManager.getSessionFile()!, original = readFileSync(source, 'utf8');
    const command = agentCommand({preset: 'pi', prompt, fork: true}, {pi: {...base, args: [...base.args, '--system-prompt', '-e', '--print']}}, source);
    const fork = await jobs.start({...owner, cwd: root, command, closeInput: true}, testShell());
    const result = await settled(jobs, fork.id); assert.equal(result.exitCode, 0, readFileSync(jobs.logPath(result, 'stderr'), 'utf8'));
    assert.deepEqual(received().messages, ['SOURCE_PARENT', prompt]); assert.equal(received().calls, 1);
    assert.equal(readFileSync(source, 'utf8'), original);
    const forkEntries = parseSessionEntries(readFileSync(join(target, readdirSync(target).find(name => name.endsWith('.jsonl'))!), 'utf8'));
    assert.ok(forkEntries.some(entry => entry.type === 'session' && entry.id !== ctx.sessionManager.getSessionId()));
    assert.equal(existsSync(join(root, 'INJECTED')), false);

    // Exercise the actual model tool's default pipe and exact final-command policy.
    let pipeId = '';
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('job_start', {agent: {preset: 'pi', prompt}})),
      context => { pipeId = idFrom(context); return fauxAssistantMessage(fauxToolCall('wait', {ids: [pipeId]})); },
      () => fauxAssistantMessage('PIPE_DONE'),
    ]);
    await h.session.prompt('Launch a literal Pi task'); await h.idle();
    assert.equal(jobs.peek(pipeId).state, 'completed');
    assert.deepEqual(received().messages, [prompt]); assert.equal(received().calls, 1);

    writeFileSync(join(root, 'context.txt'), 'CONTEXT_SENTINEL');
    const json = await jobs.start({...owner, cwd: root, closeInput: true, command: agentCommand({preset: 'pi', prompt},
      {pi: {...base, args: [...base.args, '--append-system-prompt', '--', '--mode', 'json', '@context.txt', '--']}})}, testShell());
    const jsonDone = await settled(jobs, json.id);
    assert.equal(jsonDone.exitCode, 0, readFileSync(jobs.logPath(jsonDone, 'stderr'), 'utf8'));
    assert.ok(received().prompt.includes('CONTEXT_SENTINEL')); assert.ok(received().prompt.endsWith(prompt));
    assert.equal(received().calls, 1);
    const events = readFileSync(jobs.logPath(jsonDone, 'stdout'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
    assert.ok(events.some(event => event.type === 'message_end' && event.message.role === 'user' && event.message.content[0].text === received().prompt));

    const job = await jobs.start({...owner, cwd: root, mode: 'pty', command: agentCommand({preset: 'pi', prompt}, {pi: base})}, testShell());
    await until(() => received().prompt === prompt && jobs.terminal(job.id)!.getViewportLines().join('\n').includes('CLI_READY'));
    const attached = attachJob(ctx, {jobs: facade, dock, notifications: notices, keys: () => loadConfig(root).jobs}, job.id);
    const view = await ready.promise;
    for (const width of [40, 60, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
    view.handleInput('USER_INPUT\r'); assert.equal(jobs.userControlled(job.id), true);
    assert.throws(() => jobs.write(job.id, 'blocked', {source: 'model', kind: 'text'}), /USER_CONTROL/);
    await until(() => received().prompt === 'USER_INPUT');
    view.handleInput('\x07'); assert.equal(jobs.userControlled(job.id), false);
    jobs.write(job.id, 'MODEL_INPUT\r', {source: 'model', kind: 'text'}); await until(() => received().prompt === 'MODEL_INPUT');
    view.handleInput('\x02'); assert.equal((await attached).action, 'detach'); assert.equal(jobs.peek(job.id).state, 'running');
    assert.equal(h.faux.state.callCount, 4, 'viewing the CLI never wakes the parent provider');
    const stopped = await jobs.stop(job.id, 'user'); assert.equal(stopped.job.state, 'stopped'); assert.equal(stopped.job.cleanup.state, 'managed_scope_confirmed');
  } finally { await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});

function lastText(context: TranscriptContext): string {
  const message = context.messages.findLast(message => message.role === 'toolResult');
  assert.ok(message?.role === 'toolResult');
  return message.content.map(part => part.type === 'text' ? part.text : '').join('\n');
}
const idFrom = (context: TranscriptContext) => /job_[a-f0-9]{8}/.exec(lastText(context))![0];

test('job_start launches a configured CLI preset after one explicit ask and reads its literal prompt', { timeout: 30000 }, async () => {
  const root = agentDir(), output = 'process.stdout.write(process.argv[1])';
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ jobs: { agents: { local: { command: process.execPath, args: ['-e', output] } } } }));
  const h = await host({ root, tools: ['job_start', 'wait', 'job_read'] });
  let id = '';
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('job_start', { agent: { preset: 'local', prompt: 'literal $HOME 中文' } })),
      context => { id = idFrom(context); return fauxAssistantMessage(fauxToolCall('wait', { ids: [id] })); },
      () => fauxAssistantMessage(fauxToolCall('job_read', { id })),
      context => { assert.match(lastText(context), /literal \$HOME 中文/); return fauxAssistantMessage('done'); },
    ]);
    await h.session.prompt('Launch the configured CLI'); await h.idle();
    assert.equal(h.faux.state.callCount, 4);
  } finally { await h.dispose(); }
});

test('policy denial and cancelled launch questions create no job or process and cancel goal continuation', { timeout: 30000 }, async () => {
  for (const denied of [true, false]) {
    const root = agentDir(), command = 'echo forbidden > MUST_NOT_EXIST';
    if (denied) writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ jobs: { launchPolicy: [{ command, decision: 'deny' }] } }));
    const h = await host({ root, tools: ['job_start'], answer: 'cancel' });
    try {
      h.faux.setResponses([
        () => fauxAssistantMessage(fauxToolCall('job_start', { command })),
        context => { assert.match(lastText(context), /LAUNCH_DENIED/); return fauxAssistantMessage('denied'); },
      ]);
      await h.session.prompt(denied ? 'Try the denied command' : '/goal Start only if the user confirms'); await h.idle();
      assert.equal(h.faux.state.callCount, denied ? 2 : 1);
      assert.equal(existsSync(join(root, 'MUST_NOT_EXIST')), false);
      assert.equal(existsSync(join(root, 'pi-suite', 'jobs')), false);
      if (!denied) assert.equal(h.goal()?.automatic, false);
    } finally { await h.dispose(); }
  }
});

test('launch policy authorizes generated monitor commands and a detector before allocating the job', { timeout: 10000 }, async () => {
  const jobs = manager(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-launch-monitor-'));
  const seen: string[] = [];
  try {
    await assert.rejects(jobs.start({ ...owner, cwd, command: 'echo ready', monitor: {
      strategy: 'poll-diff', poll: { intervalMs: 250 }, triggers: [{ id: 'up', literal: 'ready' }], detector: { command: 'echo true' },
    } }, testShell(), undefined, async command => {
      seen.push(command);
      if (command === 'echo true') throw new Error('detector denied');
    }), /detector denied/);
    assert.match(seen[0], /^while true; do echo ready; sleep 0.25; done$/);
    assert.equal(seen[1], 'echo true');
    assert.deepEqual(jobs.activeIds(owner.ownerSessionId), []);
    seen.length = 0;
    await assert.rejects(jobs.start({ ...owner, cwd, monitor: { strategy: 'file-watch', fileWatch: { path: cwd }, triggers: [{ id: 'change', literal: 'CHANGE' }] } },
      testShell(), undefined, async command => { seen.push(command); throw new Error('watch denied'); }), /watch denied/);
    assert.match(seen[0], / -e .*eval\(Buffer.from/);
    assert.deepEqual(jobs.activeIds(owner.ownerSessionId), []);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test('noninteractive launch needs an exact allow rule; argument conflicts still fail before launch', { timeout: 30000 }, async () => {
  const root = agentDir();
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({ jobs: { launchPolicy: [{ command: 'echo allowed', decision: 'allow' }] } }));
  const h = await host({ root, tools: ['job_start', 'wait'] });
  try {
    await h.session.bindExtensions({ mode: 'rpc' });
    let id = '';
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo unmatched' })),
      context => {
        assert.match(lastText(context), /LAUNCH_CONFIRMATION_REQUIRED/);
        return fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo allowed', agent: { preset: 'pi', prompt: 'task' } }));
      },
      context => {
        assert.match(lastText(context), /INVALID_ARGS: Give command or agent/);
        return fauxAssistantMessage(fauxToolCall('job_start', { command: 'echo allowed' }));
      },
      context => { id = idFrom(context); return fauxAssistantMessage(fauxToolCall('wait', { ids: [id] })); },
      () => fauxAssistantMessage('done'),
    ]);
    await h.session.prompt('Apply user launch rules'); await h.idle();
    assert.equal(h.faux.state.callCount, 5);
  } finally { await h.dispose(); }
});
