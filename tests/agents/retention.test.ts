import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { transcript } from '../../src/agents/records.ts';

test('sweep preserves active execution, unread results and readers while retaining memory-only history and ancestry', async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>();
  let ctx!: ExtensionContext;
  const h = await host({root, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const manager = new AgentManager(async run => {
    if (run.record.prompt === 'active') await gate.promise;
    run.sessionManager = SessionManager.inMemory(root);
    run.sessionManager.appendMessage(fauxAssistantMessage('retained result'));
    run.entries = run.sessionManager.getBranch(); run.record.result = 'retained result';
  }, async () => []);
  const config = loadConfig(root, root); config.agents.persistSessions = false;
  try {
    mkdirSync(join(root, 'agents'));
    writeFileSync(join(root, 'agents', 'parent.md'), '---\nname: parent\nallowed_subagents: all\n---\nDelegate.');
    const running = await manager.start({prompt: 'active', type: 'parent'}, {ctx}, config, undefined, {workflowId: 'wf_retention'});
    const nested = await manager.start({prompt: 'nested'}, {ctx, run: running}, config);
    assert.equal(nested.record.workflowId, running.record.workflowId);
    const unread = await manager.start({prompt: 'unread'}, {ctx}, config);
    const reading = await manager.start({prompt: 'reader', background: false}, {ctx}, config);
    await Promise.all([unread.done.promise, reading.done.promise, nested.done.promise]);
    const releaseReader = manager.retain(reading.record.runId), releaseEditor = manager.retain(reading.record.runId);
    const expired = Date.now() + 10 * 60_000 + 1;
    manager.sweep(expired);
    for (const run of [running, unread, reading, nested]) assert.strictEqual(manager.get(run.record.id).run, run);
    releaseEditor(); manager.sweep(expired);
    assert.ok(transcript(reading.record, manager.get(reading.record.id).run).length);
    releaseReader(); unread.consumed = true; manager.sweep(expired);
    for (const run of [unread, reading]) {
      const found = manager.get(run.record.id);
      assert.equal(found.run, undefined); assert.equal(found.record.result, 'retained result');
      assert.equal(found.record.handle, run.record.handle);
      assert.throws(() => transcript(found.record), /no saved transcript/);
      await assert.rejects(manager.send(run.record.id, 'resume', {ctx}, config), /no saved transcript/);
    }
    // A settled nested parent's notice receiver is closed, so its children do not leak.
    gate.resolve(); await running.done.promise; running.consumed = true; manager.sweep(expired + 1000);
    assert.equal(manager.runs.size, 0);
    assert.deepEqual(manager.get(nested.record.id).record.ancestors, [running.record.runId]);
    await assert.rejects(manager.start({prompt: 'late child'}, {ctx, run: running}, config), /no longer admits children/);
  } finally { gate.resolve(); await manager.shutdown(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('failed job cleanup still joins child settlement and a later stop retries cleanup', async () => {
  const root = agentDir(), gate = Promise.withResolvers<void>();
  let ctx!: ExtensionContext, fail = true;
  const h = await host({root, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const manager = new AgentManager(async () => gate.promise, async () => {
    if (fail) { fail = false; throw new Error('job cleanup unavailable'); }
    return [];
  });
  try {
    const run = await manager.start({prompt: 'wait'}, {ctx}, loadConfig(root, root));
    let returned = false;
    const stopped = manager.stop(run.record.id).then(() => { returned = true; }, error => {
      returned = true; assert.match(error.message, /job cleanup unavailable/);
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false, 'cleanup rejection must not report child settlement early');
    gate.resolve(); await stopped;
    assert.equal(run.settled, true);
    assert.equal((await manager.stop(run.record.id)).cleanup, 'confirmed');
  } finally { gate.resolve(); await manager.shutdown(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});
