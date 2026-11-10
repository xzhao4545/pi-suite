import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { cleanBranch } from '../../src/runtime/responses/sanitize.ts';
import { encodeTextSignatureV1 } from '@earendil-works/pi-ai/api/responses-signatures';

const assistant = () => ({ ...fauxAssistantMessage('final'), api: 'openai-responses' as const, provider: 'source', model: 'model', responseId: 'resp_old', content: [
  { type: 'thinking' as const, thinking: '', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_old', encrypted_content: 'cipher_old', summary: [] }) },
  { type: 'text' as const, text: 'visible', textSignature: encodeTextSignatureV1('msg_old', 'commentary') },
  { ...fauxToolCall('read', { id: 'business_id', encrypted_content: 'business_cipher' }), id: 'call_a|fc_old' },
] });
const managerWith = (entries: SessionEntry[]) => SessionManager.inMemory(process.cwd(), undefined, [
  { type: 'session', version: 3, id: '00000000-0000-4000-8000-000000000001', timestamp: new Date().toISOString(), cwd: process.cwd() }, ...entries,
]);

test('clean branch materializes edits, keeps compaction/tool checkpoints and pairs calls without mutating source or foreign signatures', () => {
  const source = SessionManager.inMemory();
  source.appendMessage({ role: 'system', content: 'system', sections: { stable: 'instructions' }, toolsAdded: [], timestamp: 1 });
  const omitted = source.appendMessage({ role: 'user', content: 'omitted original', timestamp: 2 });
  const omittedCall = source.appendMessage({ ...assistant(), content: [{ ...fauxToolCall('read', {}), id: 'call_removed|fc_removed' }] });
  source.appendMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'call_removed|fc_removed', content: [{ type: 'text', text: 'retained actual result' }], isError: false, timestamp: 2 });
  const call = source.appendMessage(assistant());
  source.appendMessage({ role: 'toolResult', toolName: 'read', toolCallId: 'call_a|fc_old', content: [{ type: 'text', text: 'real result id=business_id' }], isError: true, timestamp: 3 });
  const reply = source.appendMessage({ ...assistant(), content: [{ type: 'text', text: 'to be replaced', textSignature: 'msg_replaced' }] });
  const leaf = source.appendCompaction('readable compacted history', call, 999);
  source.branch(call); source.appendMessage({ role: 'user', content: 'sibling must not be copied', timestamp: 4 }); source.branch(leaf);
  source.appendContextEdit(omitted, null);
  source.appendContextEdit(omittedCall, null);
  source.appendContextEdit(reply, { content: [{ type: 'text', text: 'replacement', textSignature: encodeTextSignatureV1('msg_edit_old', 'final_answer') }] });
  source.appendMessage({ ...fauxAssistantMessage({ type: 'thinking', thinking: 'foreign', thinkingSignature: 'foreign_signature' }), api: 'anthropic-messages' });
  const before = JSON.stringify(source.getEntries());
  const cleaned = cleanBranch(structuredClone(source.getBranch())), copy = managerWith(cleaned);
  assert.equal(JSON.stringify(source.getEntries()), before);
  const raw = JSON.stringify(copy.getEntries());
  for (const privateValue of ['resp_old', 'rs_old', 'cipher_old', 'msg_old', 'fc_old', 'fc_removed', 'msg_edit_old', 'omitted original', 'to be replaced', 'sibling must not be copied']) assert.ok(!raw.includes(privateValue), privateValue);
  assert.ok(raw.includes('business_id') && raw.includes('business_cipher') && raw.includes('real result'));
  assert.ok(raw.includes('foreign_signature'));
  assert.ok(cleaned.some(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'call_removed'));
  assert.ok(raw.includes('retained actual result'));
  assert.ok(!cleaned.some(entry => entry.type === 'context_edit'));
  assert.equal(copy.getTree().length, 1);
  const compact = cleaned.find(entry => entry.type === 'compaction');
  assert.ok(compact?.type === 'compaction' && compact.firstKeptEntryId === call && compact.systemMessage?.sections?.stable === 'instructions');
  const context = copy.buildSessionProjection().messages;
  const model = { provider: 'target', id: 'different', api: 'openai-responses', input: ['text'], reasoning: true } as never;
  const wire = convertResponsesMessages(model, { messages: context } as never, new Set(['source', 'target']));
  assert.ok(wire.some(item => 'phase' in item && item.phase === 'commentary'));
  assert.ok(wire.some(item => 'phase' in item && item.phase === 'final_answer'));
  const functionCall = wire.find(item => item.type === 'function_call'), result = wire.find(item => item.type === 'function_call_output');
  assert.ok(functionCall?.type === 'function_call' && result?.type === 'function_call_output');
  assert.equal(functionCall.call_id, result.call_id); assert.equal(functionCall.id, undefined);
  copy.branch(call);
  assert.ok(!JSON.stringify(copy.buildSessionProjection()).includes('cipher_old'), 'navigation before compaction cannot restore old private history');
});

test('opaque compaction/deferred context is rejected and call-id collisions remain paired', () => {
  const source = SessionManager.inMemory();
  source.appendMessage({ ...assistant(), content: [{ type: 'thinking', thinking: '', thinkingSignature: JSON.stringify({ type: 'compaction', encrypted_content: 'only-context' }) }] });
  assert.throws(() => cleanBranch(source.getBranch()), /opaque Responses compaction/);
  const deferred = { ...assistant(), deferred: { api: 'openai-responses', provider: 'source', modelId: 'model', id: 'resp_unfinished' } };
  const copy = SessionManager.inMemory(); copy.appendMessage(deferred);
  assert.throws(() => cleanBranch(copy.getBranch()), /unfinished provider-deferred/);
  const collisions = SessionManager.inMemory();
  collisions.appendMessage(assistant());
  collisions.appendMessage({ role: 'toolResult', toolCallId: 'call_a|fc_old', toolName: 'read', content: [], isError: false, timestamp: 1 });
  collisions.appendMessage({ ...assistant(), content: [{ ...fauxToolCall('read', {}), id: 'call_a|fc_another' }] });
  collisions.appendMessage({ role: 'toolResult', toolCallId: 'call_a|fc_another', toolName: 'read', content: [], isError: false, timestamp: 2 });
  const cleaned = cleanBranch(collisions.getBranch());
  const ids = cleaned.flatMap(entry => entry.type === 'message' && entry.message.role === 'assistant' ? entry.message.content.filter(block => block.type === 'toolCall').map(block => block.id) : []);
  const results = cleaned.flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : []);
  assert.equal(new Set(ids).size, 2); assert.deepEqual(ids, results);
});
