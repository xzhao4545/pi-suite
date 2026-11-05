import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir, manager as jobManager, testShell } from '../support/jobs.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { executeAgent } from '../../src/agents/runner.ts';
import { childSuite } from '../../src/agents/child.ts';
import type { Execution } from '../../src/agents/types.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { ToolError } from '../../src/runtime/errors.ts';
import type { StopOutcome } from '../../src/runtime/tools.ts';
import { TaskStore } from '../../src/tasks/store.ts';

async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext;
  const h = await host({root, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const config = loadConfig(root, root); config.agents.persistSessions = false;
  return {...h, root, ctx, config, async cleanup() { await h.dispose(); rmSync(root, {recursive: true, force: true}); }};
}
function result(run: Execution, text: string): void {
  run.sessionManager = SessionManager.inMemory(run.record.cwd);
  run.sessionManager.appendMessage(fauxAssistantMessage(text));
  run.entries = run.sessionManager.getBranch(); run.record.result = text;
}

test('queued stop publishes one operation before synchronous abort, event and change observers', async () => {
  const h = await setup(), blocked = Promise.withResolvers<void>(), cleanup = Promise.withResolvers<void>();
  const executions: string[] = []; let queuedId = '', cleanups = 0;
  const manager = new AgentManager(async run => {
    executions.push(run.record.prompt); await blocked.promise; result(run, 'blocker result');
  }, async roots => { if (roots.includes(queuedId)) { cleanups++; await cleanup.promise; } return []; });
  try {
    h.config.agents.maxConcurrent = 1;
    mkdirSync(join(h.root, 'agents'));
    writeFileSync(join(h.root, 'agents', 'parent.md'), '---\nname: parent\nallowed_subagents: all\n---\nDelegate.');
    const blocker = await manager.start({prompt: 'blocker', type: 'parent'}, {ctx: h.ctx}, h.config);
    const queued = await manager.start({prompt: 'queued'}, {ctx: h.ctx}, h.config);
    queuedId = queued.record.runId; assert.equal(queued.record.state, 'queued');
    let abortJoin: Promise<StopOutcome> | undefined, eventJoin: Promise<StopOutcome> | undefined;
    let changeJoin: Promise<StopOutcome> | undefined, cancellationEvents = 0;
    queued.controller.signal.addEventListener('abort', () => {
      assert.equal(queued.record.state, 'stopped'); assert.equal(queued.settled, true);
      abortJoin = manager.stop(queued.record.id, queuedId);
    }, {once: true});
    manager.subscribeEvents((kind, run) => {
      if (kind === 'failed' && run === queued) { cancellationEvents++; eventJoin = manager.stop(run.record.id, queuedId); }
    });
    manager.subscribe(() => {
      if (!changeJoin && queued.record.state === 'stopped') changeJoin = manager.stop(queued.record.id, queuedId);
    });
    const stopped = manager.stop(queued.record.id, queuedId);
    assert.strictEqual(abortJoin, stopped); assert.strictEqual(eventJoin, stopped); assert.strictEqual(changeJoin, stopped);
    assert.equal(cancellationEvents, 1); assert.equal((await queued.done.promise).state, 'stopped');
    cleanup.resolve(); assert.equal((await stopped).state, 'stopped'); assert.equal(cleanups, 1);
    assert.equal(manager.get(queued.record.id).record.state, 'stopped');
    // Nested starts normally bypass the pool, but onSpawned runs while they are still queued.
    // A parent's abort can synchronously reconfigure/drain before stop reaches that child.
    blocker.controller.signal.addEventListener('abort', () => manager.configure(h.config), {once: true});
    let parentStop: Promise<StopOutcome> | undefined;
    const nested = await manager.start({prompt: 'nested'}, {ctx: h.ctx, run: blocker}, h.config, undefined, {
      onSpawned: () => { parentStop = manager.stop(blocker.record.id); },
    });
    assert.equal((await nested.done.promise).state, 'stopped');
    blocked.resolve(); await blocker.done.promise; await parentStop;
    assert.deepEqual(executions, ['blocker'], 'cancelled queued runs never start when callbacks drain the pool');
  } finally { blocked.resolve(); cleanup.resolve(); await manager.shutdown(); await h.cleanup(); }
});

test('pending cleanup closes resume admission after task I/O and old-run stop preserves a new execution', async () => {
  const h = await setup(), cleanup = Promise.withResolvers<void>(), next = Promise.withResolvers<void>();
  const admission = Promise.withResolvers<void>(), admissionEntered = Promise.withResolvers<void>();
  const sweepCleanup = Promise.withResolvers<void>(), scopes: string[][] = [], tasks = new TaskStore();
  let sweeping = false, releaseOld: (() => void) | undefined;
  const manager = new AgentManager(async run => {
    if (run.record.prompt === 'second') await next.promise;
    result(run, `${run.record.prompt} result`);
  }, async roots => { scopes.push(roots); await (sweeping ? sweepCleanup.promise : cleanup.promise); return []; });
  try {
    await tasks.edit([{op: 'add', title: 'group', children: ['execution']}]);
    const scope = {ctx: h.ctx, taskStore: tasks};
    const first = await manager.start({prompt: 'first', background: false, taskId: '2'}, scope, h.config);
    const finished = await first.done.promise; assert.equal(finished.state, 'completed');
    const snapshot = tasks.snapshot.bind(tasks);
    tasks.snapshot = async () => { admissionEntered.resolve(); await admission.promise; return snapshot(); };
    const resume = manager.start({prompt: 'second', background: false, taskId: '2'}, scope, h.config, finished);
    const rejected = assert.rejects(resume, /still stopping or cleaning up/);
    await admissionEntered.promise;
    const stopping = manager.stop(finished.id); admission.resolve(); await rejected;
    await assert.rejects(manager.send(finished.id, 'second', scope, h.config), /still stopping or cleaning up/);
    cleanup.resolve(); assert.equal((await stopping).state, 'completed');
    assert.equal(manager.get(finished.id, finished.runId).record.result, 'first result');
    const resumed = await manager.send(finished.id, 'second', scope, h.config);
    assert.notEqual(resumed.run.record.runId, finished.runId);
    const oldStop = await manager.stop(finished.id, finished.runId);
    assert.equal(oldStop.state, 'completed'); assert.deepEqual(scopes.at(-1), [finished.runId]);
    assert.equal(resumed.run.controller.signal.aborted, false); assert.equal(resumed.run.record.state, 'starting');
    assert.ok(!oldStop.affected.some(item => item.id === resumed.run.record.id && item.state === 'stopping'));
    next.resolve(); assert.equal((await resumed.run.done.promise).result, 'second result');
    assert.equal(manager.get(finished.id, finished.runId).record.state, 'completed');
    sweeping = true; releaseOld = manager.retain(finished.runId);
    const allStop = manager.stop(finished.id);
    manager.sweep(Date.now() + 10 * 60_000 + 1);
    assert.equal(manager.get(finished.id, resumed.run.record.runId).run, undefined);
    assert.strictEqual(manager.stop(finished.id), allStop, 'moving the newer run into history must not change the stop scope key');
    sweepCleanup.resolve(); await allStop;
  } finally { releaseOld?.(); admission.resolve(); cleanup.resolve(); sweepCleanup.resolve(); next.resolve(); await manager.shutdown(); await h.cleanup(); }
});

test('cascade cleanup joins descendant finalization, isolates jobs and prevents late process launch', {timeout: 15000}, async () => {
  const h = await setup(), parentGate = Promise.withResolvers<void>(), authorized = Promise.withResolvers<void>();
  const authorizationEntered = Promise.withResolvers<void>(), jobs = jobManager(h.root), shell = testShell();
  const naturalParentGate = Promise.withResolvers<void>(), finalization = Promise.withResolvers<void>();
  const childFinalizing = Promise.withResolvers<void>();
  const failingParentGate = Promise.withResolvers<void>(), siblingGate = Promise.withResolvers<void>();
  const lastFinalization = Promise.withResolvers<void>(), lastChildFinalizing = Promise.withResolvers<void>();
  const parentTerminating = Promise.withResolvers<void>();
  let natural: AgentManager | undefined, failing: AgentManager | undefined;
  let childJobId = '';
  const owner = {cwd: h.root, ownerSessionId: h.ctx.sessionManager.getSessionId(), anchorEntryId: null};
  const manager = new AgentManager(async run => {
    if (run.record.prompt === 'parent') await parentGate.promise;
    else {
      const job = await jobs.start({...owner, command: 'read line', creator: {
        agentId: run.record.id, runId: run.record.runId, ancestors: run.record.ancestors,
      }}, shell);
      childJobId = job.id;
    }
    result(run, `${run.record.prompt} result`);
  }, async roots => (await jobs.stopCreatedBy(roots)).map(({job}) => ({id: job.id, state: job.state, cleanup: job.cleanup.state})));
  let late: Promise<ToolError> | undefined;
  try {
    mkdirSync(join(h.root, 'agents'));
    writeFileSync(join(h.root, 'agents', 'parent.md'), '---\nname: parent\nallowed_subagents: all\n---\nDelegate.');
    const parent = await manager.start({prompt: 'parent', type: 'parent', background: false}, {ctx: h.ctx}, h.config);
    const child = await manager.start({prompt: 'child', background: false}, {ctx: h.ctx, run: parent}, h.config);
    const childDone = await child.done.promise; assert.equal(childDone.state, 'completed');
    manager.sweep(Date.now() + 10 * 60_000 + 1);
    assert.equal(manager.get(child.record.id).run, undefined);
    const sibling = await jobs.start({...owner, command: 'read sibling'}, shell);
    late = jobs.start({...owner, command: 'echo late; read line', creator: {
      agentId: child.record.id, runId: child.record.runId, ancestors: child.record.ancestors,
    }}, shell, undefined, async () => { authorizationEntered.resolve(); await authorized.promise; }).then(
      () => assert.fail('a closed creator must not launch a process'),
      (error: unknown) => { assert.ok(error instanceof ToolError); assert.equal(error.code, 'START_NOT_COMMITTED'); return error; },
    );
    await authorizationEntered.promise;
    const stopping = manager.stop(parent.record.id);
    parentGate.resolve(); const stopped = await stopping;
    assert.equal(stopped.cleanup, 'confirmed');
    assert.ok(stopped.affected.some(item => item.id === childJobId && item.state === 'stopped'));
    assert.equal(jobs.peek(childJobId).cleanup.rootExited, true);
    assert.equal(jobs.peek(sibling.id).state, 'running');
    assert.equal(manager.get(child.record.id).record.state, 'completed');
    authorized.resolve(); const error = await late; assert.ok(error.objectId);
    const prevented = jobs.peek(error.objectId);
    assert.equal(prevented.state, 'stopped'); assert.equal(prevented.stopReason, 'agent');
    assert.equal(prevented.startedAt, undefined); assert.equal(prevented.cleanup.state, 'not_required');

    let naturalJobId = '';
    h.faux.setResponses([fauxAssistantMessage('natural child result')]);
    natural = new AgentManager(async run => {
      if (run.record.prompt === 'natural parent') { await naturalParentGate.promise; result(run, 'natural parent result'); return; }
      naturalJobId = (await jobs.start({...owner, command: 'read natural', creator: {
        agentId: run.record.id, runId: run.record.runId, ancestors: run.record.ancestors,
      }}, shell)).id;
      await executeAgent(run, pi => {
        childSuite(pi, run, natural!);
        pi.on('session_shutdown', async () => { childFinalizing.resolve(); await finalization.promise; });
      }, natural!.changed, (kind, details) => natural!.event(kind, run, details));
    }, async roots => (await jobs.stopCreatedBy(roots)).map(({job}) => ({id: job.id, state: job.state, cleanup: job.cleanup.state})));
    const naturalParent = await natural.start({prompt: 'natural parent', type: 'parent', background: false}, {ctx: h.ctx}, h.config);
    const naturalChild = await natural.start({prompt: 'natural child', background: false}, {ctx: h.ctx, run: naturalParent}, h.config);
    await childFinalizing.promise;
    assert.equal(naturalChild.record.state, 'completed'); assert.notEqual(naturalChild.settled, true);
    let parentSettled = false; void naturalParent.done.promise.then(() => { parentSettled = true; });
    naturalParentGate.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(parentSettled, false, 'parent completion joins the real child session shutdown');
    assert.equal(jobs.peek(naturalJobId).state, 'running', 'joining natural finalization does not stop its leftover job');
    finalization.resolve();
    assert.equal((await naturalParent.done.promise).state, 'completed');
    assert.equal((await naturalChild.done.promise).state, 'completed');
    assert.equal(jobs.peek(naturalJobId).state, 'running');

    let failureId = '', parentId = '', parentJobId = '', parentCleanupAttempted = false;
    h.faux.setResponses([fauxAssistantMessage('last child result')]);
    failing = new AgentManager(async run => {
      if (run.record.prompt === 'failing parent') {
        parentJobId = (await jobs.start({...owner, command: 'read parent', creator: {
          agentId: run.record.id, runId: run.record.runId, ancestors: run.record.ancestors,
        }}, shell)).id;
        await failingParentGate.promise; run.terminated = true; result(run, 'parent partial result');
        parentTerminating.resolve(); return;
      }
      if (run.record.prompt === 'cleanup failure') {
        run.controller.signal.addEventListener('abort', () => siblingGate.resolve(), {once: true});
        await siblingGate.promise; result(run, 'sibling partial result'); return;
      }
      await executeAgent(run, pi => {
        childSuite(pi, run, failing!);
        pi.on('session_shutdown', async () => { lastChildFinalizing.resolve(); await lastFinalization.promise; });
      }, failing!.changed, (kind, details) => failing!.event(kind, run, details));
    }, async roots => {
      if (roots.includes(failureId)) throw new Error('sibling job cleanup failure');
      if (roots.includes(parentId)) parentCleanupAttempted = true;
      return (await jobs.stopCreatedBy(roots)).map(({job}) => ({id: job.id, state: job.state, cleanup: job.cleanup.state}));
    });
    const failingParent = await failing.start({prompt: 'failing parent', type: 'parent', background: false}, {ctx: h.ctx}, h.config);
    parentId = failingParent.record.runId;
    const lastChild = await failing.start({prompt: 'last child', background: false}, {ctx: h.ctx, run: failingParent}, h.config);
    const failedSibling = await failing.start({prompt: 'cleanup failure', background: false}, {ctx: h.ctx, run: failingParent}, h.config);
    failureId = failedSibling.record.runId;
    await lastChildFinalizing.promise;
    let failedParentSettled = false; void failingParent.done.promise.then(() => { failedParentSettled = true; });
    failingParentGate.resolve(); await parentTerminating.promise; await new Promise(resolve => setImmediate(resolve));
    assert.equal(parentCleanupAttempted, true, 'child cleanup failure must not skip the terminated parent job');
    assert.equal(failedParentSettled, false, 'a rejected sibling stop must still join every child session finalization');
    lastFinalization.resolve(); const failure = await failingParent.done.promise;
    assert.equal(failure.state, 'failed'); assert.match(failure.error!, /sibling job cleanup failure/);
    assert.equal((await lastChild.done.promise).state, 'completed');
    assert.equal(jobs.peek(parentJobId).state, 'stopped'); assert.equal(jobs.peek(parentJobId).cleanup.rootExited, true);
  } finally {
    parentGate.resolve(); authorized.resolve(); naturalParentGate.resolve(); finalization.resolve();
    failingParentGate.resolve(); siblingGate.resolve(); lastFinalization.resolve(); await late;
    await failing?.shutdown(); await natural?.shutdown(); await manager.shutdown(); await jobs.shutdown(Date.now() + 5000); await h.cleanup();
  }
});
