import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { compileHandsFree, HandsFreeSupervisor, type HandsFreeState, type HandsFreeUpdate } from '../../src/jobs/monitors/hands-free.ts';
import { agentDir, manager, owner, settled, testShell } from '../support/jobs.ts';
import { host, complete, goalId } from '../support/host.ts';

test('hands-free updates: quiet and interval, bounded incremental output, takeover and disposal', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let output: (data: string) => void = () => {};
  const state: HandsFreeState = { config: compileHandsFree({ quietMs: 10, updateIntervalMs: 100, updateMaxChars: 5, maxTotalChars: 8 }, 'pty'), updates: 0, notifiedUpdates: 0, totalCharsSent: 0 };
  const updates: HandsFreeUpdate[] = [];
  const supervisor = new HandsFreeSupervisor({ onData: callback => { output = callback; return () => { output = () => {}; }; } }, state,
    update => updates.push(update), () => assert.fail('ordinary hands-free must not stop on silence'));
  output('123456789'); t.mock.timers.tick(10);
  assert.equal(updates[0].text, '56789'); assert.equal(updates[0].truncated, true);
  t.mock.timers.tick(100); assert.equal(updates.length, 1, 'silence alone does not send the same output again');
  output('abcdef'); t.mock.timers.tick(10);
  assert.equal(updates[1].text, 'def'); assert.equal(updates[1].budgetExhausted, true);
  supervisor.pause(); output('user input echo'); t.mock.timers.tick(100);
  assert.equal(updates.length, 2);
  supervisor.resume(); output('more'); t.mock.timers.tick(10);
  assert.equal(updates[2].text, ''); assert.equal(state.totalCharsSent, 8);
  supervisor.dispose(); t.mock.timers.tick(100); assert.equal(updates.length, 3);

  const interval = { ...state, config: compileHandsFree({ updateMode: 'interval', quietMs: 10, updateIntervalMs: 100 }, 'pty'), updates: 0, totalCharsSent: 0 };
  const periodic = new HandsFreeSupervisor({ onData: callback => { output = callback; return () => {}; } }, interval, update => updates.push(update), () => assert.fail());
  output('continuous'); t.mock.timers.tick(10); assert.equal(updates.length, 3);
  t.mock.timers.tick(90); assert.equal(updates.at(-1)!.text, 'continuous');
  periodic.dispose();
});

test('dispatch: real PTY grace, takeover, quiet stop evidence, timeout and natural exit', { timeout: 30000 }, async () => {
  const jobs = manager(), shell = testShell(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-hf-'));
  try {
    await assert.rejects(jobs.start({ ...owner, cwd, command: 'echo no', handsFree: {} }, shell), /handsFree needs mode pty/);
    const quiet = await jobs.start({ ...owner, cwd, mode: 'pty', command: 'echo ready; cat', handsFree: { mode: 'dispatch', graceMs: 500, quietMs: 100 } }, shell);
    jobs.write(quiet.id, 'user\r', { source: 'user', kind: 'text', text: 'user' });
    await sleep(650);
    assert.equal(jobs.peek(quiet.id).state, 'running', 'user takeover suspends quiet termination past grace');
    jobs.returnControl(quiet.id);
    const stopped = await settled(jobs, quiet.id);
    assert.equal(stopped.state, 'stopped'); assert.equal(stopped.stopReason, 'quiet');
    assert.equal(stopped.completionReason, 'quiet'); assert.equal(stopped.cleanup.state, 'managed_scope_confirmed');
    assert.ok(stopped.elapsedMs! >= 750); assert.equal(stopped.handsFree?.updates, 0);

    const timeout = await jobs.start({ ...owner, cwd, mode: 'pty', command: 'cat', timeoutMs: 200, handsFree: { mode: 'dispatch', quietMs: 100, graceMs: 5000 } }, shell);
    const timedOut = await settled(jobs, timeout.id);
    assert.equal(timedOut.state, 'timed_out'); assert.equal(timedOut.completionReason, 'timeout');
    const natural = await jobs.start({ ...owner, cwd, mode: 'pty', command: 'exit 0', handsFree: { mode: 'dispatch' } }, shell);
    const done = await settled(jobs, natural.id);
    assert.equal(done.state, 'completed'); assert.equal(done.completionReason, 'exited');
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

const lastText = (context: TranscriptContext) => {
  const message = context.messages.findLast(message => message.role === 'toolResult');
  assert.ok(message?.role === 'toolResult');
  return message.content.map(part => part.type === 'text' ? part.text : '').join('\n');
};

test('a hands-free update ends wait on its own job and is consumed without a duplicate wake', { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: ['job_start', 'job_stop', 'wait'] });
  let id = '';
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('job_start', { command: 'sleep 0.3; echo ready; cat', mode: 'pty', handsFree: { quietMs: 100 } })),
      context => { id = /job_[a-f0-9]{8}/.exec(lastText(context))![0]; return fauxAssistantMessage(fauxToolCall('wait', { ids: [id], timeoutMs: 20000 })); },
      context => {
        assert.match(lastText(context), /^wait 0\/1 settled · returned early: a hands-free update arrived/);
        assert.match(lastText(context), /ready/);
        return fauxAssistantMessage(fauxToolCall('job_stop', { id }));
      },
      () => fauxAssistantMessage('done'),
    ]);
    await h.session.prompt('Watch until ready'); await h.idle();
    await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 4);
  } finally { await h.dispose(); }
});

test('hands-free survives reload and wakes a goal waiting on its job once', { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: ['job_start', 'job_stop'] });
  let id = '';
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('job_start', { command: 'sleep 1; echo after-reload; cat', mode: 'pty', handsFree: { quietMs: 100 } })),
      context => { id = /job_[a-f0-9]{8}/.exec(lastText(context))![0]; return fauxAssistantMessage(fauxToolCall('goal_wait', { goalId: goalId(context), reason: 'wait for CLI output', waitFor: [id] })); },
      context => {
        const wake = JSON.stringify(context.messages.findLast(message => message.role === 'user'));
        assert.match(wake, /Hands-free update/); assert.match(wake, /after-reload/);
        return fauxAssistantMessage(fauxToolCall('job_stop', { id }));
      },
      complete,
    ]);
    await h.session.prompt('/goal Wait for supervised output'); await h.idle();
    assert.deepEqual(h.goal()?.waitFor, [id]);
    await h.session.reload();
    const deadline = Date.now() + 15000;
    while (h.goal()?.status !== 'completed' && Date.now() < deadline) { await sleep(25); await h.idle(); }
    assert.equal(h.goal()?.status, 'completed');
    await sleep(300); await h.idle(); assert.equal(h.faux.state.callCount, 4);
  } finally { await h.dispose(); }
});
