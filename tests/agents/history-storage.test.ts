import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_SESSION_VERSION, SessionManager, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { AgentManager } from '../../src/agents/manager.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { AGENT_ENTRY, hydrate, readAgentSession, recordsIn, transcript, transcriptText } from '../../src/agents/records.ts';
import { active, type AgentRecord, type ParentScope } from '../../src/agents/types.ts';

function saveRun(session: SessionManager, id: string, configCwd: string, ownerSessionId: string, text: string): AgentRecord {
  const endLeafId = session.appendMessage(fauxAssistantMessage(text));
  const record: AgentRecord = {
    version: 1, id, runId: id.replace('agent_', 'run_'), type: 'general-purpose', name: id, prompt: 'saved task',
    cwd: session.getCwd(), configCwd, ownerSessionId, anchorEntryId: null, ancestors: [],
    state: 'completed', background: false, persisted: true, createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(), model: 'offline/model', modelSource: 'inherited', thinking: 'off', thinkingSource: 'inherited',
    sessionFile: session.getSessionFile(), endLeafId, result: text,
  };
  session.appendCustomEntry(AGENT_ENTRY, record);
  return record;
}

test('saved agent reads never repair files and reject corrupt storage, invalid leaves and phantom owners', async () => {
  const root = agentDir(), manager = new AgentManager(async () => {}, async () => []);
  try {
    const session = SessionManager.create(root, join(root, 'saved'));
    const saved = saveRun(session, 'agent_00000001', root, 'owner', 'saved output');
    const path = saved.sessionFile!;
    // SDK disk open repairs this complete JSONL without a final newline; history reads must not.
    const content = readFileSync(path, 'utf8').replace(/\n$/, '');
    writeFileSync(path, content);
    const before = statSync(path);
    assert.equal(readAgentSession(path).getSessionId(), session.getSessionId());
    assert.match(transcriptText(transcript(saved)), /saved output/);
    assert.equal(hydrate({...saved, state: 'running', result: undefined}).result, 'saved output');
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);

    const header = session.getHeader(); assert.ok(header);
    const custom = session.getEntries().at(-1); assert.ok(custom?.type === 'custom');
    const invalid = [
      {name: 'future-header', text: JSON.stringify({...header, version: CURRENT_SESSION_VERSION + 1}), error: /unsupported session header/},
      {name: 'missing-header', text: JSON.stringify(custom), error: /unsupported session header/},
      {name: 'broken-json', text: `${content}\n{\n`, error: /Malformed session JSONL/},
      {name: 'future-record', text: `${JSON.stringify(header)}\n${JSON.stringify({...custom, data: {...saved, version: 2}})}`, error: /Invalid agent record/},
      {name: 'bad-record', text: `${JSON.stringify(header)}\n${JSON.stringify({...custom, data: {...saved, ancestors: 'wrong'}})}`, error: /Invalid agent record/},
      {name: 'bad-id', text: `${JSON.stringify(header)}\n${JSON.stringify({...custom, data: {...saved, id: 'unaddressable'}})}`, error: /Invalid agent record/},
    ];
    for (const fixture of invalid) {
      const broken = join(root, `${fixture.name}.jsonl`); writeFileSync(broken, fixture.text);
      assert.throws(() => recordsIn(readAgentSession(broken).getEntries()), fixture.error);
      assert.equal(readFileSync(broken, 'utf8'), fixture.text);
    }
    assert.throws(() => transcript({...saved, endLeafId: 'missing-leaf'}), /Missing history leaf/);
    const missing = join(root, 'absent', 'missing.jsonl');
    assert.throws(() => readAgentSession(missing), /ENOENT/);
    assert.equal(existsSync(join(root, 'absent')), false);

    const orphan = {...saved, id: 'agent_orphan', runId: 'run_orphan', state: 'running' as const, result: undefined};
    manager.restore([orphan, {...orphan, id: 'agent_memory', runId: 'run_memory', sessionFile: undefined}]);
    assert.equal(manager.records().filter(record => active(record.state)).length, 0);
    const recovered = manager.get(orphan.id).record;
    assert.equal(recovered.state, 'failed'); assert.match(recovered.error!, /no longer owned/);
    assert.match(transcriptText(transcript(recovered)), /saved output/);
    assert.throws(() => transcript(manager.get('agent_memory').record), /no saved transcript/);
  } finally { await manager.shutdown(); rmSync(root, {recursive: true, force: true}); }
});

test('one manager discovers cross-workspace cached references and refreshes disk without replacing local edits or executions', async () => {
  const root = agentDir(), projectB = join(root, 'project-b'), target = join(root, 'rpc-target');
  mkdirSync(projectB); mkdirSync(target); process.env.PI_CODING_AGENT_DIR = root;
  const parentA = SessionManager.create(root), parentB = SessionManager.create(projectB);
  parentA.appendMessage(fauxAssistantMessage('parent A')); parentB.appendMessage(fauxAssistantMessage('parent B'));
  let ctx!: ExtensionContext;
  const h = await host({root, sessionManager: parentA, extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); }});
  const gate = Promise.withResolvers<void>();
  const manager = new AgentManager(async run => { await gate.promise; run.record.result = 'live result'; }, async () => []);
  // A new B reader has no child references in memory: discovery must use the default
  // parent file cached by the earlier A query to reach B's external child directory.
  const scopeA: ParentScope = {ctx}, scopeB: ParentScope = {ctx: {
    cwd: projectB, sessionManager: SessionManager.inMemory(projectB), model: ctx.model, modelRegistry: ctx.modelRegistry, thinkingLevel: ctx.thinkingLevel,
    isProjectTrusted: () => ctx.isProjectTrusted(), getSystemPrompt: () => ctx.getSystemPrompt(),
  }};
  const configA = loadConfig(root, root), configB = loadConfig(projectB, root);
  configA.agents.persistSessions = false;
  let events = 0; manager.subscribeEvents(() => { events++; });
  try {
    const childA = SessionManager.create(root);
    const savedA = saveRun(childA, 'agent_0000000a', root, parentA.getSessionId(), 'A result');
    parentA.appendCustomEntry(AGENT_ENTRY, savedA);
    // B's default parent is cached during A's scan; its child is only reachable through this reference.
    const childB = SessionManager.create(target, join(root, 'external-child-sessions'), {parentSession: parentB.getSessionFile()});
    const savedB = saveRun(childB, 'agent_0000000b', projectB, parentB.getSessionId(), 'B actual final');
    parentB.appendCustomEntry(AGENT_ENTRY, {...savedB, state: 'running', result: undefined, endLeafId: undefined});
    assert.equal(manager.records().length, 0, 'cold discovery starts without restore');
    await manager.discover(scopeA, configA);
    assert.equal(manager.get(savedA.id).record.result, 'A result');
    assert.throws(() => manager.get(savedB.id), /No agent/);
    await manager.discover(scopeB, configB);
    const foundB = await manager.lookup(savedB.id, scopeB, configB);
    assert.equal(foundB.run, undefined); assert.equal(foundB.record.state, 'completed');
    assert.equal(foundB.record.result, 'B actual final');
    assert.equal(foundB.record.cwd, target); assert.equal(foundB.record.configCwd, projectB);
    assert.equal(foundB.record.ownerSessionId, parentB.getSessionId());
    assert.match(transcriptText(transcript(foundB.record)), /B actual final/);
    await assert.rejects(manager.lookup(savedA.id, scopeB, configB), /No workspace agent/);

    const originalSize = statSync(savedB.sessionFile!).size;
    const updated = {...savedB, result: 'B refreshed result', endLeafId: childB.appendMessage(fauxAssistantMessage('B refreshed result'))};
    childB.appendCustomEntry(AGENT_ENTRY, updated);
    assert.ok(statSync(savedB.sessionFile!).size > originalSize);
    await manager.discover(scopeB, configB);
    assert.equal(manager.get(savedB.id).record.result, updated.result);
    assert.match(transcriptText(transcript(manager.get(savedB.id).record)), /B refreshed result/);
    manager.restore([{...manager.get(savedB.id).record, individual: {thinking: 'low'}}]);
    await manager.discover(scopeB, configB);
    assert.deepEqual(manager.get(savedB.id).record.individual, {thinking: 'low'});

    const running = await manager.start({prompt: 'live task', background: false}, scopeA, configA);
    parentA.appendCustomEntry(AGENT_ENTRY, {...running.record, state: 'completed', result: 'disk replacement'});
    await manager.discover(scopeA, configA);
    assert.strictEqual(manager.get(running.record.id).run, running);
    assert.equal(manager.get(running.record.id).record.state, 'starting');
    assert.notEqual(manager.get(running.record.id).record.result, 'disk replacement');
    assert.equal(events, 1, 'history discovery does not emit execution or completion events');
    gate.resolve(); assert.equal((await running.done.promise).result, 'live result');
  } finally { gate.resolve(); await manager.shutdown(); await h.dispose(); rmSync(root, {recursive: true, force: true}); }
});
