import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { acquireRuntime, PROTOCOL_VERSION, quitExistingRuntime } from '../../src/jobs/runtime.ts';
import type { JobManager } from '../../src/jobs/manager.ts';
import type { ControlBridge } from '../../src/jobs/control.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { JobsModule } from '../../src/jobs/index.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { Dock } from '../../src/ui/dock.ts';
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
function moduleFor(pi: ExtensionAPI): JobsModule {
  const binding = new SessionBinding();
  return new JobsModule(pi, binding, new Notifications(pi, binding), new StatusPublisher(new Dock()));
}

test('incompatible reload preserves query, stop and quit through the owner bridge; idle reload replaces it', { timeout: 30000 }, async () => {
  const root = agentDir();
  let view!: JobsModule;
  const h = await host({ root, tools: ['job_start', 'job_list', 'job_read', 'job_write', 'job_stop', 'wait'], extend: pi => { view = moduleFor(pi); } });
  const active = acquireRuntime(root); assert.equal(active.mode, 'active');
  if (active.mode !== 'active') throw new Error('runtime unavailable');
  const jobs = active.manager;
  const request = { ...owner, ownerSessionId: h.session.sessionManager.getSessionId(), cwd: root };
  const first = await jobs.start({ ...request, command: 'echo bridge-output; read line',
    creator: {agentId: 'agent_bridge', runId: 'run_bridge', ancestors: []} }, testShell());
  const second = await jobs.start({ ...request, command: 'sleep 30' }, testShell());
  const target = join(root, 'target'); mkdirSync(target);
  const descendant = await jobs.start({ ...request, cwd: target, ownerSessionId: 'another-session', anchorEntryId: 'another-branch',
    command: 'read descendant', creator: {agentId: 'agent_descendant', runId: 'run_descendant', ancestors: ['run_bridge']} }, testShell());
  const owned = jobs.createdBy(['run_bridge']);
  assert.deepEqual(owned.map(job => job.id), [first.id, descendant.id]);
  assert.equal(owned[1].cwd, target); assert.equal(owned[1].ownerSessionId, 'another-session');
  owned[0].name = 'mutated copy'; owned[0].creator!.ancestors.push('mutated');
  assert.notEqual(jobs.peek(first.id).name, 'mutated copy'); assert.deepEqual(jobs.peek(first.id).creator!.ancestors, []);
  assert.deepEqual(jobs.createdBy(['run_descendant']).map(job => job.id), [descendant.id]);
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
    assert.deepEqual(view.createdBy(['run_bridge']).map(job => job.id), [first.id, descendant.id]);
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 2');
    assert.match(await call('job_list', { id: first.id }), /bridge-output/);
    assert.match(await call('job_read', { id: first.id }), /bridge-output/);
    assert.match(await call('job_start', { command: 'echo forbidden' }), /RUNTIME_UNAVAILABLE/);
    assert.match(await call('job_write', { id: first.id, input: 'forbidden', submit: true }), /RUNTIME_UNAVAILABLE/);
    assert.match(await call('job_stop', { id: first.id }), /managed_scope_confirmed/);
    assert.equal(jobs.peek(first.id).state, 'stopped');
    assert.deepEqual(view.createdBy(['run_bridge']).map(job => job.id), [first.id, descendant.id], 'settled jobs stay in the full creation scope');
    assert.equal(jobs.peek(second.id).state, 'running');
    assert.equal(h.statuses.get('pi-suite:runtime'), 'jobs 1');
    assert.match(await call('wait', { ids: [first.id] }), /stopped/);
    await h.dispose();
    assert.equal(jobs.peek(second.id).stopReason, 'quit');
    assert.equal(jobs.peek(descendant.id).stopReason, 'quit');
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
  const legacyQuit = await jobs.start({ ...owner, cwd: root, command: 'read legacy' }, testShell());
  const registration = globals[key], bridge = registration.control;
  let h: Awaited<ReturnType<typeof host>> | undefined;
  try {
    assert.ok(bridge?.version === 3);
    const {createdBy: _createdBy, sessionJobs: _sessionJobs, ...legacyJobs} = bridge.jobs;
    registration.protocolVersion = PROTOCOL_VERSION - 1;
    registration.control = {version: 1, jobs: legacyJobs, quit: () => bridge.quit()};
    let view!: JobsModule;
    h = await host({root, extend: pi => { view = moduleFor(pi); }});
    assert.equal(acquireRuntime(root).mode, 'restricted');
    assert.throws(() => view.createdBy(['run_bridge']), /RUNTIME_UNAVAILABLE.*control bridge v1/);
    assert.equal(view.control().peek(job.id).state, 'running');
    assert.ok((await view.control().list(await resolveWorkspace(root))).jobs.some(row => row.job.id === job.id));
    await view.control().stop(job.id); assert.equal(jobs.peek(job.id).state, 'stopped');
    assert.equal(jobs.peek(legacyQuit.id).state, 'running');
    assert.equal(acquireRuntime(agentDir()).mode, 'unavailable');
    assert.equal(globals[key], registration);
    registration.protocolVersion = PROTOCOL_VERSION - 1; delete registration.control;
    assert.equal(acquireRuntime(root).mode, 'unavailable');
    assert.equal(quitExistingRuntime(root), undefined);
    assert.equal(jobs.peek(legacyQuit.id).state, 'running');
    assert.ok(process.listeners('exit').includes(registration.exitListener));
    registration.control = bridge;
    await h.dispose(); assert.equal(jobs.peek(legacyQuit.id).stopReason, 'quit');
    assert.equal(jobs.peek(legacyQuit.id).cleanup.state, 'managed_scope_confirmed');
  } finally { registration.control = bridge; await h?.dispose(); await jobs.shutdown(Date.now() + 5000); }
  assert.equal((await settled(jobs, job.id)).state, 'stopped');
});
