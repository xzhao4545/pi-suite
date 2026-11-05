import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, type TranscriptContext } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { recordsIn } from '../../src/agents/records.ts';

test('foreground handoff wakes its real caller, transfers pool charges and preserves background completion after caller abort', {timeout: 15000}, async () => {
  const root = agentDir(); let ctx!: ExtensionContext;
  writeFileSync(join(root, 'pi-suite.json'), JSON.stringify({agents: {maxConcurrent: 1, maxConcurrentForeground: 1}}));
  const names = ['foreground first', 'foreground second', 'background first', 'background queued'];
  const gates = new Map(names.map(name => [name, Promise.withResolvers<void>()]));
  const entered = new Map(names.map(name => [name, Promise.withResolvers<void>()]));
  const response = async (context: TranscriptContext) => {
    const prompt = context.messages.find(message => message.role === 'user');
    const name = names.find(name => JSON.stringify(prompt).includes(name));
    if (name) { entered.get(name)!.resolve(); await gates.get(name)!.promise; }
    return fauxAssistantMessage(name ? `result: ${name}` : 'parent received');
  };
  const h = await host({root, tools: ['agent_start', 'wait'], responses: Array(12).fill(response),
    extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const manager = agentRuntime(), abort = new AbortController();
  const start = (prompt: string, signal: AbortSignal) => h.session.getToolDefinition('agent_start')!.execute(prompt,
    {prompt, background: false}, signal, undefined, ctx as never);
  try {
    const firstCall = start(names[0], abort.signal);
    await entered.get(names[0])!.promise;
    const first = [...manager.runs.values()].find(run => run.record.prompt === names[0])!;
    const secondCall = start(names[1], new AbortController().signal);
    // The native wrapper awaits Manager.start before publishing its foreground caller.
    await new Promise(resolve => setImmediate(resolve));
    const second = [...manager.runs.values()].find(run => run.record.prompt === names[1])!;
    const background = await manager.start({prompt: names[2]}, {ctx}, loadConfig(root, root));
    await entered.get(names[2])!.promise;
    assert.equal(second.record.state, 'queued');
    assert.equal(manager.canSendToBackground(second.record.id), false);
    assert.equal(manager.canSendToBackground(background.record.id), false);
    assert.equal(manager.canSendToBackground(first.record.id), true);
    assert.equal(manager.sendToBackground(first.record.id, first.record.runId), true);
    const handed = await firstCall;
    assert.equal((handed.details as {backgrounded: boolean}).backgrounded, true);
    assert.equal(first.chargedPool, 'background'); assert.equal(first.record.background, true);
    assert.equal(first.consumed, false); assert.equal(first.foreground, undefined);
    assert.equal(manager.sendToBackground(first.record.id), false, 'handoff is one-way');
    await entered.get(names[1])!.promise;
    assert.equal(second.chargedPool, 'foreground', 'handoff releases the occupied foreground slot');
    const queued = await manager.start({prompt: names[3]}, {ctx}, loadConfig(root, root));
    assert.equal(queued.record.state, 'queued', 'handoff charges the already saturated background pool');
    assert.equal(recordsIn(h.session.sessionManager.getBranch()).findLast(record => record.runId === first.record.runId)?.background, true);
    abort.abort(); assert.equal(first.controller.signal.aborted, false);
    gates.get(names[0])!.resolve(); await first.done.promise;
    assert.equal(queued.record.state, 'queued', 'one background charge remains occupied');
    gates.get(names[2])!.resolve(); await background.done.promise;
    await entered.get(names[3])!.promise;
    gates.get(names[1])!.resolve(); gates.get(names[3])!.resolve();
    await secondCall; await queued.done.promise; await h.idle();
    assert.equal(first.record.state, 'completed'); assert.equal(first.record.result, `result: ${names[0]}`);
    assert.ok(h.session.sessionManager.getBranch().some(entry => entry.type === 'custom_message'
      && JSON.stringify(entry.content).includes(`result: ${names[0]}`)), 'transferred result still reaches its parent');
    assert.equal(manager.canSendToBackground(second.record.id), false);
  } finally {
    for (const gate of gates.values()) gate.resolve();
    await h.dispose(); rmSync(root, {recursive: true, force: true});
  }
});
