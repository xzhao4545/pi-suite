import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { visibleWidth } from '@earendil-works/pi-tui';
import { JobLogView } from '../../src/jobs/log-viewer.ts';
import { shellArgument } from '../../src/jobs/launch/presets.ts';
import { listJobs } from '../../src/jobs/query.ts';
import { resolveWorkspace } from '../../src/jobs/workspace.ts';
import { manager, owner, settled, testShell } from '../support/jobs.ts';
import { terminal } from '../support/terminal.ts';

const nodeCommand = (script: string) => [process.execPath, '-e', script].map(shellArgument).join(' ');
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, 'expected log output'); await sleep(25); }
}

test('live log follows only at the bottom, preserves search, finishes split UTF-8 and survives closing', { timeout: 20000 }, async () => {
  const jobs = manager(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-log-view-'));
  let view: JobLogView | undefined;
  try {
    const job = await jobs.start({ ...owner, cwd, command: nodeCommand(`
for(let i=0;i<40;i++)process.stdout.write('line-'+i+'\\n');
process.stdin.on('data',data=>{const command=data.toString().trim();
if(command==='partial')process.stdout.write(Buffer.from([0xe4]));
else if(command==='finish'){process.stdout.write(Buffer.from([0xb8,0xad,0x0a]));process.stdout.write('final line\\n');process.exit(0);}
else process.stdout.write(command+'\\n');});`) }, testShell());
    const log = jobs.logPath(job, 'stdout');
    await until(() => readFileSync(log, 'utf8').includes('line-39'));
    view = new JobLogView(terminal(24, 120), jobs, jobs.peek(job.id), 'stdout', true, () => {});
    await view.initialize();
    assert.ok(view.render(120).some(line => line.includes('line-39'))); assert.equal(view.reader.atBottom, true);
    view.handleInput('\x1b[H'); // Home pauses following without changing the source.
    view.render(120); const offset = view.reader.offset;
    jobs.write(job.id, 'new output\n', { source: 'model', kind: 'text' });
    await until(() => readFileSync(log, 'utf8').includes('new output'));
    await view.refresh();
    assert.equal(view.reader.offset, offset);
    assert.ok(!view.render(120).some(line => line.includes('new output')));
    view.handleInput('/'); view.handleInput('line-3');
    await view.refresh(); assert.equal(view.reader.search.getValue(), 'line-3');
    view.handleInput('\x1b'); view.handleInput('\x1b[F'); // Leave search; End resumes following.
    await view.refresh(); assert.ok(view.render(120).some(line => line.includes('new output')));

    jobs.write(job.id, 'partial\n', { source: 'model', kind: 'text' });
    await until(() => readFileSync(log).at(-1) === 0xe4);
    await view.refresh(); assert.ok(!view.render(120).join('\n').includes('\ufffd'));
    view.dispose(); assert.equal(jobs.peek(job.id).state, 'running', 'closing a reader never stops the job');
    view = new JobLogView(terminal(24, 120), jobs, jobs.peek(job.id), 'stdout', true, () => {});
    await view.initialize(); view.render(120);
    view.handleInput('\x1b[H'); view.render(120);
    jobs.write(job.id, 'finish\n', { source: 'model', kind: 'text' });
    await settled(jobs, job.id);
    assert.ok(!view.render(120).some(line => line.includes('final line')));
    view.handleInput('\x1b[F');
    await until(() => view!.render(120).some(line => line.includes('final line')));
    assert.ok(view.render(120).some(line => line.includes('中')));
  } finally { view?.dispose(); await jobs.shutdown(Date.now() + 5000); }
});

test('history reads a bounded tail and preceding/next byte windows as literal text at every width', { timeout: 20000 }, async () => {
  const jobs = manager(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-log-history-'));
  let view: JobLogView | undefined;
  try {
    const content = Array.from({ length: 2000 }, (_, i) => `行${i} ${'x'.repeat(90)}\n`).join('') + '```\n# literal heading\n';
    const path = join(cwd, 'fixture'); writeFileSync(path, content);
    const job = await jobs.start({ ...owner, cwd, command: `cat ${shellArgument(path)}` }, testShell());
    const done = await settled(jobs, job.id);
    view = new JobLogView(terminal(24, 120), jobs, done, 'stdout', false, () => {});
    await view.initialize();
    const tail = view.render(120).join('\n');
    assert.match(tail, /# literal heading/); assert.match(tail, /```/);
    await view.previous();
    const middle = view.render(120).join('\n'); assert.ok(!middle.includes('literal heading'));
    await view.previous(); view.render(120);
    await view.previous();
    assert.ok(view.render(120).some(line => line.startsWith('行0 ')), 'the first byte window remains available');
    await view.next(); assert.ok(!view.render(120).some(line => line.startsWith('行0 ')));
    await view.follow();
    for (const width of [40, 60, 120]) {
      const lines = view.render(width);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(lines.length <= Math.floor(24 * 0.8));
    }
    assert.equal(jobs.peek(job.id).state, 'completed');
  } finally { view?.dispose(); await jobs.shutdown(Date.now() + 5000); }
});

test('job list cursors remain stable when new jobs arrive; finished details and scopes stay readable', { timeout: 20000 }, async () => {
  const jobs = manager(), cwd = mkdtempSync(join(tmpdir(), 'pi-suite-job-list-'));
  try {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const job = await jobs.start({ ...owner, cwd, command: 'true' }, testShell());
      await settled(jobs, job.id); ids.push(job.id);
    }
    const workspace = await resolveWorkspace(cwd), query = { state: 'finished', scope: 'session', sessionId: owner.ownerSessionId, limit: 2 } as const;
    const first = await listJobs(jobs, workspace, query); assert.ok(first.nextCursor);
    const newest = await jobs.start({ ...owner, cwd, command: 'true' }, testShell());
    await settled(jobs, newest.id);
    const newcomer = await jobs.start({ ...owner, cwd, command: 'true', ownerSessionId: 'other' }, testShell());
    await settled(jobs, newcomer.id);
    const second = await listJobs(jobs, workspace, { ...query, cursor: first.nextCursor });
    const third = await listJobs(jobs, workspace, { ...query, cursor: second.nextCursor });
    assert.deepEqual([...first.rows, ...second.rows, ...third.rows].map(row => row.job.id), ids.reverse());
    assert.equal(third.nextCursor, undefined);
    assert.equal((await listJobs(jobs, workspace, { ...query, scope: 'workspace', limit: 20 })).rows.length, 7);
    assert.equal((await jobs.get(newcomer.id, workspace)).job.state, 'completed');
    assert.deepEqual((await listJobs(jobs, workspace, { ...query, state: 'active' })).rows, []);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});
