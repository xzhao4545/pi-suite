import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Type} from 'typebox';
import {
  AgentSessionRuntime, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  type AgentSessionEvent, type ExtensionAPI, type ExtensionFactory, type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import piSuite from '../../src/index.ts';
import type {Goal} from '../../src/goal/state.ts';
import {GOAL_ENTRY} from '../../src/goal/snapshot.ts';
import { goalStore } from '../../src/goal/store.ts';
import {RECOVERY_ENTRY, ResponsesRecovery} from '../../src/runtime/responses/index.ts';
import {SessionBinding} from '../../src/runtime/binding.ts';

// All history is produced by the real Responses stream parser and replayed by its
// serializer. No fabricated signatures, provider mocks or user's agent directory.
type Item = {type?: string; id?: string; [key: string]: unknown};
type Wire = {model: string; input: Item[]; [key: string]: unknown};
type HttpError = {status: number; message: string; code?: string};
type Step = number | HttpError | 'complete' | 'progress' | 'partial' | 'hold' | 'network';
type Unsafe = 'reference' | 'previous' | 'store' | 'unknown' | 'compaction';
const mismatch = "Item 'rs_seed' belongs to a different OpenAI resource";
const cpaMismatch = 'cpa API error (400): ' + JSON.stringify({code: null,
  message: 'OpenAI Responses bad request: The requested item was created under a different *** OpenAI resource. ' +
    'Use the same resource that created the item to access it. [trace_id=f4f12dea59a3ef75ac76fe51a49f110e]',
  param: '', type: 'invalid_request_error'});
const cpaCipherMismatch = 'cpa API error (400): ' + JSON.stringify({code: null,
  message: 'OpenAI Responses bad request: The encrypted content ciph...atim could not be verified. ' +
    'Reason: Encrypted content could not be decrypted or parsed. [trace_id=… code=30000]',
  param: '', type: 'invalid_request_error'});
const text = (id: string, value: string): Item => ({type: 'message', id, role: 'assistant', phase: 'final_answer',
  status: 'completed', content: [{type: 'output_text', text: value, annotations: []}]});
const call = (id: string, name: string, args: object): Item => ({type: 'function_call', id, call_id: `call_${id}`,
  name, arguments: JSON.stringify(args), status: 'completed'});
const seed: Item[] = [
  {type: 'reasoning', id: 'rs_seed', encrypted_content: 'cipher_keep_verbatim', summary: [{type: 'summary_text', text: 'seed reasoning'}]},
  text('msg_seed', 'seed evidence'), call('fc_seed', 'recovery_probe', {value: 'original arguments'}),
];
function sse(response: ServerResponse, items: Item[], partial = false): void {
  response.writeHead(200, {'content-type': 'text/event-stream'});
  const emit = (event: Record<string, unknown>) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  emit({type: 'response.created', response: {id: 'resp_local'}});
  items.forEach((item, index) => {
    emit({type: 'response.output_item.added', output_index: index, item: {...item, content: [], summary: []}});
    if (item.type === 'message') {
      emit({type: 'response.content_part.added', output_index: index, content_index: 0, item_id: item.id,
        part: {type: 'output_text', text: '', annotations: []}});
      emit({type: 'response.output_text.delta', output_index: index, content_index: 0, item_id: item.id,
        delta: (item.content as {text: string}[])[0].text});
    } else if (item.type === 'reasoning') {
      emit({type: 'response.reasoning_summary_text.delta', output_index: index, item_id: item.id, summary_index: 0, delta: 'seed reasoning'});
    }
    emit({type: 'response.output_item.done', output_index: index, item});
  });
  emit(partial ? {type: 'response.failed', response: {status: 'failed', error: {code: 'resource_mismatch', message: mismatch}}} :
    {type: 'response.completed', response: {id: 'resp_local', status: 'completed', output: items,
      usage: {input_tokens: 4, output_tokens: 5, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 1}}}});
  response.end();
}
function goalId(wire: Wire): string {
  for (const item of wire.input.toReversed()) {
    const content = typeof item.content === 'string' ? item.content : Array.isArray(item.content)
      ? item.content.map(block => block.text ?? '').join('\n') : '';
    if (content.startsWith('Current Goal instruction:') || content.startsWith('Current Goal control')) return JSON.parse(content.slice(content.lastIndexOf('\n') + 1)).goalId;
  }
  throw new Error('Missing real Goal request contract');
}

async function fixture(options: {
  steps: Step[]; enabled?: boolean; maxRetries?: number;
  unsafe?: Unsafe; coexist?: 'before' | 'after';
}) {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-responses-')), user = join(root, 'user');
  mkdirSync(user);
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = user;
  writeFileSync(join(user, 'pi-suite.json'), JSON.stringify({modules: {ask: false, tasks: false, jobs: false, agents: false},
    ...(options.enabled === undefined ? {} : {runtime: {openAIResponsesAutoRecovery: options.enabled}})}));
  const requests: Wire[] = [], requestGoals: (Goal['status'] | undefined)[] = [], events: AgentSessionEvent[] = [], errors: string[] = [];
  let effects = 0, armed = false, externalRepairs = 0;
  const held = Promise.withResolvers<{wire: Wire; response: ServerResponse}>(), disconnected = Promise.withResolvers<void>();
  const manager = SessionManager.inMemory(root);
  const goal = (): Goal | undefined => goalStore({sessionManager: manager} as unknown as ExtensionContext, user).current.goal ?? undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
    const wire = JSON.parse(Buffer.concat(chunks).toString()) as Wire;
    requests.push(wire); requestGoals.push(goal()?.status);
    if (!armed) return sse(response, requests.length === 1 ? seed : [text('msg_seed_done', 'seed finished')]);
    const step = options.steps.shift();
    if (step === undefined) {
      errors.push('Unexpected extra provider request');
      response.writeHead(400, {'content-type': 'application/json'}); response.end(JSON.stringify({error: {message: 'unexpected request'}})); return;
    }
    if (step === 'network') { response.destroy(); return; }
    if (step === 'hold') {
      response.once('close', () => disconnected.resolve()); held.resolve({wire, response}); return;
    }
    if (typeof step === 'number' || typeof step === 'object') {
      const error = typeof step === 'number' ? {status: step, message: step === 400 ? mismatch : `${step} final upstream failure`} : step;
      response.writeHead(error.status, {'content-type': 'application/json'});
      response.end(JSON.stringify({error: {message: error.message, code: error.code, type: 'invalid_request_error'}}));
    } else if (step === 'partial') sse(response, [text('msg_partial', 'partial output must not replay')], true);
    else if (step === 'progress') sse(response, [text('msg_progress', 'Work remains; continue verification')]);
    else sse(response, goal()?.status === 'active' ? [call('fc_complete', 'goal_complete', {goalId: goalId(wire), summary: 'Verified recovery'})] :
      [text('msg_success', 'RECOVERY_OK')]);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const settings = SettingsManager.inMemory({retry: {enabled: true, maxRetries: options.maxRetries ?? 0, baseDelayMs: 1,
    provider: {maxRetries: 0}}, compaction: {enabled: false}});
  // Simulate another extension's public boundary proposal, including a durable
  // omission. The payload fix is its own responsibility, not Suite's recovery.
  const external = (pi: ExtensionAPI) => {
    pi.on('before_provider_request', event => {
      if (!externalRepairs) return;
      const wire = event.payload as Wire;
      return {...wire, input: wire.input.map(item => {
        if (!seed.some(original => original.id === item.id) && item.id !== 'msg_seed_done') return item;
        const {id: _id, ...rest} = item; return rest;
      })};
    });
    pi.on('agent_before_settle', event => {
      if (event.outcome !== 'error' || event.continue) return;
      const source = event.context.contextEntries.findLast(entry => entry.messages.some(message => message.role === 'assistant' &&
        message.stopReason === 'error' && message.errorMessage?.includes(mismatch)));
      if (!source) return;
      externalRepairs++;
      return {continue: true, entries: [...event.entries, {type: 'custom', customType: 'test:external-repair', data: true},
        {type: 'context_edit', targetId: source.sourceEntry.id, replacement: null}]};
    });
  };
  const provider: ExtensionFactory = pi => {
    pi.registerProvider('recovery-local', {api: 'openai-responses', baseUrl: endpoint, apiKey: 'local-only', models: [{
      id: 'offline', name: 'Local recovery', reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 1000,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    }]});
    pi.registerTool({name: 'recovery_probe', label: 'Probe', description: 'Count actual tool effects', parameters: Type.Object({value: Type.String()}),
      execute: async (_id, args) => {effects++; return {content: [{type: 'text', text: `RESULT:${args.value}`}], details: {}};}});
    pi.on('before_provider_request', event => {
      if (!armed || !options.unsafe) return;
      const wire = event.payload as Wire;
      if (options.unsafe !== 'previous' && options.unsafe !== 'store') {
        const type = options.unsafe === 'reference' ? 'item_reference' : options.unsafe === 'unknown' ? 'unknown_resource' : 'compaction';
        return {...wire, input: [...wire.input, {type, id: 'rs_reference', encrypted_content: 'unsafe_cipher'}]};
      }
      return {...wire, ...(options.unsafe === 'previous' ? {previous_response_id: 'resp_reference'} : {store: true})};
    });
    if (options.coexist === 'before') external(pi);
  };
  const loader = new DefaultResourceLoader({cwd: root, agentDir: user, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [provider, piSuite, pi => {if (options.coexist === 'after') pi.on('session_start', () => external(pi));}],
  });
  await loader.reload();
  const {session, extensionsResult} = await createAgentSession({cwd: root, agentDir: user, settingsManager: settings,
    resourceLoader: loader, sessionManager: manager, tools: ['recovery_probe', 'goal_complete', 'goal_wait', 'goal_blocked']});
  assert.deepEqual(extensionsResult.errors, []);
  await session.bindExtensions({mode: 'rpc', uiContext: {...session.extensionRunner.createContext().ui,
    confirm: async () => true}, onError: event => errors.push(event.error)});
  const model = session.modelRuntime.getModel('recovery-local', 'offline'); assert.ok(model);
  await session.setModel(model);
  session.subscribe(event => events.push(event));
  return {session, extensionsResult, services: {cwd: root, agentDir: user, modelRuntime: session.modelRuntime, settingsManager: settings, resourceLoader: loader, diagnostics: []}, requests, requestGoals, events, errors, goal, manager, held: held.promise, disconnected: disconnected.promise,
    effects: () => effects, externalRepairs: () => externalRepairs,
    async seed() {await session.prompt('Create replay history'); await session.waitForIdle(); assert.equal(requests.length, 2); armed = true;},
    async run() {await session.prompt('/goal Verify resource recovery'); await session.waitForIdle(); assert.deepEqual(errors, []);},
    async dispose() {
      await session.abort(); await session.extensionRunner.emit({type: 'session_shutdown', reason: 'quit'}); session.dispose();
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
      if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
      rmSync(root, {recursive: true, force: true});
    },
  };
}
const records = (h: Awaited<ReturnType<typeof fixture>>) => h.manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === RECOVERY_ENTRY);
const errors = (h: Awaited<ReturnType<typeof fixture>>) => h.manager.getBranch().flatMap(entry =>
  entry.type === 'message' && entry.message.role === 'assistant' && entry.message.stopReason === 'error' ? [entry.message] : []);
const stripped = (input: Item[]) => input.map(item => {
  if (!['reasoning', 'message', 'function_call'].includes(String(item.type)) || !item.id || item.id.startsWith('msg_pi_')) return item;
  const {id: _id, ...rest} = item; return rest;
});

const replayWire = (wire: Wire): Wire => wire;

test('normal Goal continuation preserves the entire previous Responses input prefix without request-only contracts', {timeout: 20000}, async () => {
  const h = await fixture({steps: ['progress', 'complete']});
  try {
    await h.seed(); await h.run();
    const first = h.requests[2], second = h.requests[3];
    assert.equal(h.requests.length, 4); assert.equal(h.goal()?.status, 'completed');
    assert.deepEqual(second.input.slice(0, first.input.length), first.input);
    const {input: _first, ...a} = first, {input: _second, ...b} = second;
    assert.deepEqual(a, b, 'system/tools/cache key and envelope are stable');
    assert.equal(h.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === GOAL_ENTRY).length, 0);
    assert.equal(JSON.stringify(second.input).split('Current Goal instruction:').length - 1, 1);
  } finally {await h.dispose();}
});

for (const transient of [false, true, 'network'] as const) test(`actual SDK repairs Responses IDs${transient === 'network' ? ' across a native network retry' : transient ? ' across native 429/503 retries' : ' without discarding replay content'}`, {timeout: 20000}, async () => {
  const steps: Step[] = transient === 'network' ? ['network'] : transient ? [429, 503] : [];
  const retries = steps.length;
  const h = await fixture({enabled: true, maxRetries: 2,
    steps: [transient ? 400 : {status: 400, message: cpaMismatch}, ...steps, 'complete']});
  try {
    await h.seed(); await h.run();
    assert.equal(h.requests.length, 4 + retries); assert.equal(h.effects(), 1, 'history replay must not rerun the seed tool');
    assert.deepEqual(replayWire(h.requests[3]), replayWire({...h.requests[2], input: stripped(h.requests[2].input)}), 'only upstream history input[].id may change');
    const replay = h.requests[3].input;
    assert.ok(replay.some(item => item.type === 'reasoning' && item.encrypted_content === 'cipher_keep_verbatim'));
    assert.ok(replay.some(item => item.type === 'message' && item.phase === 'final_answer'));
    assert.ok(replay.some(item => item.type === 'function_call' && item.call_id === 'call_fc_seed' && item.arguments === '{"value":"original arguments"}'));
    assert.ok(replay.some(item => item.type === 'function_call_output' && item.call_id === 'call_fc_seed' && String(item.output).includes('RESULT:original arguments')));
    assert.ok(h.requestGoals.slice(2).every(state => state === 'active'), 'Goal remains active until success');
    assert.equal(h.goal()?.status, 'completed'); assert.equal(records(h).length, 1);
    assert.equal(errors(h).length, retries + 1, 'failed attempts remain in real history');
    assert.equal(h.events.filter(event => event.type === 'auto_retry_start').length, retries);
    if (transient) {
      for (const request of h.requests.slice(4)) assert.deepEqual(replayWire(request), replayWire(h.requests[3]));
      assert.ok(h.events.some(event => event.type === 'auto_retry_end' && event.success));
    }
  } finally {await h.dispose();}
});

test('actual SDK drops reasoning whose ciphertext the endpoint cannot decrypt, alone or after an ID repair', {timeout: 20000}, async () => {
  for (const idFirst of [false, true]) {
    const steps: Step[] = idFirst ? [400] : [];
    const h = await fixture({enabled: true, steps: [...steps, {status: 400, message: cpaCipherMismatch}, 'complete']});
    try {
      await h.seed(); await h.run();
      const failedIndex = idFirst ? 3 : 2;
      const failed = h.requests[failedIndex];
      assert.equal(h.requests.length, failedIndex + 2);
      if (idFirst) assert.deepEqual(failed, {...h.requests[2], input: stripped(h.requests[2].input)});
      assert.deepEqual(h.requests[failedIndex + 1], {...failed,
        input: stripped(failed.input.filter(item => item.type !== 'reasoning'))});
      const isolation = records(h);
      assert.equal(isolation.length, idFirst ? 2 : 1);
      const cipherRecord = isolation.at(-1);
      assert.ok(cipherRecord?.type === 'custom');
      assert.deepEqual((cipherRecord.data as {ciphers: string[]}).ciphers,
        [createHash('sha256').update(String(seed[0].encrypted_content)).digest('hex')]);
      assert.equal(h.goal()?.status, 'completed'); assert.equal(h.effects(), 1);
    } finally {await h.dispose();}
  }
});

test('native retry exhaustion pauses Goal once with the last real error and never opens another budget', {timeout: 20000}, async () => {
  const h = await fixture({enabled: true, maxRetries: 2, steps: [400, 429, 503, 503]});
  try {
    await h.seed(); await h.run();
    assert.equal(h.requests.length, 6); assert.equal(records(h).length, 1); assert.equal(h.effects(), 1);
    assert.equal(h.goal()?.status, 'paused'); assert.equal(h.goal()?.automatic, false);
    assert.match(h.goal()?.error ?? '', /503 final upstream failure/);
    const end = h.events.findLast(event => event.type === 'auto_retry_end');
    assert.ok(end?.type === 'auto_retry_end' && !end.success); assert.match(end.finalError ?? '', /503 final upstream failure/);
    assert.equal(h.events.filter(event => event.type === 'auto_retry_start').length, 2);
    assert.deepEqual(replayWire(h.requests[5]), replayWire(h.requests[3]));
  } finally {await h.dispose();}
});

test('a second resource 400 with no new IDs settles instead of resending the same payload', {timeout: 20000}, async () => {
  const h = await fixture({enabled: true, steps: [400, 400]});
  try {
    await h.seed(); await h.run();
    assert.equal(h.requests.length, 4); assert.equal(records(h).length, 1); assert.equal(h.goal()?.status, 'paused');
    assert.match(h.goal()?.error ?? '', /different OpenAI resource/);
    assert.equal(h.events.filter(event => event.type === 'auto_retry_start').length, 0);
  } finally {await h.dispose();}
});

test('default-disabled recovery and unsafe partial/reference/stateful requests retain genuine failures', {timeout: 30000}, async () => {
  for (const mode of ['disabled', 'partial', 'reference', 'previous', 'store'] as const) {
    const h = await fixture({enabled: mode === 'disabled' ? undefined : true, steps: [mode === 'partial' ? 'partial' : 400],
      unsafe: ['reference', 'previous', 'store'].includes(mode) ? mode as Unsafe : undefined});
    try {
      await h.seed(); await h.run();
      assert.equal(h.requests.length, 3, mode); assert.equal(records(h).length, 0, mode); assert.equal(h.effects(), 1, mode);
      assert.equal(h.goal()?.status, 'paused', mode); assert.match(h.goal()?.error ?? '', /different OpenAI resource/, mode);
      assert.ok(h.requests[2].input.some(item => item.id === 'rs_seed'), mode);
      if (mode === 'partial') assert.ok(errors(h).some(message => message.content.some(block => block.type === 'text' && block.text.includes('partial output'))));
    } finally {await h.dispose();}
  }
});

test('ordinary API errors and unknown/compaction resources are not admitted for ID repair', {timeout: 30000}, async () => {
  const cases: {error: HttpError; unsafe?: Unsafe}[] = [
    {error: {status: 400, message: 'Invalid schema for function recovery_probe: missing required property'}},
    // Named IDs/resource words must not override HTTP authorization or quota errors.
    {error: {status: 401, message: `Unauthorized: ${mismatch}`}},
    {error: {status: 403, message: `Forbidden: ${mismatch}`}},
    {error: {status: 429, message: 'You exceeded your current quota', code: 'insufficient_quota'}},
    {error: {status: 400, message: 'Maximum context length is 32000 tokens'}},
    {error: {status: 400, message: 'OpenAI Responses bad request: invalid schema description mentioning a different *** OpenAI resource'}},
    {error: {status: 400, message: cpaCipherMismatch.replace('ciph...atim', 'atim...ciph')}},
    ...(['unknown', 'compaction'] as const).map(unsafe => ({unsafe, error: {status: 400, message: mismatch}})),
  ];
  for (const scenario of cases) {
    const h = await fixture({enabled: true, maxRetries: 2, steps: [scenario.error], unsafe: scenario.unsafe});
    try {
      await h.seed(); await h.run();
      assert.equal(h.requests.length, 3, scenario.error.message); assert.equal(records(h).length, 0);
      assert.equal(h.goal()?.status, 'paused'); assert.equal(h.goal()?.reason?.kind, 'request_failed');
      // The SDK reports the JSON envelope, which escapes the nested CPA error string.
      assert.ok(h.goal()?.error?.includes(JSON.stringify(scenario.error.message).slice(1, -1)), 'preserve the actual upstream error');
      assert.ok(h.requests[2].input.some(item => item.id === 'rs_seed')); assert.equal(h.effects(), 1);
      assert.equal(h.events.filter(event => event.type === 'auto_retry_start').length, 0);
    } finally {await h.dispose();}
  }
});

test('control changes abort a repaired request and late success cannot reclaim superseded Goal ownership', {timeout: 20000}, async () => {
  for (const action of ['pause', 'clear', 'edit', 'replace', 'abort', 'new'] as const) {
    const superseded = action === 'edit' || action === 'replace';
    const h = await fixture({enabled: true, maxRetries: 2, steps: [400, 'hold', ...superseded ? ['complete' as const] : []]});
    try {
      await h.seed();
      const running = h.run(), {wire, response} = await h.held;
      assert.equal(h.requests.length, 4); assert.equal(records(h).length, 1); assert.equal(h.goal()?.status, 'active');
      const id = goalId(wire);
      if (action === 'new') {
        let replacement: Awaited<ReturnType<typeof fixture>> | undefined;
        const runtime = new AgentSessionRuntime(h.session, h.services, async () => {
          replacement = await fixture({enabled: true, steps: []});
          return {...replacement, ...replacement.services, services: replacement.services, diagnostics: []};
        });
        try {
          await runtime.newSession();
          sse(response, [call('fc_late', 'goal_complete', {goalId: id, summary: 'Must not enter the replacement session'})]);
          await running; await h.disconnected;
          assert.equal(replacement?.goal(), undefined); assert.equal(replacement?.requests.length, 0);
          assert.equal(records(replacement!).length, 0); assert.equal(h.requests.length, 4);
        } finally { await runtime.dispose(); await replacement?.dispose(); }
        continue;
      }
      if (action === 'abort') await h.session.abort();
      else if (action === 'replace') await h.session.prompt('/goal Replacement objective');
      else await h.session.prompt(`/goal ${action === 'edit' ? 'edit Updated objective' : action}`);
      // The real upstream response is late: do not inject a fake message_end past the abort.
      sse(response, [call('fc_late', 'goal_complete', {goalId: id, summary: 'Must not complete superseded work'})]);
      await running; await h.disconnected; await h.session.waitForIdle();
      assert.equal(h.requests.length, superseded ? 5 : 4, action); assert.equal(h.effects(), 1);
      if (action === 'clear') assert.equal(h.goal(), undefined);
      else if (superseded) {
        assert.equal(h.goal()?.status, 'completed', action);
        assert.equal(h.goal()?.progress, 'Verified recovery');
        if (action === 'edit') { assert.equal(h.goal()?.id, id); assert.equal(h.goal()?.revision, 1); }
        else assert.notEqual(h.goal()?.id, id);
      } else {
        assert.equal(h.goal()?.id, id); assert.equal(h.goal()?.status, 'paused');
        assert.equal(h.goal()?.reason?.kind, action === 'pause' ? 'manual' : 'cancelled');
        assert.equal(h.goal()?.completedAt, undefined); assert.equal(h.goal()?.progress, '');
      }
      assert.equal(h.events.filter(event => event.type === 'auto_retry_start').length, 0);
      assert.ok(h.events.some(event => event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'aborted'));
      assert.equal(h.events.filter(event => event.type === 'tool_execution_start' && event.toolName === 'goal_complete').length, superseded ? 1 : 0);
      assert.equal(h.manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user').length, 1);
    } finally {await h.dispose();}
  }
});

test('both extension orders merge failure omission/continuation without duplicate recovery or premature Goal pause', {timeout: 20000}, async () => {
  for (const coexist of ['before', 'after'] as const) {
    const h = await fixture({enabled: true, coexist, steps: [400, 'complete']});
    try {
      await h.seed(); await h.run();
      assert.equal(h.requests.length, 4, coexist); assert.equal(h.goal()?.status, 'completed', coexist);
      assert.equal(h.externalRepairs() + records(h).length, 1, 'one extension owns the repair');
      assert.equal(h.manager.getBranch().filter(entry => entry.type === 'context_edit').length, 1, 'one durable failed-source omission');
      assert.equal(h.effects(), 1); assert.ok(h.requestGoals.slice(2, 4).every(state => state === 'active'));
    } finally {await h.dispose();}
  }
});

test('isolation follows branch ancestry and endpoint scope without crossing child bindings or rewriting history', () => {
  const manager = SessionManager.inMemory('/tmp/suite-recovery-branch');
  const model = {provider: 'local', api: 'openai-responses', id: 'offline', baseUrl: 'https://endpoint.invalid/v1'};
  const ctx = {sessionManager: manager, get model() {return model;}} as unknown as ExtensionContext;
  const binding = new SessionBinding(); binding.bind(ctx);
  const recovery = new ResponsesRecovery(binding, true);
  const scope = createHash('sha256').update(JSON.stringify([model.provider, model.api, model.id, model.baseUrl])).digest('hex');
  const root = manager.appendCustomEntry('test:root', {});
  const saved = manager.appendCustomEntry(RECOVERY_ENTRY, {version: 1, scope, ids: ['rs_seed']});
  const payload = {model: model.id, store: false, input: [seed[0]]};
  recovery.reset(ctx);
  const repaired = recovery.beforeRequest(payload, ctx) as Wire;
  assert.equal(repaired.input[0].id, undefined); assert.equal(payload.input[0].id, 'rs_seed');
  assert.equal(repaired.input[0].encrypted_content, payload.input[0].encrypted_content);
  model.baseUrl = 'https://another.invalid/v1';
  assert.equal(recovery.beforeRequest(payload, ctx), undefined, 'different endpoint does not inherit isolation');
  model.baseUrl = 'https://endpoint.invalid/v1';
  manager.branch(root); binding.bind(ctx); recovery.reset(ctx);
  assert.equal(recovery.beforeRequest(payload, ctx), undefined, 'sibling branch has no isolation');
  manager.branch(saved); binding.bind(ctx); recovery.reset(ctx);
  assert.ok(recovery.beforeRequest(payload, ctx), 'returning to ancestor record restores isolation');
  const childManager = SessionManager.inMemory('/tmp/suite-recovery-branch');
  const childCtx = {...ctx, sessionManager: childManager} as unknown as ExtensionContext;
  const childBinding = new SessionBinding(); childBinding.bind(childCtx);
  const child = new ResponsesRecovery(childBinding, true); child.reset(childCtx);
  assert.equal(child.beforeRequest(payload, childCtx), undefined, 'child instance owns independent branch records');
  recovery.reset();
  assert.equal(recovery.beforeRequest(payload, ctx), undefined, 'shutdown reset releases isolation and in-flight state');
  const disabled = new ResponsesRecovery(binding, false); disabled.reset(ctx);
  assert.equal(disabled.beforeRequest(payload, ctx), undefined, 'disabled reload leaves raw records untouched');
  assert.equal(manager.getEntry(saved)?.type, 'custom'); assert.equal(payload.input[0].id, 'rs_seed');
});
