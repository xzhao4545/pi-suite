import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { acquireRuntime, PROTOCOL_VERSION } from '../../src/jobs/runtime.ts';
import type { JobManager } from '../../src/jobs/manager.ts';
import type { ControlBridge } from '../../src/jobs/control.ts';
import { resolveWorkspace } from '../../src/jobs/workspace.ts';
import { agentDir, owner, settled, testShell } from '../support/jobs.ts';
import { host } from '../support/host.ts';

const key = Symbol.for('pi-suite.jobs.runtime');
const globals = globalThis as unknown as Record<symbol, {
  protocolVersion: number; agentDir: string; manager: JobManager; control?: ControlBridge; exitListener: () => void;
}>;
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, 'runtime did not become idle'); await sleep(25); }
}

test('incompatible reload preserves query, stop and quit through the owner bridge; idle reload replaces it', { timeout: 30000 }, async () => {
  const root = agentDir();
  const h = await host({ root, tools: ['job_start', 'job_list', 'job_read', 'job_write', 'job_stop', 'wait'] });
  const active = acquireRuntime(root); assert.equal(active.mode, 'active');
  if (active.mode !== 'active') throw new Error('runtime unavailable');
  const jobs = active.manager;
  const request = { ...owner, ownerSessionId: h.session.sessionManager.getSessionId(), cwd: root };
  const first = await jobs.start({ ...request, command: 'echo bridge-output; read line' }, testShell());
  const second = await jobs.start({ ...request, command: 'sleep 30' }, testShell());
  const registration = globals[key];
  // Simulate the execution protocol changing between extension imports. The bridge stays
  // with its original owner, exactly as it does in the real process-global reload slot.
  registration.protocolVersion = PROTOCOL_VERSION - 1;
  const call = async (name: string, params: Parameters<typeof fauxToolCall>[1]) => {
    let result = '';
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall(name, params)),
      context => { result = JSON.stringify(context.messages.at(-1)); return fauxAssistantMessage('observed'); },
    ]);
    await h.session.prompt(`Call ${name}`); await h.idle(); return result;
  };
  let replacement: JobManager | undefined;
  try {
    await until(() => readFileSync(jobs.logPath(first, 'stdout'), 'utf8').includes('bridge-output'));
    await h.session.reload();
    assert.equal(globals[key], registration, 'occupied registration is never replaced');
    const restricted = acquireRuntime(root); assert.equal(restricted.mode, 'restricted');
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 2');
    assert.match(await call('job_list', { id: first.id }), /bridge-output/);
    assert.match(await call('job_read', { id: first.id }), /bridge-output/);
    assert.match(await call('job_start', { command: 'echo forbidden' }), /RUNTIME_UNAVAILABLE/);
    assert.match(await call('job_write', { id: first.id, input: 'forbidden', submit: true }), /RUNTIME_UNAVAILABLE/);
    assert.match(await call('job_stop', { id: first.id }), /managed_scope_confirmed/);
    assert.equal(jobs.peek(first.id).state, 'stopped');
    assert.equal(jobs.peek(second.id).state, 'running');
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 1');
    assert.match(await call('wait', { ids: [first.id] }), /stopped/);
    await h.dispose();
    assert.equal(jobs.peek(second.id).stopReason, 'quit');
    assert.equal(jobs.peek(second.id).cleanup.state, 'managed_scope_confirmed');
    await until(() => !jobs.hasOccupancy());
    const upgraded = acquireRuntime(root); assert.equal(upgraded.mode, 'active');
    if (upgraded.mode !== 'active') throw new Error('idle runtime not upgraded');
    replacement = upgraded.manager;
    assert.notEqual(replacement, jobs);
    assert.equal(globals[key].protocolVersion, PROTOCOL_VERSION);
    assert.ok(!process.listeners('exit').includes(registration.exitListener));
    const history = await replacement.get(first.id, await resolveWorkspace(root));
    assert.equal(history.live, false); assert.equal(history.job.state, 'stopped');
    assert.throws(() => replacement!.stop(first.id), /not controlled by this Pi process/);
  } finally {
    await h.dispose(); await replacement?.shutdown(Date.now() + 5000);
  }
});

test('foreign directories and unknown occupied registrations stay unavailable without losing exit cleanup', { timeout: 20000 }, async () => {
  const root = agentDir(), active = acquireRuntime(root);
  if (active.mode !== 'active') throw new Error('runtime unavailable');
  const jobs = active.manager;
  const job = await jobs.start({ ...owner, cwd: root, command: 'sleep 30' }, testShell());
  const registration = globals[key], bridge = registration.control;
  try {
    assert.equal(acquireRuntime(agentDir()).mode, 'unavailable');
    assert.equal(globals[key], registration);
    registration.protocolVersion = PROTOCOL_VERSION - 1; delete registration.control;
    assert.equal(acquireRuntime(root).mode, 'unavailable');
    assert.equal(jobs.peek(job.id).state, 'running');
    assert.ok(process.listeners('exit').includes(registration.exitListener));
  } finally { registration.control = bridge; await jobs.shutdown(Date.now() + 5000); }
  assert.equal((await settled(jobs, job.id)).state, 'stopped');
});
