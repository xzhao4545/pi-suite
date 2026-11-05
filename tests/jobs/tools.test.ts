import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { host } from "../support/host.ts";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../support/jobs.ts";

const TOOLS = ["job_start", "job_list", "job_read", "job_write", "job_stop", "wait"];
function lastToolText(context: TranscriptContext): string {
  const result = context.messages.findLast(message => message.role === "toolResult");
  assert.ok(result && result.role === "toolResult", "expected a tool result");
  return result.content.map(part => part.type === "text" ? part.text : "").join("\n");
}
const jobId = (context: TranscriptContext) => {
  const id = /job_[a-f0-9]{8}/.exec(lastToolText(context))?.[0];
  assert.ok(id, "tool result names the job"); return id;
};
const notices = (branch: SessionEntry[], id: string) => branch
  .filter(entry => entry.type === "custom_message" && entry.customType === "pi-suite:notification" && JSON.stringify(entry.content).includes(id));

test("wait returns the settlement and consumes it; job_read shows the output", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  let id = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "echo from-job", name: "echo" })),
      context => { id = jobId(context); return fauxAssistantMessage(fauxToolCall("wait", { ids: [id], timeoutMs: 20000 })); },
      context => {
        assert.match(lastToolText(context), new RegExp(`wait 1/1 settled\\n${id} completed · exit 0`));
        return fauxAssistantMessage(fauxToolCall("job_read", { id }));
      },
      context => {
        const text = lastToolText(context);
        assert.match(text, new RegExp(`^${id} completed · exit 0 · [0-9.]+s · pipe · stdout bytes 0-`));
        assert.match(text, /from-job/);
        return fauxAssistantMessage("done");
      },
    ]);
    await h.session.prompt("Run it"); await h.idle();
    await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 4, "a result already returned by wait does not wake the model again");
    assert.equal(notices(h.session.sessionManager.getBranch(), id).length, 0);
  } finally { await h.dispose(); }
});

test("a job settling after the turn wakes the owner session exactly once; status counts it while active", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  let id = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 1; echo late" })),
      context => { id = jobId(context); return fauxAssistantMessage("started"); },
      context => {
        const notice = context.messages.findLast(message => message.role === "user");
        assert.match(JSON.stringify(notice), new RegExp(`${id} completed · exit 0`));
        return fauxAssistantMessage("job finished");
      },
    ]);
    await h.session.prompt("Start it"); await h.idle();
    assert.equal(h.statuses.get("pi-suite:runtime"), "jobs 1");
    const deadline = Date.now() + 15000;
    while (h.faux.state.callCount < 3 && Date.now() < deadline) await sleep(50);
    await h.idle(); await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 3);
    assert.equal(notices(h.session.sessionManager.getBranch(), id).length, 1);
    assert.equal(h.statuses.get("pi-suite:runtime"), undefined, "no active jobs clears the count");
  } finally { await h.dispose(); }
});

test("job_list filters, rejects mixed id and list arguments, and job_stop reports real cleanup", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  try {
    let id = "";
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 30", name: "sleeper" })),
      context => { id = jobId(context); return fauxAssistantMessage(fauxToolCall("job_list", {})); },
      context => {
        assert.match(lastToolText(context), new RegExp(`^1 active job \\(session\\)\\n${id} running`));
        return fauxAssistantMessage(fauxToolCall("job_list", { id, state: "all" }));
      },
      context => {
        assert.match(lastToolText(context), /INVALID_ARGS/);
        return fauxAssistantMessage(fauxToolCall("job_stop", { id }));
      },
      context => {
        assert.match(lastToolText(context), new RegExp(`^${id} stopped · .* · stop user\\nstopped; managed processes confirmed gone`));
        return fauxAssistantMessage(fauxToolCall("job_read", { id, stream: "output" }));
      },
      context => {
        assert.match(lastToolText(context), /UNSUPPORTED_STREAM/);
        return fauxAssistantMessage("checked");
      },
    ]);
    await h.session.prompt("Exercise list and stop"); await h.idle();
    assert.equal(h.faux.state.callCount, 6);
  } finally { await h.dispose(); }
});

test("wait on one job returns when another of this session settles; that result is not delivered again", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  let fast = "", slow = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 0.5; echo fast" })),
      context => { fast = jobId(context); return fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 30" })); },
      context => { slow = jobId(context); return fauxAssistantMessage(fauxToolCall("wait", { ids: [slow], timeoutMs: 20000 })); },
      context => {
        const text = lastToolText(context);
        assert.match(text, /^wait 0\/1 settled · returned early: another job or agent settled/);
        assert.match(text, new RegExp(`also:\\n${fast} completed · exit 0`)); assert.match(text, new RegExp(`pending: ${slow}`));
        return fauxAssistantMessage(fauxToolCall("job_stop", { id: slow }));
      },
      () => fauxAssistantMessage("done"),
    ]);
    await h.session.prompt("Run both"); await h.idle();
    await sleep(300); await h.idle();
    assert.equal(h.faux.state.callCount, 5);
    assert.equal(notices(h.session.sessionManager.getBranch(), fast).length, 0);
  } finally { await h.dispose(); }
});

test("a user steering message ends a running wait without stopping the job", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: TOOLS });
  let id = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 30" })),
      context => { id = jobId(context); return fauxAssistantMessage(fauxToolCall("wait", { ids: [id], timeoutMs: 20000 })); },
      context => {
        assert.match(lastToolText(context), new RegExp(`^wait 0/1 settled · returned early: the user sent a message\\n${id} running`));
        assert.match(JSON.stringify(context.messages.at(-1)), /check the logs instead/);
        return fauxAssistantMessage(fauxToolCall("job_stop", { id }));
      },
      () => fauxAssistantMessage("stopped"),
    ]);
    const run = h.session.prompt("Start and wait");
    const deadline = Date.now() + 10000;
    while (h.faux.state.callCount < 2 && Date.now() < deadline) await sleep(20);
    await sleep(200);
    await h.session.prompt("check the logs instead", { streamingBehavior: "steer" });
    await run; await h.idle();
    assert.equal(h.faux.state.callCount, 4);
  } finally { await h.dispose(); }
});
