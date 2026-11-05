import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, type FauxResponseFactory, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import type { AgentManager } from '../../src/agents/manager.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import type { WaitResult } from '../../src/runtime/wait.ts';

async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext;
  const h = await host({ root, tools: ['agent_start', 'agent_send', 'agent_read', 'agent_list', 'wait'],
    extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  return { ...h, root, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    invoke: (name: string, params: object, signal = new AbortController().signal) => h.session.getToolDefinition(name)!.execute('interaction', params, signal, undefined, ctx as never),
    notices: () => h.session.sessionManager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification'),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
function until(manager: AgentManager, condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Condition not reached')); }, 5000);
    const off = manager.subscribe(() => { if (condition()) { clearTimeout(timer); off(); resolve(); } });
  });
}
function userText(context: TranscriptContext): string {
  const content = context.messages.findLast(message => message.role === 'user')?.content;
  return typeof content === 'string' ? content : content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
}
const output = (value: { content: { type: string; text?: string }[] }) => value.content.filter(item => item.type === 'text').map(item => item.text).join('\n');

test('same-agent unread runs have independent read cancellation and one coalesced notification per execution', { timeout: 15000 }, async () => {
  const h = await setup();
  let entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const fourthEntered = Promise.withResolvers<void>(), fourthRelease = Promise.withResolvers<void>();
  const respond: FauxResponseFactory = async context => {
    const prompt = userText(context);
    if (prompt.includes('HOLD_PARENT')) { entered.resolve(); await release.promise; return fauxAssistantMessage('parent finished'); }
    if (prompt === 'RUN_FOUR') { fourthEntered.resolve(); await fourthRelease.promise; }
    return fauxAssistantMessage(`answer: ${prompt}`);
  };
  h.faux.setResponses(Array(20).fill(respond));
  let parent = h.session.prompt('HOLD_PARENT_ONE'); await entered.promise;
  try {
    const first = await h.manager.start({ prompt: 'RUN_ONE' }, { ctx: h.ctx }, h.config); await first.done.promise;
    const second = (await h.manager.send(first.record.id, 'RUN_TWO', { ctx: h.ctx }, h.config)).run; await second.done.promise;
    await h.invoke('agent_read', { id: second.record.id, runId: second.record.runId });
    assert.equal(first.consumed, false); assert.equal(second.consumed, true);
    release.resolve(); await parent; await h.idle();
    assert.equal(h.notices().length, 1);
    const notice = JSON.stringify(h.notices());
    assert.ok(notice.includes(first.record.runId)); assert.ok(!notice.includes(second.record.runId));
    assert.equal(first.consumed, true);
    h.manager.changed(); await h.idle(); assert.equal(h.notices().length, 1);

    entered = Promise.withResolvers(); release = Promise.withResolvers();
    parent = h.session.prompt('HOLD_PARENT_TWO'); await entered.promise;
    const third = (await h.manager.send(first.record.id, 'RUN_THREE', { ctx: h.ctx }, h.config)).run; await third.done.promise;
    const fourth = (await h.manager.send(first.record.id, 'RUN_FOUR', { ctx: h.ctx }, h.config)).run; await fourthEntered.promise;
    const old = (await h.invoke('wait', { ids: [fourth.record.id], timeoutMs: 5000 })).details as WaitResult;
    assert.equal(old.reason, 'other'); assert.deepEqual(old.pending, [fourth.record.id]);
    assert.equal(old.others[0].runId, third.record.runId); assert.equal(third.consumed, true); assert.equal(fourth.consumed, false);
    const aborted = new AbortController(); aborted.abort(new Error('Already cancelled'));
    await assert.rejects(h.invoke('wait', { ids: [fourth.record.id], timeoutMs: 5000 }, aborted.signal), /Already cancelled/);
    assert.equal(fourth.controller.signal.aborted, false); assert.equal(Boolean(fourth.settled), false);
    fourthRelease.resolve(); await fourth.done.promise;
    const fifth = (await h.manager.send(first.record.id, 'RUN_FIVE', { ctx: h.ctx }, h.config)).run; await fifth.done.promise;
    release.resolve(); await parent; await h.idle();
    assert.equal(h.notices().length, 2, 'two executions pending at one boundary share one message');
    const batch = JSON.stringify(h.notices().at(-1));
    assert.ok(!batch.includes(third.record.runId)); assert.ok(batch.includes(fourth.record.runId)); assert.ok(batch.includes(fifth.record.runId));
    assert.equal(fourth.consumed, true); assert.equal(fifth.consumed, true);
    h.manager.changed(); await h.idle(); assert.equal(h.notices().length, 2);
  } finally { fourthRelease.resolve(); release.resolve(); await parent; await h.cleanup(); }
});

test('actual child any/all waits preserve pending runs and an unrelated direct question returns once with current progress', { timeout: 15000 }, async () => {
  const h = await setup(), parentEntered = Promise.withResolvers<void>(), parentRelease = Promise.withResolvers<void>();
  const gates = new Map<string, PromiseWithResolvers<void>>(['ANY_A', 'ANY_B', 'ALL_A', 'ALL_B', 'TARGET'].map(prompt => [prompt, Promise.withResolvers<void>()]));
  const respond: FauxResponseFactory = async context => {
    const prompt = userText(context);
    if (prompt.includes('HOLD_PARENT')) { parentEntered.resolve(); await parentRelease.promise; return fauxAssistantMessage('parent finished'); }
    if (prompt.includes('QUESTION')) {
      const result = context.messages.findLast(message => message.role === 'toolResult');
      if (!result) return fauxAssistantMessage(fauxToolCall('ask_user', { question: 'QUESTION_FOR_PARENT', options: [{ id: 'yes', title: 'Proceed' }], timeoutMs: 0 }));
      assert.match(JSON.stringify(result), /"optionIds":\["yes"\]/); return fauxAssistantMessage('question answered');
    }
    await gates.get(prompt)?.promise;
    return fauxAssistantMessage(`finished ${prompt}`);
  };
  h.faux.setResponses(Array(30).fill(respond));
  const parent = h.session.prompt('HOLD_PARENT'); await parentEntered.promise;
  const start = (prompt: string) => h.manager.start({ prompt, background: false }, { ctx: h.ctx }, h.config);
  try {
    const a = await start('ANY_A'), b = await start('ANY_B');
    const any = h.invoke('wait', { ids: [a.record.id, b.record.id], mode: 'any', timeoutMs: 5000 });
    gates.get('ANY_A')!.resolve();
    const first = (await any).details as WaitResult;
    assert.equal(first.reason, 'condition'); assert.deepEqual(first.pending, [b.record.id]);
    assert.equal(b.controller.signal.aborted, false); gates.get('ANY_B')!.resolve(); await b.done.promise;

    const c = await start('ALL_A'), d = await start('ALL_B'); let returned = false;
    const all = h.invoke('wait', { ids: [c.record.id, d.record.id], mode: 'all', timeoutMs: 5000 }).then(value => { returned = true; return value; });
    gates.get('ALL_A')!.resolve(); await c.done.promise;
    assert.equal(returned, false);
    gates.get('ALL_B')!.resolve(); const complete = (await all).details as WaitResult;
    assert.equal(complete.reason, 'condition'); assert.deepEqual(complete.pending, []);

    const target = await start('TARGET');
    const waiting = h.invoke('wait', { ids: [target.record.id], mode: 'all', timeoutMs: 5000 });
    const question = await start('QUESTION');
    const early = (await waiting).details as WaitResult;
    assert.equal(early.reason, 'question'); assert.deepEqual(early.pending, [target.record.id]);
    assert.equal(early.others[0].id, question.record.id); assert.equal(early.others[0].question, true);
    assert.equal(question.record.state, 'waiting'); assert.ok(question.question);
    assert.match(h.statuses.get('pi-suite:runtime')!, /agents 2/);
    const progress = await h.invoke('agent_list', { id: question.record.id });
    assert.equal((progress.details as { agent: { state: string } }).agent.state, 'waiting');
    assert.match(output(await h.invoke('agent_read', { id: question.record.id, stream: 'transcript' })), /QUESTION_FOR_PARENT/);
    await h.invoke('agent_send', { id: question.record.id, message: 'yes' }); await question.done.promise;
    assert.equal(question.record.state, 'completed');
    gates.get('TARGET')!.resolve(); await target.done.promise;
    parentRelease.resolve(); await parent; await h.idle();
    assert.equal(h.notices().length, 0, 'wait consumes the returned question before boundary notification');
  } finally { for (const gate of gates.values()) gate.resolve(); parentRelease.resolve(); await parent; await h.cleanup(); }
});

test('nested questions stay with the direct parent for both launch modes and parent Esc or wait timeout leaves its child waiting', { timeout: 15000 }, async () => {
  const h = await setup(), children = new Map<string, string>();
  mkdirSync(join(h.root, 'agents'));
  writeFileSync(join(h.root, 'agents', 'delegator.md'), '---\nname: delegator\nallowed_subagents: all\nextensions: false\nskills: false\n---\nDelegate.');
  let waitingId = '';
  const respond: FauxResponseFactory = async context => {
    const prompt = userText(context), result = context.messages.findLast(message => message.role === 'toolResult');
    if (prompt.includes('NESTED_CHILD') || prompt.includes('ROOT_ASK')) {
      if (!result) return fauxAssistantMessage(fauxToolCall('ask_user', { question: prompt.includes('ROOT_ASK') ? 'ROOT_QUESTION' : `NESTED_SECRET_${prompt.includes('BG') ? 'BG' : 'FG'}`,
        options: [{ id: 'confirm', title: 'Continue' }], timeoutMs: 0 }));
      assert.match(JSON.stringify(result), /"optionIds":\["confirm"\]/); return fauxAssistantMessage('child answered');
    }
    if (getCurrentSystemPrompt(context.messages).includes('<active_agent name="delegator"/>')) {
      // A boundary notification becomes the newest user-shaped model message. Identify
      // the parent by its SDK prompt rather than mistaking that question for root input.
      const mode = JSON.stringify(context.messages.filter(message => message.role === 'user')).includes('NESTED_PARENT_BG') ? 'BG' : 'FG';
      if (!result) return fauxAssistantMessage(fauxToolCall('agent_start', { prompt: `NESTED_CHILD_${mode}`, background: mode === 'BG' }));
      if (result.toolName === 'agent_start') {
        const id = /agent_[a-f0-9]{8}/.exec(output(result))![0]; children.set(mode, id);
        if (mode === 'BG' && !JSON.stringify(context.messages).includes('NESTED_SECRET_BG')) {
          await until(h.manager, () => Boolean(h.manager.get(id).run?.question));
          return fauxAssistantMessage('Parent will answer the queued question');
        }
        assert.match(JSON.stringify(context.messages), /NESTED_SECRET/);
        return fauxAssistantMessage(fauxToolCall('agent_send', { id, message: 'confirm' }));
      }
      if (result.toolName === 'agent_send') return fauxAssistantMessage(fauxToolCall('wait', { ids: [children.get(mode)!] }));
      assert.equal(result.toolName, 'wait'); return fauxAssistantMessage('parent completed');
    }
    assert.doesNotMatch(JSON.stringify(context.messages), /NESTED_SECRET/);
    if (prompt.includes('ESC_WAIT')) return fauxAssistantMessage(fauxToolCall('wait', { ids: [waitingId], timeoutMs: 5000 }));
    return fauxAssistantMessage('root received');
  };
  h.faux.setResponses(Array(50).fill(respond));
  try {
    for (const mode of ['FG', 'BG']) {
      const parent = await h.manager.start({ type: 'delegator', prompt: `NESTED_PARENT_${mode}`, background: false }, { ctx: h.ctx }, h.config);
      assert.equal((await parent.done.promise).state, 'completed', parent.record.error?.slice(-350));
      const child = h.manager.get(children.get(mode)!).record;
      assert.equal(child.parentRunId, parent.record.runId); assert.equal(child.state, 'completed');
    }
    assert.equal(h.notices().length, 0, 'root receives no grandchild question');
    const waiting = await h.manager.start({ prompt: 'ROOT_ASK', background: false }, { ctx: h.ctx }, h.config);
    await until(h.manager, () => Boolean(waiting.question)); await h.idle(); waitingId = waiting.record.id;
    assert.equal(waiting.question?.seen, true);
    const entered = Promise.withResolvers<void>();
    const off = h.session.subscribe(event => { if (event.type === 'tool_execution_start' && event.toolName === 'wait') entered.resolve(); });
    const caller = h.session.prompt('ESC_WAIT'); await entered.promise;
    await h.session.abort(); await caller; off();
    assert.equal(waiting.record.state, 'waiting'); assert.ok(waiting.question); assert.equal(waiting.controller.signal.aborted, false);
    const timeout = (await h.invoke('wait', { ids: [waitingId], timeoutMs: 1 })).details as WaitResult;
    assert.equal(timeout.reason, 'timeout'); assert.equal(waiting.record.state, 'waiting'); assert.equal(waiting.controller.signal.aborted, false);
    await h.invoke('agent_send', { id: waitingId, message: 'confirm' });
    assert.equal((await waiting.done.promise).state, 'completed');
  } finally { await h.cleanup(); }
});
