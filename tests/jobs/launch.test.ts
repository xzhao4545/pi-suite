import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentCommand } from '../../src/jobs/launch/presets.ts';
import { agentDir, manager, owner, settled, testShell } from '../support/jobs.ts';
import { host } from '../support/host.ts';

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
    const fork = agentCommand({ preset: 'pi', prompt, fork: true }, { pi: { ...capture, args: [...capture.args, '--'] } }, '/tmp/a session\'s.jsonl');
    const forked = await jobs.start({ ...owner, cwd, command: fork }, testShell());
    const result = await settled(jobs, forked.id);
    assert.deepEqual(JSON.parse(readFileSync(jobs.logPath(result, 'stdout'), 'utf8')), ['--fork', '/tmp/a session\'s.jsonl', '--', prompt]);
    assert.throws(() => agentCommand({ preset: 'pi', prompt, fork: true }, { pi: capture }), /unpersisted/);
    assert.throws(() => agentCommand({ preset: 'test', prompt, fork: true }, { test: capture }), /only by the pi/);
    assert.throws(() => agentCommand({ preset: 'constructor', prompt }, { test: capture }), /Unknown CLI agent/);
  } finally { await jobs.shutdown(Date.now() + 5000); }
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
