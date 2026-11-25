import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { contentText, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory, type TranscriptContext } from '@earendil-works/pi-ai';
import type { ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import { AskView } from '../../src/ask/view.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { host, complete } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import type { Dock } from '../../src/ui/dock.ts';

function userText(context: TranscriptContext): string {
  const message = context.messages.findLast(message => message.role === 'user' && !contentText(message.content).startsWith('Current Goal instruction:') && !contentText(message.content).startsWith('Current Goal control'));
  return message ? contentText(message.content) : '';
}
const toolText = (context: TranscriptContext) => context.messages.findLast(message => message.role === 'toolResult')?.content
  .map(part => part.type === 'text' ? part.text : '').join('\n') ?? '';
function waitFor(subscribe: (listener: () => void) => () => void, condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Coordination barrier not reached')); }, 5000);
    const off = subscribe(() => { if (condition()) { clearTimeout(timer); off(); resolve(); } });
  });
}
function answer(view: AskView) { view.handleInput('\r'); view.handleInput('\r'); }

test('native asks hold real child questions and job completion; only system cancellation requires user input and each wake merges once', { timeout: 15000 }, async () => {
  for (const outcome of ['answered', 'skipped', 'timed_out', 'cancelled'] as const) {
    const root = agentDir(), command = 'read line; echo COORDINATED_DONE';
    let ctx!: ExtensionContext, dock!: Dock;
    const h = await host({ root, tools: ['job_start', 'job_read', 'job_write', 'agent_send', 'agent_read'],
      extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); },
      ui: ui => ({...ui, setWidget(_key, factory) { if (typeof factory === 'function') dock = factory(terminal(), ui.theme) as Dock; }}) });
    const agents = agentRuntime(), config = loadConfig(root, root), runtime = acquireRuntime(root);
    if (runtime.mode !== 'active') throw new Error('Expected live jobs runtime');
    const jobs = runtime.manager, forms = new Map<string, AskView>(), shown: string[] = [];
    const gateReady = Promise.withResolvers<void>(), childReady = Promise.withResolvers<void>();
    const notices = () => h.session.sessionManager.getBranch().filter(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification');
    const invoke = (name: string, params: object) => h.session.getToolDefinition(name)!.execute('coordination', params, new AbortController().signal, undefined, ctx as never);
    // Keep the SDK UI wrapper: it emits the real ui_prompt_start/end goal transitions.
    h.session.extensionRunner.setUIContext({ ...ctx.ui,
      custom: async (factory: Parameters<ExtensionUIContext['custom']>[0]) => new Promise(resolve => {
        Promise.resolve(factory(terminal(), ctx.ui.theme, {} as never, resolve)).then(component => {
          const view = component as AskView, question = view.form.question.question;
          forms.set(question, view); shown.push(question);
          // Expiry starts at render, after every background producer reaches its barrier.
          if (question !== 'gate' || outcome !== 'timed_out') view.render(80);
          if (question === 'gate') gateReady.resolve();
          else if (question === 'child A') childReady.resolve();
          else if (question === 'child B') answer(view);
        });
      }),
    } as unknown as ExtensionUIContext, 'tui');
    let stage = 0, rootCalls = 0, jobId = '', wake = '', gateResult = '', resumed: Promise<void> | undefined;
    const children: string[] = [], childResults: string[] = [];
    const respond: FauxResponseFactory = context => {
      const prompt = userText(context);
      if (prompt === 'CHILD_A' || prompt === 'CHILD_B') {
        const result = context.messages.findLast(message => message.role === 'toolResult');
        if (!result) return fauxAssistantMessage(fauxToolCall('ask_user', { question: prompt, timeoutMs: 0 }));
        childResults.push(toolText(context)); return fauxAssistantMessage(`${prompt} finished`);
      }
      rootCalls++;
      switch (stage++) {
        case 0: return fauxAssistantMessage(fauxToolCall('job_start', { command }));
        case 1:
          jobId = /job_[a-f0-9]{8}/.exec(toolText(context))![0];
          return fauxAssistantMessage(fauxToolCall('ask_user', { question: 'gate', defaultAnswer: 'approved', timeoutMs: outcome === 'timed_out' ? 20 : 0 }));
        case 2: gateResult = toolText(context); return fauxAssistantMessage('Read the queued background work');
        case 3:
          wake = userText(context);
          // Sequential native tools preserve question order; the second deadline starts
          // when its view appears, while both real children remain waiting for the parent.
          return fauxAssistantMessage([
            fauxToolCall('ask_user', { question: 'child A', defaultAnswer: 'approved', timeoutMs: 0 }),
            fauxToolCall('ask_user', { question: 'child B', defaultAnswer: 'approved', timeoutMs: 20 }),
          ]);
        case 4: return fauxAssistantMessage(children.map(id => fauxToolCall('agent_send', { id, message: 'approved' })));
        case 5: return fauxAssistantMessage(fauxToolCall('job_read', { id: jobId }));
        default: return complete(context);
      }
    };
    h.faux.setResponses(Array(20).fill(respond));
    try {
      await h.session.prompt(`/goal Coordinate ${outcome}`); await gateReady.promise;
      assert.match(h.statuses.get('goal') ?? '', /^⏳ goal \d+:\d{2}(?::\d{2})?$/); assert.equal(rootCalls, 2);
      const runs = [];
      for (const prompt of ['CHILD_A', 'CHILD_B']) {
        const run = await agents.start({ prompt }, { ctx }, config); runs.push(run); children.push(run.record.id);
        await waitFor(listener => agents.subscribe(listener), () => Boolean(run.question));
      }
      await invoke('job_write', { id: jobId, input: 'finish', submit: true }); await jobs.wait(jobId);
      assert.equal(jobs.peek(jobId).state, 'completed');
      assert.deepEqual(shown, ['gate']); assert.equal(notices().length, 1, 'only the initial goal request has been delivered');
      assert.equal(rootCalls, 2, 'background completion and parent questions cannot interrupt the native ask');
      assert.ok(runs.every(run => run.record.state === 'waiting' && run.question?.seen === false));
      assert.deepEqual(dock.render(40), [], 'native Ask owns the Dock area while background questions remain queued');
      const gate = forms.get('gate')!;
      if (outcome === 'answered') answer(gate);
      else if (outcome === 'skipped') gate.handleInput('\x1b');
      else if (outcome === 'timed_out') gate.render(80);
      else {
        gate.cancel();
        await h.idle();
        assert.equal(h.goal()?.status, 'paused'); assert.equal(h.goal()?.reason?.wait?.waiting, 'user'); assert.equal(h.goal()?.automatic, false);
        assert.equal(rootCalls, 2); assert.equal(notices().length, 1);
        assert.ok(runs.every(run => run.record.state === 'waiting'));
        resumed = h.session.prompt('Continue with my explicit answer');
      }
      await childReady.promise;
      assert.equal(h.goal()?.automatic, true); assert.equal(h.goal()?.waiting, undefined);
      assert.equal(gateResult, { answered: 'answered\n1. gate → custom: approved', skipped: 'skipped (not consent)\n1. gate → custom: approved',
        timed_out: 'timed_out (not consent)\n1. gate → custom: approved (auto-selected)', cancelled: 'cancelled' }[outcome]);
      assert.ok(wake.includes(`${jobId} completed`));
      for (const run of runs) assert.ok(wake.includes(run.record.id) && wake.includes(run.record.prompt));
      assert.ok(wake.indexOf('CHILD_A') < wake.indexOf('CHILD_B'));
      assert.equal(notices().length, 2, 'job, both child questions and goal continuation share one boundary message');
      const heldCalls = rootCalls;
      await delay(30);
      assert.deepEqual(shown, ['gate', 'child A']); assert.equal(rootCalls, heldCalls);
      assert.ok(runs.every(run => run.record.state === 'waiting'));
      assert.ok(runs.every(run => run.question?.seen === true));
      assert.deepEqual(dock.render(40), [], 'the next native Ask also covers Dock without consuming unanswered child questions');
      answer(forms.get('child A')!); await resumed; await h.idle(); await Promise.all(runs.map(run => run.done.promise));
      assert.deepEqual(shown, ['gate', 'child A', 'child B']);
      assert.equal(h.goal()?.status, 'completed'); assert.equal(rootCalls, 7);
      assert.deepEqual(childResults.slice().sort(), ['CHILD_A', 'CHILD_B'].map(question => `answered\n1. ${question} → custom: approved\nsource: parent`));
      for (const run of runs) { assert.equal(run.record.state, 'completed'); await invoke('agent_read', { id: run.record.id }); }
      assert.equal(notices().length, 2); agents.changed(); await h.idle(); assert.equal(rootCalls, 7);
    } finally {
      for (const view of forms.values()) view.cancel();
      await h.dispose(); rmSync(root, { recursive: true, force: true });
    }
  }
});
