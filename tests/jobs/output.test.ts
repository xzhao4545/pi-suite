import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {agentDir, manager, owner, testShell} from '../support/jobs.ts';
import {shellArgument} from '../../src/jobs/launch/presets.ts';
import {readJobLog} from '../../src/jobs/output.ts';
import {normalizeVisibleText} from '../../src/jobs/terminal/visible-text.ts';

test('real PTY reads mask password echoes across raw pages, preserve redraws and publish one bounded final preview', {timeout: 15000}, async () => {
  const root = agentDir(), jobs = manager(root), secret = 'PRIVATE_PASSWORD_中文';
  const script = String.raw`process.stdout.write('\x1b[32mabcdef\x1b[3DXYZ\x1b[K\x1b[0m\n');
process.stdout.write('tick\ntick\n');
process.stdout.write('\x1b[?1049hfull-screen\x1b[?1049l\nPassword: ');
process.stdin.once('data',()=>{process.stdout.write('accepted\n');process.exit(0);});`;
  try {
    assert.equal(normalizeVisibleText('中文\x1b[3GXY\x1b[K\n'), '中XY\n');
    assert.equal(normalizeVisibleText('abc\bX\n'), 'abX\n');
    const job = await jobs.start({...owner, cwd: root, mode: 'pty', command: [process.execPath, '-e', script].map(shellArgument).join(' ')}, testShell());
    const path = jobs.logPath(job, 'output');
    const deadline = Date.now() + 5000;
    while (!readFileSync(path, 'utf8').includes('Password:')) { assert.ok(Date.now() < deadline); await delay(10); }
    jobs.write(job.id, secret + '\r', {source: 'model', kind: 'text', text: secret, sensitive: true});
    const ended = await jobs.wait(job.id), raw = readFileSync(path);
    assert.ok(raw.includes(Buffer.from(secret)), 'original program output remains on disk');
    assert.ok(!readFileSync(jobs.logPath(job, 'input'), 'utf8').includes(secret));
    const page = await readJobLog(jobs, ended, undefined, {});
    assert.match(page.text, /abcXYZ/); assert.match(page.text, /tick  \[×2\]/);
    assert.match(page.text, /Full-screen terminal output/); assert.match(page.text, /Password:/);
    assert.match(page.text, /accepted/); assert.ok(!page.text.includes(secret));
    const at = raw.indexOf(Buffer.from(secret)), partial = await readJobLog(jobs, ended, 'output', {offset: at + 3, limitBytes: 8});
    assert.equal(partial.offset, at + 3); assert.equal(partial.nextOffset, at + 11);
    assert.ok(!partial.text.includes('VATE') && !partial.text.includes('PASSWORD'));
    const found = await readJobLog(jobs, ended, 'output', {offset: at, search: 'PRIVATE_PASSWORD', context: 1});
    assert.equal(found.matches, 0); assert.ok(!found.text.includes(secret));
    assert.ok(ended.fullScreen); assert.ok(Buffer.byteLength(ended.outputPreview!) <= 2048);
    assert.ok(!ended.outputPreview!.includes(secret)); assert.match(ended.outputPreview!, /accepted/);
    const stopping = await jobs.start({...owner, cwd: root, command: 'echo stop-output; read line'}, testShell());
    const stoppingLog = jobs.logPath(stopping, 'stdout');
    while (!readFileSync(stoppingLog, 'utf8').includes('stop-output')) await delay(10);
    const stopped = await jobs.stop(stopping.id);
    assert.equal(stopped.job.state, 'stopped'); assert.match(stopped.job.outputPreview!, /stop-output/);
  } finally { await jobs.shutdown(Date.now() + 5000); rmSync(root, {recursive: true, force: true}); }
});
