import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { host } from "../support/host.ts";
import { agentDir } from "../support/jobs.ts";

const TOOLS = ["job_start", "job_list", "job_read", "job_write", "job_stop", "wait"];
function logPath(root: string, id: string): string {
  const base = join(root, "pi-suite", "jobs");
  const dir = readdirSync(base, { recursive: true, encoding: "utf8" }).find(entry => entry.endsWith(id));
  assert.ok(dir, `log directory for ${id}`);
  return join(base, dir, "stdout.log");
}
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) { assert.ok(Date.now() < deadline, what); await sleep(25); }
}

test("new/resume/fork keep the original job process; only the owner session is notified, once", { timeout: 60000 }, async () => {
  const root = agentDir();
  let id = "";
  const ownerNotice = (context: TranscriptContext) => {
    assert.match(JSON.stringify(context.messages.at(-1)), new RegExp(`${id} completed · exit 0`));
    return fauxAssistantMessage("owner saw the result");
  };
  let current = await host({ root, persisted: true, tools: TOOLS });
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({ root, tools: TOOLS, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent, responses: [ownerNotice] });
    return { ...current, diagnostics: [] };
  });
  try {
    current.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "for i in $(seq 1 12); do echo tick$i; sleep 0.25; done" })),
      context => { id = /job_[a-f0-9]{8}/.exec(JSON.stringify(context.messages.at(-1)))![0]; return fauxAssistantMessage("started"); },
    ]);
    await current.session.prompt("Start a ticking job"); await current.idle();
    const originalPath = current.session.sessionFile!, log = logPath(root, id);
    assert.equal(current.statuses.get("pi-suite:runtime"), "jobs 1");

    await runtime.newSession();
    assert.equal(current.statuses.get("pi-suite:runtime"), undefined, "a new session does not count another session's job");
    const before = statSync(log).size;
    await sleep(700);
    assert.ok(statSync(log).size > before, "the job keeps writing after the session is replaced");
    await until(() => readFileSync(log, "utf8").includes("tick12"), 15000, "job finishes while another session is bound");
    await sleep(300); await current.idle();
    assert.equal(current.faux.state.callCount, 0, "a non-owner session is never woken");
    assert.deepEqual(readFileSync(log, "utf8").trim().split(/\r?\n/), Array.from({ length: 12 }, (_, i) => `tick${i + 1}`),
      "one uninterrupted process wrote the whole log");

    await runtime.switchSession(originalPath);
    await until(() => current.faux.state.callCount === 1, 10000, "owner session is woken on resume");
    await current.idle(); await sleep(300); await current.idle();
    assert.equal(current.faux.state.callCount, 1);
    assert.equal(current.session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" &&
      entry.customType === "pi-suite:notification" && JSON.stringify(entry.content).includes(id)).length, 1);

    await runtime.fork(current.session.sessionManager.getLeafId()!, { position: "at" });
    await sleep(300); await current.idle();
    assert.equal(current.faux.state.callCount, 0, "a fork does not inherit the notice");
    await runtime.switchSession(originalPath);
    await sleep(300); await current.idle();
    assert.equal(current.faux.state.callCount, 0, "the owner session is notified only once");
  } finally { await runtime.dispose(); }
});

test("reload keeps a running job; the reloaded extension counts it and delivers its result once", { timeout: 60000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  let id = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 1.5; echo after-reload" })),
      context => { id = /job_[a-f0-9]{8}/.exec(JSON.stringify(context.messages.at(-1)))![0]; return fauxAssistantMessage("started"); },
    ]);
    await h.session.prompt("Start then reload"); await h.idle();
    await h.session.reload();
    assert.equal(h.statuses.get("pi-suite:runtime"), "jobs 1", "the reloaded extension sees the same running job");
    h.faux.setResponses([context => {
      assert.match(JSON.stringify(context.messages.at(-1)), new RegExp(`${id} completed · exit 0`));
      return fauxAssistantMessage("result after reload");
    }]);
    await until(() => h.faux.state.callCount === 3, 15000, "result delivered after reload");
    await h.idle(); await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 3);
    assert.equal(h.statuses.get("pi-suite:runtime"), undefined);
  } finally { await h.dispose(); }
});
