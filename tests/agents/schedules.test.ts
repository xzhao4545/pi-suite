import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, type FauxResponseFactory, type JsonObject } from '@earendil-works/pi-ai';
import { AgentSessionRuntime, type ExtensionContext, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { nextOccurrence, parseSchedule } from '../../src/agents/schedules/parse.ts';
import { ScheduleStore, schedulePath, type ScheduledAgent } from '../../src/agents/schedules/store.ts';

async function setup(settings = {}) {
  const root = agentDir(); writeFileSync(join(root, 'pi-suite.json'), JSON.stringify(settings));
  let ctx!: ExtensionContext;
  const h = await host({ root, persisted: true, tools: ['agent_start'], extend: pi => {
    pi.on('session_start', (_event, context) => { ctx = context; });
  } });
  return { ...h, root, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}
async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (!await condition()) { if (Date.now() > deadline) throw new Error('Condition not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function call(h: Awaited<ReturnType<typeof host>>, params: JsonObject) {
  h.faux.setResponses([fauxAssistantMessage(fauxToolCall('agent_start', params)), fauxAssistantMessage('registered')]);
  await h.session.prompt('Register this scheduled agent');
  const entry = h.session.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'toolResult');
  assert.ok(entry?.type === 'message' && entry.message.role === 'toolResult');
  return { error: entry.message.isError, text: JSON.stringify(entry.message.content), details: entry.message.details as { schedule?: ScheduledAgent } };
}
function agentType(root: string, model = '', maxTurns = 7) {
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents', 'tick.md'), `---\nname: tick\nextensions: false\nskills: false\nrun_in_background: false\ninherit_context: true\nmax_turns: ${maxTurns}\n${model}---\nSCHEDULE_CHILD`);
}

test('schedule parsing and the shared store reject invalid data, preserve files and claim one occurrence under competing writers', async () => {
  const root = agentDir(), path = schedulePath(root, 'claims'), store = new ScheduleStore(path);
  try {
    const now = Date.now();
    assert.equal(parseSchedule('+30d', now).schedule, new Date(now + 30 * 86_400_000).toISOString());
    assert.equal(parseSchedule('5m', now).intervalMs, 300000);
    assert.equal(parseSchedule('0 0 9 * * 1', now).scheduleType, 'cron');
    for (const input of ['0s', '+0s', '* * * * *', '99 * * * * *', new Date(now - 1000).toISOString()]) assert.throws(() => parseSchedule(input, now), /INVALID_ARGS/);
    assert.equal((await store.snapshot()).jobs.length, 0); assert.equal(existsSync(path), false);
    const job: ScheduledAgent = { id: 'schedule_1234abcd', name: 'claim', ...parseSchedule('+1s', now), request: { type: 'tick', prompt: 'work' },
      enabled: true, createdAt: new Date(now).toISOString(), nextRun: new Date(now + 1000).toISOString(), runCount: 0 };
    await store.add(job);
    const other = new ScheduleStore(path);
    const claims = await Promise.all([store.claim(job.id, job.nextRun!, now + 1000), other.claim(job.id, job.nextRun!, now + 1000)]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await other.snapshot()).jobs[0].enabled, false);
    const valid = readFileSync(path, 'utf8'); writeFileSync(path, '{broken');
    await assert.rejects(store.snapshot(), /SCHEDULE_STORE_INVALID/);
    await assert.rejects(store.remove(job.id), /SCHEDULE_STORE_INVALID/);
    assert.equal(readFileSync(path, 'utf8'), '{broken'); assert.equal(store.current.jobs.length, 1);
    writeFileSync(path, valid); await store.remove(job.id); assert.equal((await other.snapshot()).jobs.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cron keeps its persisted UTC deadline after timezone reload and uses local calendar time for following occurrences', { timeout: 15000 }, async () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2027-01-07T08:00:00Z')});
  const h = await setup();
  try {
    const cron = parseSchedule('0 0 9 * * *');
    assert.equal(nextOccurrence(cron, Date.parse('2027-03-13T14:00:00Z')), '2027-03-14T13:00:00.000Z');
    assert.equal(nextOccurrence(cron, Date.parse('2027-11-06T13:00:00Z')), '2027-11-07T14:00:00.000Z');
    assert.equal(nextOccurrence(parseSchedule('1d'), Date.parse('2027-03-13T14:00:00Z')), '2027-03-14T14:00:00.000Z');
    assert.equal(parseSchedule('2027-03-14T09:00:00-04:00').schedule, '2027-03-14T13:00:00.000Z');
    agentType(h.root);
    const job = (await call(h, {type: 'tick', prompt: 'UTC_DEADLINE', schedule: cron.schedule})).details.schedule!;
    assert.equal(job.nextRun, '2027-01-07T14:00:00.000Z');
    const store = new ScheduleStore(schedulePath(h.root, h.ctx.sessionManager.getSessionId()));
    process.env.TZ = 'UTC';
    await h.session.reload();
    h.faux.setResponses(Array(4).fill(fauxAssistantMessage('timer completed')));
    mock.timers.tick(3600000); await turn();
    assert.equal(h.manager.runs.size, 0, 'the new local 09:00 must not replace the committed 14:00 deadline');
    assert.equal((await store.snapshot()).jobs[0].nextRun, job.nextRun);
    mock.timers.tick(5 * 3600000);
    // Real SDK dispatch and file writes finish asynchronously; advance no more
    // virtual time so this check cannot accidentally admit the next day's run.
    const deadline = performance.now() + 5000;
    while ((await store.snapshot()).jobs[0].runCount !== 1) { assert.ok(performance.now() < deadline, `persisted cron deadline never dispatched: ${JSON.stringify({jobs: store.current.jobs, runs: [...h.manager.runs.values()].map(run => run.record), notices: h.notices})}`); await turn(); }
    const ended = (await store.snapshot()).jobs[0];
    assert.equal(h.manager.runs.size, 1); assert.equal(ended.lastStatus, 'success', ended.lastError);
    assert.equal(ended.lastRun, job.nextRun); assert.equal(ended.nextRun, '2027-01-08T09:00:00.000Z');
    mock.timers.tick(1800000);
    await store.add({id: 'schedule_1234abcd', name: 'missed cadence', ...parseSchedule('1h'), request: {type: 'tick', prompt: 'INTERVAL_PHASE'},
      enabled: true, createdAt: '2027-01-07T12:00:00.000Z', nextRun: '2027-01-07T12:00:00.000Z', runCount: 0});
    await h.session.reload();
    const interval = () => store.snapshot().then(data => data.jobs.find(item => item.id === 'schedule_1234abcd')!);
    assert.equal((await interval()).nextRun, '2027-01-07T15:00:00.000Z', 'recovery skips missed ticks without shifting the hourly phase');
    assert.equal(h.manager.runs.size, 1, 'recovery never replays the missed model work');
    mock.timers.tick(1800000);
    const intervalDeadline = performance.now() + 5000;
    while ((await interval()).runCount !== 1) { assert.ok(performance.now() < intervalDeadline); await turn(); }
    assert.equal((await interval()).nextRun, '2027-01-07T16:00:00.000Z');
    assert.equal(h.manager.runs.size, 2);
  } finally {
    await h.cleanup(); mock.timers.reset();
    if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone;
  }
});

test('native schedule registration validates combinations, offers value-based cancellation and removes the parameter when disabled', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    assert.ok(Object.hasOwn((h.session.getToolDefinition('agent_start')!.parameters as { properties: object }).properties, 'schedule'));
    const conflicts: JsonObject[] = [{ background: false }, { inheritContext: true }, { inheritContext: false }];
    for (const extra of conflicts) {
      const result = await call(h, { prompt: 'later', schedule: '+10m', ...extra }); assert.equal(result.error, true);
    }
    const names = [`${'long-name-'.repeat(6)}first`, `${'long-name-'.repeat(6)}second`];
    const first = (await call(h, { prompt: 'first', name: names[0], schedule: '+30d' })).details.schedule!;
    const second = (await call(h, { prompt: 'second', name: names[1], schedule: '5m' })).details.schedule!;
    assert.ok(first.nextRun); assert.equal(h.manager.runs.size, 0);
    const command = h.session.extensionRunner.getCommand('agents')!;
    let confirmed = '';
    const custom: ExtensionContext['ui']['custom'] = async factory => new Promise(resolve => {
        Promise.resolve(factory(terminal(), h.ctx.ui.theme, {} as never, resolve)).then(view => {
          for (const width of [40, 120]) assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
          view.handleInput?.('\x1b[B'); view.handleInput?.('\r');
        });
      });
    const ctx = { ...h.ctx, ui: { ...h.ctx.ui, custom, confirm: async (_title: string, details: string) => { confirmed = details; return true; } } } as ExtensionCommandContext;
    await command.handler('schedules', ctx);
    assert.match(confirmed, new RegExp(second.id));
    const path = schedulePath(h.root, h.ctx.sessionManager.getSessionId());
    assert.deepEqual((await new ScheduleStore(path).snapshot()).jobs.map(job => job.id), [first.id]);
    writeFileSync(join(h.root, 'pi-suite.json'), JSON.stringify({ agents: { scheduling: false } }));
    await h.session.reload();
    assert.ok(!Object.hasOwn((h.session.getToolDefinition('agent_start')!.parameters as { properties: object }).properties, 'schedule'));
    assert.equal((await call(h, { prompt: 'disabled', schedule: '1s' })).error, true);
    assert.equal(h.manager.runs.size, 0);
    assert.equal((await new ScheduleStore(path).snapshot()).jobs.length, 1);
  } finally { await h.cleanup(); }
});

test('real once/interval/cron timers bypass a saturated pool and use ordinary runs, fire-time type options and result notifications', { timeout: 15000 }, async () => {
  const h = await setup({ agents: { maxConcurrent: 1 } }), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    agentType(h.root);
    const once = (await call(h, { type: 'tick', prompt: 'ONCE', schedule: '+1s' })).details.schedule!;
    const interval = (await call(h, { type: 'tick', prompt: 'INTERVAL', schedule: '1s' })).details.schedule!;
    const cron = (await call(h, { type: 'tick', prompt: 'CRON', schedule: '*/1 * * * * *' })).details.schedule!;
    agentType(h.root, '', 9);
    const respond: FauxResponseFactory = async context => {
      if (getCurrentSystemPrompt(context.messages).includes('SCHEDULE_CHILD')) {
        assert.ok(!JSON.stringify(context.messages).includes('# Parent Conversation Context')); return fauxAssistantMessage('timer result');
      }
      if (JSON.stringify(context.messages).includes('BLOCK_POOL')) { entered.resolve(); await release.promise; }
      return fauxAssistantMessage('received');
    };
    h.faux.setResponses(Array(30).fill(respond));
    const blocking = await h.manager.start({ prompt: 'BLOCK_POOL', name: 'blocker' }, { ctx: h.ctx }, h.config); await entered.promise;
    const queued = await h.manager.start({ prompt: 'QUEUED', name: 'queued' }, { ctx: h.ctx }, h.config);
    assert.equal(queued.record.state, 'queued');
    await until(() => [once, interval, cron].every(job => [...h.manager.runs.values()].some(run => run.record.scheduleId === job.id && run.settled)));
    const scheduled = [...h.manager.runs.values()].filter(run => run.record.scheduleId);
    for (const run of scheduled) {
      assert.equal(run.record.background, true); assert.equal(run.chargedPool, 'background'); assert.equal(run.maxTurns, 9);
      assert.equal(run.record.ownerSessionId, h.ctx.sessionManager.getSessionId()); assert.equal(run.record.state, 'completed', run.record.error);
    }
    assert.equal(queued.record.state, 'queued', 'scheduled runs still charge the same saturated pool');
    assert.ok(h.session.sessionManager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:notification' && JSON.stringify(entry.content).includes('Agent result')));
    const path = schedulePath(h.root, h.ctx.sessionManager.getSessionId());
    await until(async () => (await new ScheduleStore(path).snapshot()).jobs.every(job => job.runCount >= 1));
    const jobs = (await new ScheduleStore(path).snapshot()).jobs;
    assert.equal(jobs.find(job => job.id === once.id)!.enabled, false);
    assert.ok(jobs.every(job => job.runCount >= 1));
    release.resolve(); await blocking.done.promise; await queued.done.promise;
  } finally { release.resolve(); await h.cleanup(); }
});

test('real session new/resume/reload retain only owner schedules; unavailable fire-time models produce a visible error without substitution', { timeout: 15000 }, async () => {
  const root = agentDir(); agentType(root);
  let current = await host({ root, persisted: true, tools: ['agent_start'] });
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({ root, tools: ['agent_start'], sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...current, diagnostics: [] };
  });
  try {
    const job = (await call(current, { type: 'tick', prompt: 'resume timer', schedule: '+2s' })).details.schedule!;
    const original = current.session.sessionFile!, owner = current.session.sessionManager.getSessionId();
    await current.session.reload();
    assert.equal((await new ScheduleStore(schedulePath(root, owner)).snapshot()).jobs[0].nextRun, job.nextRun);
    await runtime.newSession();
    assert.equal((await new ScheduleStore(schedulePath(root, current.session.sessionManager.getSessionId())).snapshot()).jobs.length, 0);
    await runtime.switchSession(original);
    agentType(root, 'model: missing/unavailable\n');
    current.faux.setResponses([fauxAssistantMessage('reported failure')]);
    const path = schedulePath(root, owner);
    await until(() => JSON.parse(readFileSync(path, 'utf8')).jobs[0].lastStatus === 'error');
    assert.equal(agentRuntime().runs.size, 0, 'model resolution never substitutes another provider');
    assert.match((await new ScheduleStore(path).snapshot()).jobs[0].lastError!, /missing\/unavailable/);
    await until(() => current.session.sessionManager.getBranch().some(entry => entry.type === 'custom_message' && JSON.stringify(entry.content).includes('Schedule')));
    await current.idle();
    assert.ok(current.session.sessionManager.getBranch().some(entry => entry.type === 'custom_message' && JSON.stringify(entry.content).includes('Schedule')));
  } finally { await runtime.dispose(); rmSync(root, { recursive: true, force: true }); }
});
