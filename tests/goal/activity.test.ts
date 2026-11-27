import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { host, complete, goalView } from "../support/host.ts";

test("five empty or identical automatic rounds pause until a user turn resets the guard", { timeout: 15000 }, async () => {
  for (const repeated of [false, true]) {
    let ctx!: ExtensionContext;
    const h = await host({ persisted: true, compact: true, keepRecentTokens: 0, tools: ["evidence", "job_start"], extend: pi => {
      pi.on("session_start", (_event, context) => { ctx = context; });
      pi.on("session_before_compact", event => ({ compaction: { summary: "Preserve unfinished goal", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }));
      pi.registerTool({ name: "evidence", label: "Evidence", description: "Read evidence", parameters: Type.Object({ path: Type.String() }),
        execute: async () => ({ content: [{ type: "text", text: "Unchanged read-only evidence" }], details: undefined, terminate: true }) });
    } });
    try {
      h.faux.setResponses(Array.from({ length: 5 }, (_, i) => repeated ? fauxAssistantMessage(fauxToolCall("evidence", { path: "same-file" })) : fauxAssistantMessage(`Reasoning stage ${i}`)));
      await h.session.prompt("/goal Preserve every unfinished requirement"); await h.idle();
      assert.equal(h.faux.state.callCount, 5); assert.equal(h.goal()?.status, 'paused'); assert.equal(h.goal()?.automatic, false);
      assert.equal(h.goal()?.reason?.kind, repeated ? 'repeated_tools' : 'no_tools'); assert.equal(h.goal()?.error, undefined);
      assert.ok(h.notices.some(notice => notice.type === 'warning'));
      const elapsed = h.goal()!.elapsedMs;
      const earlier = h.session.sessionManager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'assistant')[2];
      await h.session.reload(); assert.equal(h.faux.state.callCount, 5); assert.equal(h.goal()?.automatic, false);
      await h.session.compact(); await h.idle(); assert.equal(h.faux.state.callCount, 5); assert.equal(h.goal()?.elapsedMs, elapsed);
      await h.session.navigateTree(earlier.id); await sleep(50); await h.idle();
      assert.equal(h.faux.state.callCount, 5, "an older active branch cannot bypass automatic-stop permission");
      assert.equal(h.goal()?.automatic, false); assert.equal(h.goal()?.reason?.kind, repeated ? 'repeated_tools' : 'no_tools');
      // A paused goal does not hold notifications: the result wakes one turn without goal access.
      h.faux.setResponses([context => { assert.equal(goalView(context).access, "none"); return fauxAssistantMessage("Noted the job result"); }]);
      const job = await h.session.getToolDefinition("job_start")!.execute("external", { command: "printf done" }, undefined, undefined, ctx as never);
      assert.ok(!job.isError); await sleep(100); await h.idle();
      assert.equal(h.faux.state.callCount, 6, "a paused goal delivers background results");
      assert.equal(h.goal()?.automatic, false, "background results cannot grant automatic permission");
      h.faux.setResponses([
        context => {
          assert.equal(goalView(context).access, "execute"); assert.equal(h.goal()?.reason, undefined);
          return fauxAssistantMessage("Reviewed unfinished work; continue automatically");
        },
        repeated ? fauxAssistantMessage(fauxToolCall("evidence", { path: "same-file" })) : fauxAssistantMessage("Fresh automatic round"),
        complete,
      ]);
      await h.session.prompt("Review the unfinished work"); await h.idle();
      assert.equal(h.faux.state.callCount, 9); assert.equal(h.goal()?.status, "completed");
    } finally { await h.dispose(); }
  }
});

test("user work, changing read-only evidence and arranged waits reset automatic inactivity samples", { timeout: 15000 }, async () => {
  const h = await host({ tools: ["evidence"], extend: pi => {
    pi.registerTool({ name: "evidence", label: "Evidence", description: "Read research evidence", parameters: Type.Object({ query: Type.String() }),
      execute: async (_id, args) => ({ content: [{ type: "text", text: `Evidence for ${args.query}` }], details: undefined, terminate: args.query !== "natural-user" }) });
  } });
  try {
    const arranged = (context: Parameters<typeof complete>[0]) => fauxAssistantMessage(fauxToolCall("goal_wait", {
      goalId: goalView(context).goalId, reason: "Arranged research event",
    }));
    h.faux.setResponses([arranged]);
    await h.session.prompt("/goal Research independent sources"); await h.idle();
    // Six identical provider/tool turns in a user-driven run are not six automatic rounds.
    h.faux.setResponses([...Array.from({ length: 6 }, () => fauxAssistantMessage(fauxToolCall("evidence", { query: "natural-user" }))), arranged]);
    await h.session.prompt("Review this source in the current research phase"); await h.idle();
    assert.equal(h.goal()?.reason, undefined); assert.equal(h.goal()?.waiting, "jobs");
    h.faux.setResponses([
      ...Array.from({ length: 6 }, (_, i) => fauxAssistantMessage(fauxToolCall("evidence", { query: `source-${i}` }))), arranged,
    ]);
    await h.session.prompt("/goal resume"); await h.idle();
    assert.equal(h.goal()?.waiting, "jobs"); assert.equal(h.goal()?.reason, undefined);
    h.faux.setResponses([fauxAssistantMessage("Reasoning A"), fauxAssistantMessage("Reasoning B"), fauxAssistantMessage("Reasoning C"), fauxAssistantMessage("Reasoning D"), complete]);
    await h.session.prompt("/goal resume"); await h.idle();
    assert.equal(h.goal()?.status, "completed"); assert.equal(h.goal()?.reason, undefined);
  } finally { await h.dispose(); }
});
