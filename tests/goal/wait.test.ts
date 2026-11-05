import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { host, complete, goalId } from "../support/host.ts";
import { agentDir } from "../support/jobs.ts";

const lastText = (context: TranscriptContext) => {
  const result = context.messages.findLast(message => message.role === "toolResult");
  assert.ok(result?.role === "toolResult");
  return result.content.map(part => part.type === "text" ? part.text : "").join("\n");
};
const jobId = (context: TranscriptContext) => /job_[a-f0-9]{8}/.exec(lastText(context))![0];

test("goal_wait waitFor holds other notices until the waited job settles; settled IDs do not wait", { timeout: 30000 }, async () => {
  const h = await host({ root: agentDir(), tools: ["job_start", "job_read"] });
  let fast = "", slow = "";
  try {
    h.faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 0.3" })),
      context => { fast = jobId(context); return fauxAssistantMessage(fauxToolCall("job_start", { command: "sleep 2" })); },
      context => { slow = jobId(context); return fauxAssistantMessage(fauxToolCall("goal_wait", { goalId: goalId(context), reason: "slow build", waitFor: [slow] })); },
      context => {
        // One merged wake: the held fast notice, the slow result and the goal contract.
        const wake = JSON.stringify(context.messages.findLast(message => message.role === "user"));
        assert.match(wake, new RegExp(`${slow} completed`)); assert.match(wake, new RegExp(`${fast} completed`));
        return fauxAssistantMessage(fauxToolCall("goal_wait", { goalId: goalId(context), reason: "fast", waitFor: [fast] }));
      },
      context => { assert.match(lastText(context), /^Not waiting: every waitFor object has already settled/); return complete(context); },
    ]);
    await h.session.prompt("/goal Wait for the slow build"); await h.idle();
    assert.equal(h.faux.state.callCount, 3); assert.deepEqual(h.goal()?.waitFor, [slow]);
    await sleep(800);
    assert.equal(h.faux.state.callCount, 3, "the fast job's notice does not end a waitFor wait");
    assert.equal(h.statuses.get("goal"), "goal 待任务");
    const deadline = Date.now() + 15000;
    while (h.goal()?.status !== "completed" && Date.now() < deadline) { await sleep(50); await h.idle(); }
    assert.equal(h.faux.state.callCount, 5); assert.equal(h.goal()?.status, "completed");
  } finally { await h.dispose(); }
});
