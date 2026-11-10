import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentSessionRuntime, SessionManager, createAgentSessionFromServices, type ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { host, goalId } from '../support/host.ts';
import { taskPath } from '../../src/tasks/index.ts';
import { taskStore } from '../../src/tasks/store.ts';
import { restoreGoal } from '../../src/goal/state.ts';

async function forkHost(persisted: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-clean-fork-'));
  let ui!: ExtensionUIContext, cancel = false, change = false;
  const h = await host({ root, persisted, ui: value => { ui = value; return value; }, extend: pi => {
    pi.on('session_before_fork', () => { if (change) pi.appendEntry('race', {}); return { cancel }; });
  } });
  const errors: string[] = [];
  const runtime = new AgentSessionRuntime(h.session, h.services, async options => {
    await h.services.resourceLoader.reload();
    const result = await createAgentSessionFromServices({ services: h.services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...result, services: h.services, diagnostics: [] };
  });
  const bind = async () => {
    runtime.session.extensionRunner.onError(error => errors.push(error.error));
    await runtime.session.bindExtensions({ mode: 'tui', uiContext: ui, commandContextActions: {
      waitForIdle: () => runtime.session.waitForIdle(), newSession: options => runtime.newSession(options),
      fork: (id, options) => runtime.fork(id, options), switchSession: (path, options) => runtime.switchSession(path, options),
      navigateTree: (id, options) => runtime.session.navigateTree(id, options), reload: () => runtime.session.reload(),
    } });
  };
  runtime.setRebindSession(bind); await bind();
  return { h, runtime, errors, root, setCancel: (value: boolean) => { cancel = value; }, setChange: (value: boolean) => { change = value; },
    async dispose() { await runtime.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test('registered /responses fork copies the leaf before binding, inherits live config, pauses goal and independently seeds durable/memory tasks', { timeout: 20000 }, async () => {
  for (const persisted of [true, false]) {
    const fixture = await forkHost(persisted), { h, runtime, root } = fixture;
    try {
      h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall('goal_wait', { goalId: goalId(context), reason: 'waiting for external event' }))]);
      await runtime.session.prompt('/goal preserve original ownership'); await runtime.session.waitForIdle();
      const original = runtime.session.sessionManager, originalId = original.getSessionId(), originalPath = original.getSessionFile();
      const path = persisted ? taskPath(root, originalId) : `memory:${root}:${originalId}`;
      const sourceTasks = taskStore(path, persisted ? path : undefined);
      await sourceTasks.edit([{ op: 'add', title: 'original tasks', children: ['child'] }]);
      const old = { ...fauxAssistantMessage('history'), api: 'openai-responses' as const, responseId: 'resp_old', content: [
        { type: 'thinking' as const, thinking: '', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_old', encrypted_content: 'cipher_old', summary: [] }) },
        { type: 'text' as const, text: 'latest leaf with business id', textSignature: 'msg_old' },
      ] };
      original.appendMessage(old);
      runtime.session.refreshContext();
      const config = runtime.session.model!, thinking = runtime.session.thinkingLevel, oldEntries = structuredClone(original.getEntries());
      const beforeBytes = originalPath ? readFileSync(originalPath, 'utf8') : undefined;
      const previousCalls = h.faux.state.callCount;
      await runtime.session.prompt('/responses fork');
      const copy = runtime.session.sessionManager;
      assert.equal(fixture.errors.length, 0, fixture.errors.join('\n'));
      assert.notEqual(copy.getSessionId(), originalId);
      assert.equal(copy.getHeader()?.parentSessionId, originalId);
      assert.equal(copy.getCwd(), root); assert.equal(copy.getSessionDir(), original.getSessionDir());
      assert.equal(copy.isPersisted(), persisted);
      assert.equal(runtime.session.model?.provider, config.provider); assert.equal(runtime.session.model?.id, config.id);
      assert.equal(runtime.session.thinkingLevel, thinking);
      assert.equal(h.faux.state.callCount, previousCalls, 'command and goal restore do not request a response');
      assert.equal(runtime.session.isIdle, true);
      assert.equal(restoreGoal(runtime.session.extensionRunner.createContext())?.status, 'paused');
      assert.equal(restoreGoal(runtime.session.extensionRunner.createContext())?.automatic, false);
      assert.equal(JSON.stringify(original.getEntries().slice(0, oldEntries.length)), JSON.stringify(oldEntries), 'shutdown may append state but never rewrites source history');
      if (beforeBytes) assert.ok(readFileSync(originalPath!, 'utf8').startsWith(beforeBytes));
      const raw = copy.getSessionFile() ? readFileSync(copy.getSessionFile()!, 'utf8') : JSON.stringify(copy.getEntries());
      assert.ok(raw.includes('latest leaf with business id'));
      for (const privateValue of ['cipher_old', 'resp_old', 'msg_old', 'rs_old']) assert.ok(!raw.includes(privateValue), privateValue);
      const newPath = persisted ? taskPath(root, copy.getSessionId()) : `memory:${root}:${copy.getSessionId()}`;
      const copiedTasks = taskStore(newPath, persisted ? newPath : undefined);
      assert.equal((await copiedTasks.snapshot()).tasks[1]?.id, '1.1');
      await copiedTasks.edit([{ op: 'done', id: '1.1' }]);
      assert.equal((await sourceTasks.snapshot()).tasks[1].status, 'todo');
      assert.ok(h.notices.some(notice => notice.text.includes('waiting for your next message')));
      if (persisted) {
        const cleanPath = copy.getSessionFile()!;
        await runtime.switchSession(originalPath!);
        assert.ok(JSON.stringify(runtime.session.sessionManager.getEntries()).includes('cipher_old'));
        assert.equal(restoreGoal(runtime.session.extensionRunner.createContext())?.waiting, 'jobs');
        await runtime.switchSession(cleanPath);
        assert.ok(!JSON.stringify(runtime.session.sessionManager.getEntries()).includes('cipher_old'));
        assert.equal(restoreGoal(runtime.session.extensionRunner.createContext())?.status, 'paused');
        await runtime.session.reload();
        assert.ok(!JSON.stringify(runtime.session.sessionManager.getEntries()).includes('cipher_old'));
        assert.equal(h.faux.state.callCount, previousCalls);
      }
      await copiedTasks.edit([{ op: 'delete', id: '1', cascade: true }]);
      await runtime.session.prompt('/responses fork');
      const emptyId = runtime.session.sessionManager.getSessionId();
      const emptyPath = persisted ? taskPath(root, emptyId) : `memory:${root}:${emptyId}`;
      const emptyCopy = await taskStore(emptyPath, persisted ? emptyPath : undefined).snapshot();
      assert.equal(emptyCopy.tasks.length, 0); assert.equal(emptyCopy.nextId, 2, 'fork keeps counters even after every task was deleted');
      assert.equal(h.faux.state.callCount, previousCalls);
    } finally { await fixture.dispose(); }
  }
});

test('command rejects empty/busy/unsupported history and honors cancellation/source changes before writes', { timeout: 15000 }, async () => {
  const fixture = await forkHost(true), { h, runtime } = fixture;
  try {
    const id = runtime.session.sessionManager.getSessionId();
    await runtime.session.prompt('/responses fork');
    assert.equal(runtime.session.sessionManager.getSessionId(), id);
    assert.ok(h.notices.some(notice => notice.text.includes('history branch')));
    runtime.session.sessionManager.appendMessage({ role: 'user', content: 'local history', timestamp: 1 });
    const branch = runtime.session.sessionManager.getLeafId();
    const command = runtime.session.extensionRunner.getCommand('responses')!, ctx = runtime.session.extensionRunner.createCommandContext();
    await command.handler('fork', { ...ctx, isIdle: () => false });
    await command.handler('fork', { ...ctx, sessionManager: { ...ctx.sessionManager, supportsPreparedFork: undefined } as never });
    assert.ok(h.notices.some(notice => notice.text.includes('lacks prepared fork support')));
    assert.equal(runtime.session.sessionManager.getLeafId(), branch);
    fixture.setCancel(true); await runtime.session.prompt('/responses fork');
    assert.equal(runtime.session.sessionManager.getSessionId(), id);
    assert.ok(h.notices.some(notice => notice.text.includes('cancelled')));
    fixture.setCancel(false); fixture.setChange(true); await runtime.session.prompt('/responses fork');
    assert.equal(runtime.session.sessionManager.getSessionId(), id);
    assert.ok(fixture.errors.some(error => error.includes('Source session changed')));
    fixture.setChange(false);
    runtime.session.sessionManager.appendMessage({ ...fauxAssistantMessage(''), api: 'openai-responses', content: [{ type: 'thinking', thinking: '', thinkingSignature: JSON.stringify({ type: 'compaction', encrypted_content: 'only' }) }] });
    await runtime.session.prompt('/responses fork');
    assert.equal(runtime.session.sessionManager.getSessionId(), id);
    assert.ok(h.notices.some(notice => notice.text.includes('opaque Responses compaction')));
    const opaqueLeaf = runtime.session.sessionManager.getLeafId()!;
    runtime.session.sessionManager.appendContextEdit(opaqueLeaf, null);
    await runtime.session.prompt('/responses fork');
    assert.notEqual(runtime.session.sessionManager.getSessionId(), id, 'history without private fields still creates a normal clean copy');
    assert.ok(JSON.stringify(runtime.session.sessionManager.getBranch()).includes('local history'));
    assert.ok(h.notices.some(notice => notice.text.includes('cleanup (0)')), 'no-fields success reports zero rather than claiming removed provider state');
    assert.equal(h.faux.state.callCount, 0);
  } finally { await fixture.dispose(); }
});
