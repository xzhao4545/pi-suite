import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow, workflowConcurrency, type WorkflowControl, type WorkflowHost, type WorkflowSpawnResult } from '../../src/agents/workflow/runtime/index.ts';
import { collapse } from '../../src/agents/workflow/progress/index.ts';
import { appendJournal, readJournal, journalKey, type WorkflowJournalEntry } from '../../src/agents/workflow/journal.ts';
import { extractMeta } from '../../src/agents/workflow/meta.ts';
import { createWorkflowTask, updateWorkflowProgressBatch, completeWorkflowTask } from '../../src/agents/workflow/task.ts';

const script = (body: string, name = 'contract') => `export const meta = { name: '${name}', description: 'Worker contract' };\n${body}`;
const success = (text = 'answer'): WorkflowSpawnResult => ({ ok: true, text, tokens: 5, outputTokens: 2, toolCalls: 1 });
const host: WorkflowHost = { async spawnAgent() { return success(); }, abortAgent() {} };

test('real Worker pipelines advance without a barrier; nested scopes share concurrency, schema, gates and budget', { timeout: 10000 }, async t => {
  const controller = new AbortController(); t.after(() => controller.abort());
  const slow = Promise.withResolvers<void>();
  let active = 0, peak = 0;
  const calls: string[] = [], gates: string[] = [], journal: WorkflowJournalEntry[] = [];
  const task = createWorkflowTask({ id: 'wf_contract', script: '' });
  const result = await runWorkflow({
    script: script(`
      phase('Review');
      const schema = {type: 'object', properties: {item: {type: 'string'}}, required: ['item']};
      const items = await pipeline(args,
        item => agent(item + '-read', {label: item + '-read', schema, phase: 'Review'}),
        data => agent(data.item + '-verify', {gate: 'check', phase: 'Verify'}));
      const child = await workflow('child', {items});
      const failures = await parallel([() => { throw new Error('item failed'); }, () => 7]);
      return {items, child, failures, spent: budget.spent(), unlimited: budget.total === null && budget.remaining() === Infinity};
    `), args: ['fast', 'slow'], concurrency: 2, signal: controller.signal,
    journal: { append: entry => journal.push(entry) },
    onProgress: entries => updateWorkflowProgressBatch(task, entries),
    host: {
      ...host,
      async spawnAgent(request) {
        calls.push(request.prompt); active++; peak = Math.max(peak, active);
        try {
          request.onResolved?.({ recordId: `agent_${request.index}`, modelName: 'resolved', modelId: 'provider/resolved', thinking: 'low' });
          if (request.prompt === 'slow-read') await slow.promise;
          if (request.prompt === 'fast-verify') slow.resolve();
          const text = request.schema ? JSON.stringify({item: request.prompt.split('-')[0]}) : request.prompt;
          return success(text);
        } finally { active--; }
      },
      async runGate(command) { gates.push(command); return { ok: true, output: '' }; },
      loadWorkflow: () => ({ok: true, script: script(`
        phase('Review'); console.log('child log');
        if (!(args instanceof Object) || !(args.items instanceof Array)) throw new Error('wrong realm');
        return agent('nested');
      `, 'child')}),
    },
  });
  assert.equal(result.status, 'completed', result.error);
  assert.deepEqual(result.value, {items: ['fast-verify', 'slow-verify'], child: 'nested', failures: [null, 7], spent: 10, unlimited: true});
  assert.ok(calls.indexOf('fast-verify') < calls.indexOf('slow-verify'));
  assert.equal(peak, 2); assert.equal(active, 0); assert.equal(result.agentCount, 5);
  assert.deepEqual(gates, ['check', 'check']); assert.equal(journal.length, 5);
  const progress = collapse(result.progress);
  assert.deepEqual([...progress.phaseTitles.values()], ['Review', 'Verify', '▸ child', '▸ child › Review']);
  assert.equal(progress.agents.filter(row => row.state === 'done' && row.modelId === 'provider/resolved').length, 5);
  assert.deepEqual(progress.logs, ['▸ child: child log']);
  completeWorkflowTask(task, result);
  assert.equal(task.doneCount, 5); assert.equal(task.totalTokens, 25); assert.equal(task.totalToolCalls, 5);
});

test('pause holds queued agents, skip releases a held call and retry charges every attempt once', { timeout: 10000 }, async t => {
  const controller = new AbortController(); t.after(() => controller.abort());
  let control!: WorkflowControl;
  const queued = Promise.withResolvers<void>(), retried = Promise.withResolvers<void>();
  const pending = new Map<string, PromiseWithResolvers<WorkflowSpawnResult>>();
  const calls: number[] = [];
  const resultPromise = runWorkflow({
    script: script(`const values = await parallel([() => agent('retry'), () => agent('skip'), () => agent('held')]); return {values, spent: budget.spent()};`),
    host: {
      async spawnAgent(request) {
        calls.push(request.index);
        if (calls.length > 1) return success(request.prompt);
        const gate = Promise.withResolvers<WorkflowSpawnResult>(); pending.set(request.agentId, gate);
        queueMicrotask(() => { control.pause(); assert.equal(control.retry(0), true); });
        return gate.promise;
      },
      abortAgent: id => pending.get(id)?.resolve({ok: false, skipped: true, error: 'Stopped', tokens: 9, outputTokens: 3, toolCalls: 2}),
    },
    concurrency: 1, signal: controller.signal,
    onControl(value) { control = value; control.pause(); },
    onProgress(entries) {
      for (const entry of entries) if (entry.type === 'workflow_agent') {
        // Runtime registers the live call immediately after emitting its queued row.
        if (entry.index === 2 && entry.startedAt === undefined) queueMicrotask(() => queued.resolve());
        if (entry.index === 0 && entry.attempt === 2) retried.resolve();
      }
    },
  });
  await queued.promise;
  assert.equal(calls.length, 0); assert.equal(control.skip(1), true); assert.equal(control.retry(1), false);
  control.resume(); await retried.promise;
  assert.equal(control.isPaused(), true); assert.equal(calls.length, 1);
  control.resume();
  const result = await resultPromise;
  assert.equal(result.status, 'completed', result.error);
  assert.deepEqual(result.value, {values: ['retry', null, 'held'], spent: 7});
  assert.deepEqual([...calls].sort(), [0, 0, 2]);
  const rows = collapse(result.progress).agents;
  assert.equal(rows[0].attempt, 2); assert.equal(rows[0].tokens, 14); assert.equal(rows[0].toolCalls, 3);
  assert.equal(rows[1].skipped, true); assert.equal(control.retry(0), false);
});

test('journal replay is a successful unchanged prefix, rechecks schemas and declines runs that resume a child', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-workflow-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const path = join(root, 'journal.jsonl'); writeFileSync(path, '');
  const calls: string[] = [];
  let failB = true;
  const h: WorkflowHost = { ...host, async spawnAgent(request) {
    calls.push(request.prompt);
    return request.prompt === 'b' && failB ? {ok: false, error: 'Failed'} : success(request.prompt);
  } };
  const source = script(`return [await agent(args[0]), await agent(args[1]), await agent(args[2])];`);
  await runWorkflow({script: source, args: ['a', 'b', 'c'], host: h, journal: {append: entry => appendJournal(path, entry)}});
  const prior = readJournal(path); assert.equal(prior.truncated, false);
  failB = false; calls.length = 0;
  const appended: WorkflowJournalEntry[] = [];
  const resumed = await runWorkflow({script: source, args: ['a', 'b', 'c'], host: h, journal: {entries: prior.entries, append: entry => appended.push(entry)}});
  assert.equal(resumed.replayedCount, 1); assert.deepEqual(calls, ['b', 'c']); assert.equal(appended.length, 3);
  calls.length = 0;
  const changed = await runWorkflow({script: source, args: ['changed', 'b', 'c'], host: h, journal: {entries: appended}});
  assert.equal(changed.replayedCount, 0); assert.deepEqual(calls, ['changed', 'b', 'c']);

  const structured = script(`return [await agent('json', {schema: {type: 'object', required: ['ok'], properties: {ok: {type: 'boolean'}}}}), await agent('later')];`);
  const schemaJournal: WorkflowJournalEntry[] = [];
  const jsonHost: WorkflowHost = {...h, async spawnAgent(request) { calls.push(request.prompt); return success(request.schema ? '{"ok":true}' : 'later'); }};
  await runWorkflow({script: structured, host: jsonHost, journal: {append: entry => schemaJournal.push(entry)}});
  schemaJournal[0].text = '{"ok":"corrupt"}'; calls.length = 0;
  const rechecked = await runWorkflow({script: structured, host: jsonHost, journal: {entries: schemaJournal}});
  assert.equal(rechecked.replayedCount, 0); assert.deepEqual(calls, ['json', 'later']);
  assert.deepEqual(rechecked.value, [{ok: true}, 'later']);

  const continuation = script(`await agent('start', {label: 'same'}); return agent('continue', {resume: 'same'});`);
  const resumeJournal: WorkflowJournalEntry[] = []; let continuations = 0;
  const resumeHost: WorkflowHost = {...h, async resumeAgent(id, prompt) {
    assert.equal(id, 'wf-agent-0'); assert.equal(prompt, 'continue'); continuations++; return success('continued');
  }};
  await runWorkflow({script: continuation, host: resumeHost, journal: {append: entry => resumeJournal.push(entry)}});
  const fresh = await runWorkflow({script: continuation, host: resumeHost, journal: {entries: resumeJournal}});
  assert.equal(fresh.replayedCount, 0); assert.equal(continuations, 2); assert.equal(resumeJournal[1].resumed, true);
});

test('metadata, JSON, deterministic globals, unsupported options and run caps fail at their boundaries', { timeout: 15000 }, async () => {
  assert.equal(workflowConcurrency(1), 1); assert.equal(workflowConcurrency(2), 1); assert.equal(workflowConcurrency(100), 16);
  const meta = extractMeta("export const meta = /* comment */ {name: '测试}', description: `plain`, phases: [{title: 'a}b',},], extra: [-2, 0x10, true, null]}; return 1;");
  assert.equal(meta.meta.name, '测试}'); assert.equal(meta.meta.phases?.[0].title, 'a}b');
  for (const fragment of ["{name: (() => 'n')(), description: 'd'}", "{name: 'n' + 'x', description: 'd'}", "{...{name: 'n'}, description: 'd'}", "{name: `n${1}`, description: 'd'}", "(() => ({name: 'n', description: 'd'}))()"]) {
    await assert.rejects(runWorkflow({script: `export const meta = ${fragment};`, host}), /PURE LITERAL/);
  }
  for (const args of [new Date(), {value: undefined}, {value: 1n}, [Infinity]]) {
    await assert.rejects(runWorkflow({script: script('return args;'), args, host}), /boundary/);
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  await assert.rejects(runWorkflow({script: script('return args;'), args: cycle, host}), /circular/);
  await assert.rejects(runWorkflow({script: script('// ' + '字'.repeat(175000)), host}), /bytes, over the limit/);
  const cases: [string, RegExp][] = [
    ['return Date.now();', /deterministic|Date.now/],
    ['return Math.random();', /deterministic|Math.random/],
    ['return new Date();', /deterministic|Date/],
    ['return {x: undefined};', /undefined/],
    ['return new Map();', /non-plain/],
    ["return agent('x', {isolation: 'worktree'});", /isolation.*not supported/],
    ["return agent('x', {schema: {type: 'unknown'}});", /schema|Unsupported/],
    ["return agent('x', {resume: 'missing'});", /no agent has completed/],
  ];
  for (const [body, error] of cases) {
    const result = await runWorkflow({script: script(body), host: {...host, resumeAgent: async () => success()}});
    assert.equal(result.status, 'failed'); assert.match(result.error!, error);
  }
  const agentCap = await runWorkflow({script: script("return parallel([() => agent('1'), () => agent('2'), () => agent('3')]);"), host, agentCap: 2});
  assert.equal(agentCap.status, 'failed'); assert.match(agentCap.error!, /cap of 2 agents/);
  const itemCap = await runWorkflow({script: script('return pipeline([1, 2, 3], x => x);'), host, itemCap: 2});
  assert.equal(itemCap.status, 'failed'); assert.match(itemCap.error!, /limit of 2/);
  const nestedHost: WorkflowHost = {...host, loadWorkflow: () => ({ok: true, script: script("return workflow('grandchild');", 'child')})};
  const depth = await runWorkflow({script: script("return workflow('child');"), host: nestedHost});
  assert.equal(depth.status, 'failed'); assert.match(depth.error!, /one level/);
  const nestedCap = await runWorkflow({script: script("return parallel([() => workflow('child'), () => workflow('child')]);"), host: nestedHost, nestedCap: 1});
  assert.equal(nestedCap.status, 'failed'); assert.match(nestedCap.error!, /cap of 1 nested/);
});

test('unawaited launches abort their children and an infinite-loop Worker is actually terminated', { timeout: 10000 }, async t => {
  const pending = Promise.withResolvers<WorkflowSpawnResult>(); let aborted = 0;
  const forgotten = await runWorkflow({script: script("agent('forgotten'); return 'done';"), host: {
    spawnAgent: () => pending.promise,
    abortAgent() { aborted++; pending.resolve({ok: false, error: 'Stopped'}); },
  }});
  assert.equal(forgotten.status, 'failed'); assert.match(forgotten.error!, /unawaited agent launch/); assert.equal(aborted, 1);

  const controller = new AbortController(); t.after(() => controller.abort());
  const ready = Promise.withResolvers<void>();
  const started = Date.now();
  const spinning = runWorkflow({script: script("await agent('ready'); while (true) {}"), signal: controller.signal, host: {
    ...host, async spawnAgent() { ready.resolve(); return success(); },
  }});
  await ready.promise;
  // Allow the worker to receive the answer and enter its synchronous loop.
  const timer = setTimeout(() => controller.abort(), 30); t.after(() => clearTimeout(timer));
  const result = await spinning;
  assert.equal(result.status, 'killed'); assert.ok(Date.now() - started < 2000);
});

test('journal corruption and I/O errors are visible, including append and gate failures during a live run', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-journal-')); t.after(() => rmSync(root, {recursive: true, force: true}));
  const path = join(root, 'journal.jsonl'), entry = {index: 0, key: 'key', ok: true, text: 'answer'};
  writeFileSync(path, `${JSON.stringify(entry)}\n{"index":`);
  assert.deepEqual(readJournal(path), {entries: [entry], truncated: true});
  writeFileSync(path, `${JSON.stringify(entry)}\n{broken}\n`); assert.throws(() => readJournal(path), /Invalid workflow journal.*:2/);
  writeFileSync(path, `${JSON.stringify(entry)}\n${JSON.stringify(entry)}\n`); assert.throws(() => readJournal(path), /entry.*:2/);
  assert.throws(() => readJournal(join(root, 'missing')), /ENOENT/);
  assert.throws(() => appendJournal(root, entry), /EISDIR|EPERM|EACCES/);
  const source = script("return agent('persist');");
  for (const entries of [undefined, [{...entry, key: journalKey({prompt: 'persist'})}]]) {
    const result = await runWorkflow({script: source, host, journal: {entries, append: () => { throw new Error('journal unavailable'); }}});
    assert.equal(result.status, 'failed'); assert.match(result.error!, /journal unavailable/);
  }
  const gate = await runWorkflow({script: script("const value = await agent('gate', {gate: 'check'}); return {value, spent: budget.spent()};"), host: {
    ...host, async runGate() { throw new Error('gate unavailable'); },
  }});
  assert.equal(gate.status, 'completed'); assert.deepEqual(gate.value, {value: null, spent: 2});
  assert.match(collapse(gate.progress).agents[0].error!, /gate unavailable/);
  assert.equal(readFileSync(path, 'utf8').split('\n').length, 3, 'failed reads do not modify the journal');
});
