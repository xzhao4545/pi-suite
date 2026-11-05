import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { agentDir, manager, owner, settled, testShell } from "../support/jobs.ts";
import { host } from "../support/host.ts";
import type { JobManager } from "../../src/jobs/manager.ts";
import type { JobSummary } from "../../src/jobs/types.ts";

const shell = testShell();
const cwd = () => mkdtempSync(join(tmpdir(), "pi-suite-mon-"));
const events = (jobs: JobManager, job: JobSummary) => readFileSync(jobs.logPath(job, "events"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));

test("stream monitor: literal and threshold triggers, exact-line dedupe, cooldown and detector", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ cwd: cwd(), ...owner, command: "echo ERROR a; echo ERROR a; echo coverage 91%; echo coverage 72%; echo WARN 1; echo WARN 2", monitor: {
      triggers: [{ id: "error", literal: "ERROR" }, { id: "low", regex: "coverage (\\d+)%", threshold: { captureGroup: 1, op: "lt", value: 80 } },
        { id: "warn", regex: "/^WARN/", cooldownMs: 60000 }],
    } }, shell);
    const job = await settled(jobs, id);
    assert.deepEqual(events(jobs, job).map(event => `${event.triggerId}:${event.lineOrDiff}`), ["error:ERROR a", "low:coverage 72%", "warn:WARN 1"]);
    assert.equal(job.monitor?.events, 3);

    // The detector sees the candidate JSON and can drop or relabel it.
    const filtered = await jobs.start({ cwd: cwd(), ...owner, command: "echo hit keep; echo hit drop", monitor: {
      triggers: [{ id: "hit", literal: "hit" }],
      detector: { command: "read json; case \"$json\" in *drop*) echo false;; *) echo '{\"triggerId\":\"kept\"}';; esac" },
    } }, shell);
    const done = await settled(jobs, filtered.id);
    assert.deepEqual(events(jobs, done).map(event => `${event.triggerId}:${event.lineOrDiff}`), ["kept:hit keep"]);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

test("poll-diff fires on changed output; file-watch fires on file events without a command", { timeout: 30000 }, async () => {
  const jobs = manager(), dir = cwd();
  try {
    writeFileSync(join(dir, "state"), "status: idle\n");
    const poll = await jobs.start({ cwd: dir, ...owner, command: "cat state", monitor: {
      strategy: "poll-diff", poll: { intervalMs: 300 }, triggers: [{ id: "ready", literal: "ready" }],
    } }, shell);
    const watch = await jobs.start({ cwd: dir, ...owner, monitor: { strategy: "file-watch", fileWatch: { path: dir }, triggers: [{ id: "touched", literal: "flag" }] } }, shell);
    assert.equal(jobs.peek(watch.id).name, `watch ${dir}`);
    await sleep(1200);
    writeFileSync(join(dir, "state"), "status: ready\n");
    writeFileSync(join(dir, "flag"), "x");
    const deadline = Date.now() + 10000;
    while ((!jobs.peek(poll.id).monitor?.events || !jobs.peek(watch.id).monitor?.events) && Date.now() < deadline) await sleep(100);
    await jobs.stop(poll.id); await jobs.stop(watch.id);
    const [pollEvent] = events(jobs, await settled(jobs, poll.id));
    assert.match(pollEvent.lineOrDiff, /idle" -> "status: ready/);
    const [watchEvent] = events(jobs, await settled(jobs, watch.id));
    assert.match(watchEvent.lineOrDiff, /^(RENAME|CHANGE) flag$/);
  } finally { await jobs.shutdown(Date.now() + 5000); }
});

const lastToolText = (context: TranscriptContext) => {
  const result = context.messages.findLast(message => message.role === "toolResult");
  assert.ok(result?.role === "toolResult");
  return result.content.map(part => part.type === "text" ? part.text : "").join("\n");
};

test("a monitor event ends a wait on its own job; the read events are not delivered again", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: ["job_start", "job_read", "job_stop", "wait"] });
  let id = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 0.5; echo 'server listening on 8080'; sleep 30", monitor: { triggers: [{ id: "up", literal: "listening" }] } })),
      context => { id = /job_[a-f0-9]{8}/.exec(lastToolText(context))![0]; return fauxAssistantMessage(fauxToolCall("wait", { ids: [id], timeoutMs: 20000 })); },
      context => {
        const text = lastToolText(context);
        assert.match(text, /^wait 0\/1 settled · returned early: a monitor event fired/);
        assert.match(text, /#1 up: server listening on 8080/);
        return fauxAssistantMessage(fauxToolCall("job_read", { id, stream: "events" }));
      },
      context => { assert.match(lastToolText(context), /#1 \S+ up stdout: server listening on 8080/); return fauxAssistantMessage(fauxToolCall("job_stop", { id })); },
      () => fauxAssistantMessage("done"),
    ]);
    await h.session.prompt("Start the server and wait until it is up"); await h.idle();
    await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 5, "the event returned by wait does not wake the model again");
  } finally { await h.dispose(); }
});
