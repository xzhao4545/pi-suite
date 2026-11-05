import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveWorkspace } from "../../src/jobs/workspace.ts";
import { agentDir, manager, owner, settled, testShell } from "../support/jobs.ts";
import { shellArgument } from "../../src/jobs/launch/presets.ts";

const shell = testShell();
const cwd = () => mkdtempSync(join(tmpdir(), "pi-suite-job-cwd-"));
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: { code?: string }) => error.code === code);

test("pipe job records stdout/stderr, exit code and monotonic elapsed time", { timeout: 20000 }, async () => {
  const jobs = manager();
  try {
    const started = await jobs.start({ command: "echo out; echo err >&2; exit 3", cwd: cwd(), ...owner }, shell);
    // start() returns after the record is saved; a fast command may already have exited by then.
    assert.match(started.id, /^job_[a-f0-9]{8}$/); assert.notEqual(started.state, "starting");
    const job = await settled(jobs, started.id);
    assert.equal(job.state, "failed"); assert.equal(job.exitCode, 3);
    assert.equal(job.cleanup.state, "not_required"); assert.ok(job.elapsedMs! >= 0 && job.endedAt);
    assert.equal(readFileSync(jobs.logPath(job, "stdout"), "utf8").trim(), "out");
    assert.equal(readFileSync(jobs.logPath(job, "stderr"), "utf8").trim(), "err");
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test("pipe stdin input is recorded; sensitive input keeps no text; settled jobs refuse input", { timeout: 20000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ command: "read a; read b; echo \"$a/$b\"", cwd: cwd(), ...owner }, shell);
    jobs.write(id, "first\n", { source: "model", kind: "text", text: "first" });
    jobs.write(id, "secret\n", { source: "model", kind: "text", text: "secret", sensitive: true });
    const job = await settled(jobs, id);
    assert.equal(job.state, "completed");
    assert.equal(readFileSync(jobs.logPath(job, "stdout"), "utf8").trim(), "first/secret");
    await sleep(50);
    const records = readFileSync(jobs.logPath(job, "input"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(records[0].text, "first"); assert.equal(records[1].sensitive, true);
    assert.equal("text" in records[1], false); assert.equal(records[1].bytes, 7);
    assert.throws(() => jobs.write(id, "late\n", { source: "model", kind: "text" }), (error: { code?: string }) => error.code === "NOT_RUNNING");
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test("stop confirms the managed tree; repeated stop joins; a settled job is not stopped again", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ command: "sleep 30 & sleep 30; wait", cwd: cwd(), ...owner }, shell);
    await sleep(300);
    const [first, second] = await Promise.all([jobs.stop(id), jobs.stop(id)]);
    assert.equal(first.requested, true); assert.equal(second.requested, true);
    assert.equal(first.job.state, "stopped"); assert.equal(first.job.stopReason, "user");
    assert.equal(first.job.cleanup.state, "managed_scope_confirmed", first.job.cleanup.error);
    assert.equal(first.job.exitCode === 0, false, "a stopped job never reports success");
    const done = await jobs.start({ command: "true", cwd: cwd(), ...owner }, shell);
    await settled(jobs, done.id);
    const again = await jobs.stop(done.id);
    assert.equal(again.requested, false); assert.equal(again.job.state, "completed");
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test('Linux stop and exit cleanup include tool descendants in another session without stopping another job', {timeout: 20000}, async () => {
  if (process.platform !== 'linux') return;
  for (const [mode, sync] of [['pipe', false], ['pty', false], ['pipe', true]] as const) {
    const jobs = manager(), work = cwd(), marker = join(work, 'tool-pids.json'), orphanMarker = join(work, 'orphan-pid');
    let pids: number[] = [];
    // A CLI tool owns another session and ignores TERM, while its parent exits on TERM.
    // The stopper must retain the tool's identity before that ancestry disappears.
    const tool = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
const leaf=spawn('sleep',['30'],{stdio:'ignore'});
writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,leaf.pid]));
process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
    // A reparented member of the original group must remain managed as well.
    const orphan = `sleep 30 </dev/null >/dev/null 2>&1 & echo $! > ${shellArgument(orphanMarker)}`;
    const cli = `const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify(tool)}],{detached:true,stdio:'ignore'});
spawn('/bin/sh',['-c',${JSON.stringify(orphan)}],{stdio:'ignore'}); setInterval(()=>{},1000);`;
    const running = (pid: number) => {
      try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return !/^[ZX] /.test(stat.slice(stat.lastIndexOf(')') + 2)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    };
    try {
      const other = sync ? undefined : await jobs.start({...owner, cwd: work, command: 'sleep 30'}, shell);
      const job = await jobs.start({...owner, cwd: work, mode, command: `${shellArgument(process.execPath)} -e ${shellArgument(cli)}`}, shell);
      const deadline = Date.now() + 5000;
      while (!existsSync(marker) || !existsSync(orphanMarker)) { assert.ok(Date.now() < deadline, 'tool did not start'); await sleep(10); }
      pids = [...JSON.parse(readFileSync(marker, 'utf8')), Number(readFileSync(orphanMarker, 'utf8').trim())];
      while (readFileSync(`/proc/${pids.at(-1)}/stat`, 'utf8').split(') ')[1].split(' ')[1] !== '1') {
        assert.ok(Date.now() < deadline, 'same-group child did not reparent'); await sleep(10);
      }
      assert.ok(pids.every(running));
      if (sync) jobs.exitSync(Date.now() + 3000);
      else await jobs.stop(job.id);
      while (pids.some(running)) { assert.ok(Date.now() < deadline, 'tool descendants survived cleanup'); await sleep(10); }
      const stopped = await settled(jobs, job.id);
      assert.equal(stopped.cleanup.state, 'managed_scope_confirmed', stopped.cleanup.error);
      for (const pid of pids) assert.ok(stopped.cleanup.scope.some(identity => identity.pid === pid), 'cleanup evidence retains detached descendants');
      if (other) assert.equal(jobs.peek(other.id).state, 'running');
    } finally {
      await jobs.shutdown(Date.now() + 5000);
      for (const pid of pids) if (running(pid)) process.kill(pid, 'SIGKILL');
      rmSync(work, {recursive: true, force: true});
    }
  }
});

test("timeoutMs settles as timed_out after confirmed cleanup", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ command: "sleep 30", cwd: cwd(), timeoutMs: 300, ...owner }, shell);
    const job = await settled(jobs, id, 20000);
    assert.equal(job.state, "timed_out"); assert.equal(job.stopReason, "timeout");
    assert.equal(job.cleanup.state, "managed_scope_confirmed", job.cleanup.error);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test("stop after observed natural exit waits for final monitor evidence without relabeling or signaling it", { timeout: 20000 }, async () => {
  const jobs = manager(), work = cwd(), marker = join(work, 'detector-started');
  try {
    const job = await jobs.start({ ...owner, cwd: work, command: 'echo done', monitor: {
      triggers: [{ id: 'done', literal: 'done' }],
      detector: { command: `touch ${shellArgument(marker)}; read event; sleep 0.2; echo true` },
    } }, shell);
    const deadline = Date.now() + 10000;
    while (!existsSync(marker)) { assert.ok(Date.now() < deadline, 'final detector did not start'); await sleep(10); }
    // The final detector runs during settlement, after the backend observed the root exit.
    assert.equal(jobs.peek(job.id).state, 'running');
    const [first, second] = await Promise.all([jobs.stop(job.id), jobs.stop(job.id)]);
    assert.equal(first.requested, false); assert.equal(second.requested, false);
    assert.equal(first.job.state, 'completed'); assert.equal(first.job.exitCode, 0);
    assert.equal(first.job.stopReason, undefined); assert.equal(first.job.monitor?.events, 1);
    assert.equal(first.job.cleanup.state, 'not_required');
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test("another manager reads saved history but cannot control it", { timeout: 20000 }, async () => {
  const dir = agentDir(), work = cwd();
  const first = manager(dir), second = manager(dir);
  try {
    const { id } = await first.start({ command: "echo kept", cwd: work, ...owner }, shell);
    await settled(first, id); await sleep(50);
    const workspace = await resolveWorkspace(work);
    const { job, live } = await second.get(id, workspace);
    assert.equal(live, false); assert.equal(job.state, "completed"); assert.equal(job.exitCode, 0);
    assert.equal(readFileSync(second.logPath(job, "stdout"), "utf8").trim(), "kept");
    assert.throws(() => second.stop(id), (error: { code?: string }) => error.code === "HISTORY_READ_ONLY");
    await rejectsCode(second.get("job_00000000", workspace), "NOT_FOUND");
  } finally { await first.shutdown(Date.now() + 5000); await second.shutdown(Date.now() + 5000); }
});

test("stopping an agent run stops jobs of its descendants, including ones started during the stop", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const creator = { agentId: "agent_0000000a", runId: "run_0000000c", ancestors: ["run_0000000p"] };
    const child = await jobs.start({ command: "sleep 30", cwd: cwd(), creator, ...owner }, shell);
    const other = await jobs.start({ command: "sleep 30", cwd: cwd(), ...owner }, shell);
    const stopped = await jobs.stopCreatedBy(["run_0000000p"]);
    assert.deepEqual(stopped.map(result => result.job.id), [child.id]);
    assert.equal(stopped[0].job.state, "stopped"); assert.equal(stopped[0].job.stopReason, "agent");
    assert.equal(jobs.peek(other.id).state, "running", "unrelated jobs keep running");
    const workflow = await jobs.start({command: 'true', cwd: cwd(), ...owner,
      creator: {workflowId: 'wf_00000000000b', runId: 'wf_00000000000b', ancestors: []}}, shell);
    await jobs.wait(workflow.id);
    assert.deepEqual((await jobs.stopCreatedBy(['wf_00000000000b'])).map(result => result.job.id), [workflow.id],
      'a later scope does not report jobs of creators closed by earlier stops');
    await rejectsCode(jobs.start({ command: "sleep 30", cwd: cwd(), creator, ...owner }, shell), "START_NOT_COMMITTED");
  } finally { await jobs.shutdown(Date.now() + 10000); }
});

test("quit stops live jobs under one deadline and closes admission", { timeout: 30000 }, async () => {
  const jobs = manager();
  const { id } = await jobs.start({ command: "sleep 30", cwd: cwd(), ...owner }, shell);
  await jobs.shutdown(Date.now() + 10000);
  const job = jobs.peek(id);
  assert.equal(job.state, "stopped"); assert.equal(job.stopReason, "quit");
  assert.equal(job.cleanup.state, "managed_scope_confirmed", job.cleanup.error);
  await rejectsCode(jobs.start({ command: "true", cwd: cwd(), ...owner }, shell), "CLOSING");
});

test("pty job answers input, logs merged output and keeps a live screen", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ command: "read line; echo \"got:$line\"", mode: "pty", cwd: cwd(), ...owner, cols: 80, rows: 24 }, shell);
    assert.ok(jobs.terminal(id), "pty jobs expose the headless terminal for attach");
    await sleep(500);
    jobs.write(id, "hello\r", { source: "model", kind: "text", text: "hello⏎" });
    const job = await settled(jobs, id, 20000);
    assert.equal(job.state, "completed"); assert.equal(job.exitCode, 0);
    assert.match(readFileSync(jobs.logPath(job, "output"), "utf8"), /got:hello/);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});
