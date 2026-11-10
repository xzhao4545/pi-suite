import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { normalizeContext, type AssistantMessage, type JsonObject, type Model, type StreamFunction, type StreamOptions } from '@earendil-works/pi-ai';
import { stream as openaiStream } from '@earendil-works/pi-ai/api/openai-responses';
import { stream as azureStream } from '@earendil-works/pi-ai/api/azure-openai-responses';
import { stream as codexStream, closeOpenAICodexWebSocketSessions, resetOpenAICodexWebSocketDebugStats } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { encodeTextSignatureV1, parseTextSignature } from '@earendil-works/pi-ai/api/responses-signatures';
import { convertToLlm, SessionManager } from '@earendil-works/pi-coding-agent';
import { cleanBranch } from '../../src/runtime/responses/sanitize.ts';

type ResponsesApi = 'openai-responses' | 'azure-openai-responses' | 'openai-codex-responses';
type WireItem = JsonObject & { type?: string; id?: string; role?: string };
type WireRequest = { type?: string; input: WireItem[]; previous_response_id?: string; prompt_cache_key?: string;
  store: boolean; include: string[]; stream: boolean };
type CapturedRequest = { body: WireRequest; headers: IncomingHttpHeaders; path: string; connection?: number };
const env = { HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '',
  NO_PROXY: '*', no_proxy: '*', PI_CACHE_RETENTION: 'short', AZURE_OPENAI_DEPLOYMENT_NAME_MAP: '' };
// Deliberately unsigned, local-only fixture: Codex only reads the account claim at this boundary.
const codexKey = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'local-account' } })).toString('base64')}.unsigned`;

function model<TApi extends ResponsesApi>(api: TApi, baseUrl: string): Model<TApi> {
  return { api, provider: api === 'openai-responses' ? 'openai' : api === 'azure-openai-responses' ? 'azure' : 'openai-codex',
    id: 'gpt-5.4', name: 'Local Responses', baseUrl, reasoning: true, input: ['text'],
    contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

function responseFixture(label: string, terminalEncryptionOnly = false) {
  const reasoning: WireItem = { type: 'reasoning', id: `rs_${label}`, summary: [], encrypted_content: `encrypted_${label}` };
  const message: WireItem = { type: 'message', role: 'assistant', id: `msg_${label}`, phase: 'commentary', status: 'completed',
    content: [{ type: 'output_text', text: `answer ${label}`, annotations: [] }] };
  const call: WireItem = { type: 'function_call', id: `fc_${label}`, call_id: `call_${label}`, name: 'lookup', arguments: '{"query":"new work"}' };
  const output = [reasoning, message, call];
  const events: JsonObject[] = [{ type: 'response.created', response: { id: `resp_${label}`, status: 'in_progress', output: [] } }];
  output.forEach((item, output_index) => {
    const { encrypted_content: _encrypted, ...unencrypted } = item;
    const done = terminalEncryptionOnly && item.type === 'reasoning' ? unencrypted : item;
    events.push({ type: 'response.output_item.added', output_index,
      item: item.type === 'reasoning' ? unencrypted : { ...item, ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
    if (item.type === 'message') events.push({ type: 'response.output_text.delta', output_index, content_index: 0, delta: `answer ${label}` });
    if (item.type === 'function_call') events.push({ type: 'response.function_call_arguments.delta', output_index, delta: call.arguments! });
    events.push({ type: 'response.output_item.done', output_index, item: done });
  });
  events.push({ type: 'response.completed', response: { id: `resp_${label}`, status: 'completed', output,
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1 } } } });
  return { output, events };
}

/** Small RFC 6455 peer, not a fake client: Node's real WebSocket performs the HTTP upgrade and masking. */
function websocketPeer(socket: Duplex, head: Buffer, reply: (body: WireRequest) => JsonObject[]) {
  let pending: Buffer = Buffer.alloc(0);
  const send = (opcode: number, payload: Buffer) => {
    assert.ok(payload.length < 65536, 'fixture frames fit the 16-bit wire length');
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
    header[0] = 0x80 | opcode;
    header[1] = payload.length < 126 ? payload.length : 126;
    if (header.length === 4) header.writeUInt16BE(payload.length, 2);
    socket.write(Buffer.concat([header, payload]));
  };
  const receive = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      assert.ok(pending[0] & 0x80, 'controlled requests use unfragmented frames');
      assert.ok(pending[1] & 0x80, 'client frames must be masked');
      const opcode = pending[0] & 0xf, size = pending[1] & 0x7f;
      assert.notEqual(size, 127, 'fixture requests fit the 16-bit wire length');
      const headerLength = size === 126 ? 4 : 2;
      if (pending.length < headerLength + 4) return;
      const length = size === 126 ? pending.readUInt16BE(2) : size;
      if (pending.length < headerLength + 4 + length) return;
      const mask = pending.subarray(headerLength, headerLength + 4);
      const payload = Buffer.from(pending.subarray(headerLength + 4, headerLength + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      pending = pending.subarray(headerLength + 4 + length);
      if (opcode === 8) { send(8, payload); socket.end(); return; }
      assert.equal(opcode, 1, 'only response.create text frames are expected');
      for (const event of reply(JSON.parse(payload.toString()))) send(1, Buffer.from(JSON.stringify(event)));
    }
  };
  socket.on('data', receive);
  if (head.length) receive(head);
}

async function localTransport(t: TestContext, terminalEncryptionOnly = false) {
  const requests: CapturedRequest[] = [], upgrades: Omit<CapturedRequest, 'body'>[] = [], sockets = new Set<Duplex>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as WireRequest;
    requests.push({ body, headers: request.headers, path: request.url! });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of responseFixture(`turn${requests.length}`, terminalEncryptionOnly).events) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  server.on('upgrade', (request, socket, head) => {
    const connection = upgrades.length + 1;
    upgrades.push({ headers: request.headers, path: request.url!, connection });
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    websocketPeer(socket, head, body => {
      requests.push({ body, headers: request.headers, path: request.url!, connection });
      return responseFixture(`turn${requests.length}`).events;
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  // Inspect actual HTTP at the server, not onPayload. The fetch override only restricts destinations;
  // redirects and accidental external URLs fail rather than ever reaching the network.
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, origin, 'transport must stay on the local fixture');
    return globalThis.fetch(input, { ...init, redirect: 'error' });
  };
  return { origin, requests, upgrades, fetch };
}

function sessions(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pi-responses-transport-'));
  const create = () => {
    const manager = SessionManager.create(root, join(root, 'sessions'));
    // Clean only the cache belonging to this test, never other sessions in this process.
    t.after(() => { closeOpenAICodexWebSocketSessions(manager.getSessionId()); resetOpenAICodexWebSocketDebugStats(manager.getSessionId()); });
    return manager;
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fork = (source: SessionManager, clean: boolean) => {
    const file = source.getSessionFile()!;
    const original = readFileSync(file, 'utf8');
    // Native prepared fork mutates its manager; open a separate handle to keep the live source/cache.
    const copy = SessionManager.open(file);
    const target = copy.createBranchedSession(copy.getLeafId()!, clean ? cleanBranch(structuredClone(copy.getBranch())) : undefined);
    assert.ok(target);
    assert.equal(readFileSync(file, 'utf8'), original, 'source JSONL is never rewritten');
    const fresh = SessionManager.open(target);
    assert.notEqual(fresh.getSessionId(), source.getSessionId());
    assert.equal(fresh.getHeader()?.parentSession, file);
    t.after(() => { closeOpenAICodexWebSocketSessions(fresh.getSessionId()); resetOpenAICodexWebSocketDebugStats(fresh.getSessionId()); });
    return fresh;
  };
  return { create, fork };
}

function seed(source: SessionManager, target: Model<ResponsesApi>) {
  source.appendMessage({ role: 'system', content: 'Local protocol test', timestamp: 1, toolsAdded: [
    { name: 'lookup', description: 'Look up a value', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  ] });
  source.appendMessage({ role: 'user', content: 'old request', timestamp: 2 });
  source.appendMessage({ role: 'assistant', api: target.api, provider: target.provider, model: target.id, responseId: 'resp_old',
    content: [
      { type: 'thinking', thinking: 'readable old reasoning', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_old', summary: [], encrypted_content: 'encrypted_old' }) },
      { type: 'thinking', thinking: '', redacted: true, thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_redacted_old', summary: [], encrypted_content: 'encrypted_redacted_old' }) },
      { type: 'text', text: 'old commentary', textSignature: encodeTextSignatureV1('msg_old', 'commentary') },
      { type: 'text', text: 'old final', textSignature: encodeTextSignatureV1('msg_final_old', 'final_answer') },
      { type: 'text', text: 'old legacy text', textSignature: 'msg_legacy_old' },
      { type: 'toolCall', id: 'call_old|fc_old', name: 'lookup', arguments: { query: 'business rs_business' }, thoughtSignature: 'thought_old' },
    ], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: 3 });
  toolResult(source, 'call_old|fc_old', 'old result');
  // Exercise the public phase conversion patch as well as same-provider sanitation.
  source.appendMessage({ role: 'assistant', api: 'openai-responses', provider: 'foreign-responses', model: 'foreign-model',
    content: [{ type: 'text', text: 'foreign final', textSignature: encodeTextSignatureV1('msg_foreign_old', 'final_answer') }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: 5 });
}

function toolResult(manager: SessionManager, toolCallId: string, text: string) {
  manager.appendMessage({ role: 'toolResult', toolCallId, toolName: 'lookup', content: [{ type: 'text', text }], isError: false, timestamp: 4 });
}

async function turn<TApi extends ResponsesApi>(adapter: StreamFunction<TApi, StreamOptions & { reasoningEffort?: 'medium' }>, target: Model<TApi>, manager: SessionManager,
  transport: Awaited<ReturnType<typeof localTransport>>, mode: 'sse' | 'websocket' | 'websocket-cached', prompt: string): Promise<AssistantMessage> {
  manager.appendMessage({ role: 'user', content: prompt, timestamp: Date.now() });
  const stream = adapter(target, normalizeContext({ messages: convertToLlm(manager.buildSessionContext().messages) }), {
    apiKey: target.api === 'openai-codex-responses' ? codexKey : 'local-not-a-credential', sessionId: manager.getSessionId(),
    fetch: transport.fetch, env: { ...env, AZURE_OPENAI_BASE_URL: `${transport.origin}/openai/v1`, AZURE_OPENAI_API_VERSION: 'v1' },
    transport: mode, maxRetries: 0, timeoutMs: 1500, websocketConnectTimeoutMs: 1000, signal: AbortSignal.timeout(2500),
    reasoningEffort: 'medium',
  });
  const events: string[] = [];
  for await (const event of stream) events.push(event.type);
  const message = await stream.result();
  assert.equal(message.stopReason, 'toolUse', message.errorMessage);
  assert.equal(message.diagnostics?.length ?? 0, 0, 'no hidden WebSocket-to-SSE fallback');
  assert.ok(events.includes('text_delta') && events.includes('toolcall_delta'));
  assert.equal(events[0], 'start'); assert.equal(events.at(-1), 'done');
  manager.appendMessage(message);
  const call = message.content.find(block => block.type === 'toolCall'); assert.ok(call);
  toolResult(manager, call.id, 'new result');
  return message;
}

function assertCleanRequest(request: WireRequest, manager: SessionManager) {
  assert.equal(request.previous_response_id, undefined);
  assert.equal(request.prompt_cache_key, manager.getSessionId());
  assert.equal(request.store, false); assert.equal(request.stream, true);
  assert.deepEqual(request.include, ['reasoning.encrypted_content']);
  assert.ok(!request.input.some(item => item.type === 'reasoning'), 'old readable/redacted reasoning is not replayed as private items');
  for (const id of ['resp_old', 'rs_old', 'rs_redacted_old', 'encrypted_old', 'encrypted_redacted_old', 'msg_old', 'msg_final_old', 'msg_legacy_old', 'msg_foreign_old', 'fc_old', 'thought_old']) {
    assert.ok(!JSON.stringify(request).includes(`"${id}"`), `old private value ${id} must not reach the wire`);
  }
  const texts = request.input.filter(item => item.type === 'message' && item.role === 'assistant');
  assert.deepEqual(texts.map(item => item.phase), ['commentary', 'final_answer', undefined, 'final_answer']);
  assert.ok(texts.every(item => item.id?.startsWith('msg_pi_')));
  assert.deepEqual(texts.map(item => (item.content as JsonObject[])[0].text), ['old commentary', 'old final', 'old legacy text', 'foreign final']);
  const call = request.input.find(item => item.type === 'function_call'); assert.ok(call);
  assert.equal(call.id, undefined); assert.equal(call.call_id, 'call_old');
  assert.deepEqual(JSON.parse(call.arguments as string), { query: 'business rs_business' });
  assert.deepEqual(request.input.find(item => item.type === 'function_call_output'), { type: 'function_call_output', call_id: 'call_old', output: 'old result' });
  const old = manager.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'assistant');
  assert.ok(old?.type === 'message' && old.message.role === 'assistant');
  assert.equal(old.message.responseId, undefined);
  assert.deepEqual(old.message.content.filter(block => block.type === 'thinking'), [{ type: 'thinking', thinking: 'readable old reasoning' }]);
}

function assertNewReplay(request: WireRequest, label: string) {
  const expected = responseFixture(label).output;
  assert.deepEqual(request.input.find(item => item.type === 'reasoning'), expected[0]);
  assert.deepEqual(request.input.find(item => item.id === `msg_${label}`), expected[1]);
  assert.deepEqual(request.input.find(item => item.id === `fc_${label}`), expected[2]);
  assert.deepEqual(request.input.find(item => item.call_id === `call_${label}` && item.type === 'function_call_output'),
    { type: 'function_call_output', call_id: `call_${label}`, output: 'new result' });
}

function assertPersistedReply(manager: SessionManager, label: string) {
  const reopened = SessionManager.open(manager.getSessionFile()!);
  const entry = reopened.getBranch().find(entry => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.responseId === `resp_${label}`);
  assert.ok(entry?.type === 'message' && entry.message.role === 'assistant');
  const reasoning = entry.message.content.find(block => block.type === 'thinking'); assert.ok(reasoning);
  assert.deepEqual(JSON.parse(reasoning.thinkingSignature!), responseFixture(label).output[0]);
  const text = entry.message.content.find(block => block.type === 'text'); assert.ok(text);
  assert.deepEqual(parseTextSignature(text.textSignature), { id: `msg_${label}`, phase: 'commentary' });
}

test('OpenAI/Azure SSE: a persisted clean fork strips old private state once and replays new items on turn two', { timeout: 8000 }, async t => {
  const storage = sessions(t);
  for (const api of ['openai-responses', 'azure-openai-responses'] as const) {
    const local = await localTransport(t, api === 'azure-openai-responses');
    const target = model(api, `${local.origin}/v1`);
    const run = (manager: SessionManager, prompt: string) => api === 'openai-responses'
      ? turn(openaiStream, { ...target, api: 'openai-responses' }, manager, local, 'sse', prompt)
      : turn(azureStream, { ...target, api: 'azure-openai-responses' }, manager, local, 'sse', prompt);
    const source = storage.create(); seed(source, target);
    const fresh = storage.fork(source, true);
    await run(fresh, 'first clean turn');
    assert.equal(local.requests.length, 1); assertCleanRequest(local.requests[0].body, fresh);
    assertPersistedReply(fresh, 'turn1');
    // Reopen between turns so replay is proven from durable JSONL, not just live adapter output.
    await run(SessionManager.open(fresh.getSessionFile()!), 'second turn');
    assert.equal(local.requests.length, 2); assertNewReplay(local.requests[1].body, 'turn1');
    assert.equal(local.requests[1].body.previous_response_id, undefined);
    assert.equal(local.requests[0].headers[api === 'openai-responses' ? 'authorization' : 'api-key'],
      api === 'openai-responses' ? 'Bearer local-not-a-credential' : 'local-not-a-credential');
    assert.match(local.requests[0].path, api === 'openai-responses' ? /^\/v1\/responses$/ : /^\/openai\/v1\/responses\?api-version=v1$/);
    assert.equal(local.upgrades.length, 0);
  }
});

test('Codex WebSocket: clean fork sends two real full-context frames and retains fresh encrypted reasoning/items', { timeout: 8000 }, async t => {
  const local = await localTransport(t), storage = sessions(t), target = model('openai-codex-responses', local.origin);
  const source = storage.create(); seed(source, target);
  const fresh = storage.fork(source, true);
  await turn(codexStream, target, fresh, local, 'websocket', 'first clean turn');
  assertCleanRequest(local.requests[0].body, fresh); assertPersistedReply(fresh, 'turn1');
  await turn(codexStream, target, SessionManager.open(fresh.getSessionFile()!), local, 'websocket', 'second turn');
  assert.equal(local.requests.length, 2); assertNewReplay(local.requests[1].body, 'turn1');
  assert.equal(local.requests[1].body.previous_response_id, undefined);
  assert.equal(local.upgrades.length, 1, 'same-session socket is reused even without context caching');
  assert.ok(local.requests.every(request => request.connection === 1 && request.body.type === 'response.create'));
  assert.equal(local.upgrades[0].path, '/codex/responses');
  assert.equal(local.upgrades[0].headers['session-id'], fresh.getSessionId());
  assert.equal(local.upgrades[0].headers['chatgpt-account-id'], 'local-account');
  assert.equal(local.upgrades[0].headers.authorization, `Bearer ${codexKey}`);
});

test('Codex cached WebSocket: clean fork continues its own response; identical-history new session cannot inherit previous_response_id', { timeout: 8000 }, async t => {
  const local = await localTransport(t), storage = sessions(t), target = model('openai-codex-responses', local.origin);
  const source = storage.create(); seed(source, target);
  // Keep a real source continuation/socket alive while the detached clean fork runs.
  await turn(codexStream, target, source, local, 'websocket-cached', 'warm source cache');
  const fresh = storage.fork(source, true);
  await turn(codexStream, target, fresh, local, 'websocket-cached', 'first clean turn');
  const first = local.requests[1];
  assert.equal(first.body.previous_response_id, undefined); assert.equal(first.connection, 2);
  assert.ok(!first.body.input.some(item => item.type === 'reasoning'));
  assert.ok(!JSON.stringify(first.body).includes('encrypted_turn1'));
  assert.equal(first.headers['session-id'], fresh.getSessionId());
  assertPersistedReply(fresh, 'turn2');
  await turn(codexStream, target, fresh, local, 'websocket-cached', 'second fork turn');
  const second = local.requests[2];
  assert.equal(second.connection, 2); assert.equal(second.body.previous_response_id, 'resp_turn2');
  assert.deepEqual(second.body.input, [
    { type: 'function_call_output', call_id: 'call_turn2', output: 'new result' },
    { role: 'user', content: [{ type: 'input_text', text: 'second fork turn' }] },
  ]);
  assertPersistedReply(fresh, 'turn3');
  // No sanitation here: exact same prefix could satisfy the old cache's delta matcher.
  // Only a genuinely new session/cache key/connection prevents resp_turn3 being inherited.
  const another = storage.fork(fresh, false);
  await turn(codexStream, target, another, local, 'websocket-cached', 'new session turn');
  const independent = local.requests[3];
  assert.equal(independent.body.previous_response_id, undefined);
  assert.equal(independent.connection, 3); assert.equal(independent.headers['session-id'], another.getSessionId());
  assert.equal(independent.body.prompt_cache_key, another.getSessionId());
  assertNewReplay(independent.body, 'turn2');
  assert.ok(independent.body.input.some(item => item.id === 'rs_turn3'));
  assert.equal(local.requests.length, 4); assert.equal(local.upgrades.length, 3);
  assert.ok(local.requests.every(request => request.connection && request.body.type === 'response.create' && request.body.store === false));
});
