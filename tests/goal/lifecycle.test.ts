import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { host, complete, goalId } from "../support/host.ts";

test("real host continues an unfinished goal once, then terminates on verified completion", { timeout: 15000 }, async () => {
  const h = await host();
  try {
    h.faux.setResponses([fauxAssistantMessage("Implemented; checking"), complete]);
    await h.session.prompt("/goal Implement and verify"); await h.idle();
    assert.equal(h.faux.state.callCount, 2);
    assert.equal(h.goal()?.status, "completed"); assert.equal(h.goal()?.turns, 2);
    assert.equal(h.statuses.get("goal"), "goal 完成");
    assert.ok(h.writes.includes("goal 运行")); assert.ok(h.writes.includes("goal 宿主恢复"));
    assert.ok(h.session.sessionManager.getBranch().some(e => e.type === "custom_message" && e.customType === "pi-suite:notification"));
  } finally { await h.dispose(); }
});

test("host retry succeeds without suite retry; exhausted retries persist final failure", { timeout: 15000 }, async () => {
  const h = await host({ retry: true });
  try {
    const error = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" });
    h.faux.setResponses([error(), complete]);
    await h.session.prompt("/goal Verify retry success"); await h.idle();
    assert.equal(h.faux.state.callCount, 2); assert.equal(h.goal()?.status, "completed");
    h.faux.setResponses([error(), error()]);
    await h.session.prompt("/goal Verify final error"); await h.idle();
    assert.equal(h.faux.state.callCount, 4); assert.equal(h.goal()?.status, "failed");
    assert.match(h.goal()?.error ?? "", /503/); assert.equal(h.statuses.get("goal"), "goal 请求失败");
  } finally { await h.dispose(); }
});

test("Esc preserves the goal, foreign work cannot resume it, and explicit resume completes", { timeout: 15000 }, async () => {
  const h = await host();
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([async () => { started.resolve(); await release.promise; return fauxAssistantMessage("interrupted"); }]);
    await h.session.prompt("/goal Keep control after Esc"); await started.promise;
    const aborted = h.session.abort(); release.resolve(); await aborted; await h.idle();
    assert.equal(h.goal()?.status, "active"); assert.equal(h.goal()?.automatic, false);
    assert.equal(h.statuses.get("goal"), "goal 待继续");
    h.faux.setResponses([context => {
      const updates = context.messages.filter(m => m.role === "system");
      assert.ok(updates.some(m => m.sections?.["pi-suite-goal"] === null), "foreign work removes the stale goal contract");
      return fauxAssistantMessage("foreign work finished");
    }]);
    await h.session.sendCustomMessage({ customType: "other-extension", content: "Independent work", display: false }, { triggerTurn: true });
    assert.equal(h.goal()?.automatic, false); assert.equal(h.faux.state.callCount, 2);
    h.faux.setResponses([complete]); await h.session.prompt("/goal resume"); await h.idle();
    assert.equal(h.goal()?.status, "completed"); assert.equal(h.faux.state.callCount, 3);
  } finally { release.resolve(); await h.dispose(); }
});

test("unanswered native ask terminates without consent; new user input resumes goal work", { timeout: 15000 }, async () => {
  const h = await host({ answer: "cancel" });
  try {
    h.faux.setResponses([() => fauxAssistantMessage(fauxToolCall("ask_user", { question: "Approve action?", timeout: 0 }))]);
    await h.session.prompt("/goal Ask before acting"); await h.idle();
    assert.equal(h.faux.state.callCount, 1); assert.equal(h.goal()?.status, "active");
    assert.equal(h.goal()?.waiting, "user"); assert.equal(h.statuses.get("goal"), "goal 待答");
    h.faux.setResponses([complete]); await h.session.prompt("Continue with my explicit instructions"); await h.idle();
    assert.equal(h.goal()?.status, "completed"); assert.equal(h.faux.state.callCount, 2);
  } finally { await h.dispose(); }
});

test("an explicit budget stops model work, can be raised, and clear removes the goal", { timeout: 15000 }, async () => {
  const h = await host();
  try {
    h.faux.setResponses([fauxAssistantMessage("Progress")]);
    await h.session.prompt("/goal --tokens 1 Stay within budget"); await h.idle();
    assert.equal(h.goal()?.status, "budget_limited"); assert.equal(h.faux.state.callCount, 1);
    assert.ok(h.goal()!.usedTokens >= 1); assert.equal(h.statuses.get("goal"), "goal 预算耗尽");
    h.faux.setResponses([complete]);
    await h.session.prompt("/goal edit --tokens 100k"); await h.session.prompt("/goal resume"); await h.idle();
    assert.equal(h.goal()?.status, "completed");
    await h.session.prompt("/goal clear"); assert.equal(h.goal(), undefined); assert.equal(h.statuses.get("goal"), undefined);
  } finally { await h.dispose(); }
});

test("real host manual compact and overflow recovery keep one continuation and goal ownership", { timeout: 15000 }, async () => {
  const reasons: string[] = [];
  const h = await host({ compact: true, extend: pi => {
    pi.on("session_before_compact", event => {
      reasons.push(event.reason);
      return { compaction: { summary: "Conversation compacted", firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore } };
    });
  } });
  try {
    h.faux.setResponses([fauxAssistantMessage("Initial context recorded")]);
    await h.session.prompt("Initial conversation context. ".repeat(100));
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", { goal_id: goalId(context), reason: "Arranged external work" }))]);
    await h.session.prompt("/goal Preserve the goal through compaction"); await h.idle();
    const id = h.goal()!.id;
    await h.session.compact(); await h.idle();
    assert.equal(h.goal()?.waiting, "jobs"); assert.equal(h.goal()?.id, id); assert.equal(h.faux.state.callCount, 2);
    h.faux.setResponses([() => {
      // Pi ignores errors timestamped before the compaction boundary. Build this
      // response for the new request, with a distinct millisecond from that boundary.
      const boundary = h.session.sessionManager.getBranch().findLast(e => e.type === "compaction")!;
      return fauxAssistantMessage("", { stopReason: "error", errorMessage: "maximum context length exceeded",
        timestamp: Math.max(Date.now(), Date.parse(boundary.timestamp) + 1) });
    }, complete]);
    await h.session.prompt("/goal resume"); await h.idle();
    assert.ok(reasons.includes("manual")); assert.ok(reasons.includes("overflow"));
    assert.equal(h.faux.state.callCount, 4); assert.equal(h.goal()?.status, "completed"); assert.equal(h.goal()?.id, id);
  } finally { await h.dispose(); }
});

test("reload preserves an arranged wait; branch navigation restores its own goal without copying state", { timeout: 15000 }, async () => {
  const h = await host();
  try {
    const emptyBranch = h.session.sessionManager.appendCustomEntry("test:anchor", {});
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", { goal_id: goalId(context), reason: "Arranged deadline" }))]);
    await h.session.prompt("/goal Restore selected branch"); await h.idle();
    const id = h.goal()!.id, leaf = h.session.sessionManager.getLeafId()!;
    await h.session.reload(); assert.equal(h.goal()?.id, id); assert.equal(h.goal()?.waiting, "jobs");
    const count = h.session.sessionManager.getEntryCount();
    await h.session.navigateTree(emptyBranch);
    assert.equal(h.goal(), undefined); assert.equal(h.statuses.get("goal"), undefined);
    assert.equal(h.session.sessionManager.getEntryCount(), count, "navigation must not append outgoing goal into the selected branch");
    await h.session.navigateTree(leaf);
    assert.equal(h.goal()?.id, id); assert.equal(h.statuses.get("goal"), "goal 待任务");
    assert.equal(h.faux.state.callCount, 1);
    const activeEntry = h.session.sessionManager.getBranch().find(e => e.type === "custom" && e.customType === "pi-suite:goal" &&
      (e.data as { goal: { status: string; waiting?: string } }).goal.status === "active" && !(e.data as { goal: { waiting?: string } }).goal.waiting)!;
    const resumed = Promise.withResolvers<void>();
    h.faux.setResponses([context => { resumed.resolve(); return complete(context); }]);
    await h.session.navigateTree(activeEntry.id); await resumed.promise; await h.idle();
    assert.equal(h.goal()?.id, id); assert.equal(h.goal()?.status, "completed"); assert.equal(h.faux.state.callCount, 2);
    await h.session.navigateTree(leaf);
    assert.equal(h.goal()?.waiting, "jobs", "completion in another branch must not change the selected branch");
  } finally { await h.dispose(); }
});

test("manual compact aborts an active response and resumes once after host becomes idle", { timeout: 15000 }, async () => {
  const h = await host({ compact: true, extend: pi => {
    pi.on("session_before_compact", event => ({ compaction: { summary: "Compacted safely",
      firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }));
  } });
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), resumed = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([fauxAssistantMessage("Initial context")]);
    await h.session.prompt("Conversation before goal. ".repeat(100));
    h.faux.setResponses([
      async () => { started.resolve(); await release.promise; return fauxAssistantMessage("Cancelled while compacting"); },
      context => { resumed.resolve(); return complete(context); },
    ]);
    await h.session.prompt("/goal Compact during work"); await started.promise;
    const compacting = h.session.compact(); release.resolve(); await compacting;
    await resumed.promise; await h.idle();
    assert.equal(h.faux.state.callCount, 3); assert.equal(h.goal()?.status, "completed");
    assert.ok(h.writes.includes("goal 宿主恢复"));
  } finally { release.resolve(); await h.dispose(); }
});

test("threshold compact preserves active work; cancelled compact leaves the target awaiting recovery", { timeout: 15000 }, async () => {
  let cancel = false; const reasons: string[] = [];
  const h = await host({ compact: true, contextWindow: 12000, reserveTokens: 2000, extend: pi => {
    pi.on("session_before_compact", event => {
      reasons.push(event.reason);
      return cancel ? { cancel: true } : { compaction: { summary: "Compacted context",
        firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } };
    });
  } });
  try {
    h.faux.setResponses([fauxAssistantMessage("Seed response")]);
    await h.session.prompt("Seed user context. ".repeat(100));
    h.faux.setResponses([fauxAssistantMessage("progress ".repeat(4200)), complete]);
    await h.session.prompt("/goal Verify threshold recovery"); await h.idle();
    assert.ok(reasons.includes("threshold")); assert.equal(h.goal()?.status, "completed");
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", {
      goal_id: goalId(context), reason: "External work",
    }))]);
    await h.session.prompt("/goal Verify cancelled compaction"); await h.idle();
    cancel = true; await assert.rejects(h.session.compact(), /Compaction cancelled/);
    assert.equal(h.goal()?.status, "active"); assert.equal(h.goal()?.automatic, false);
    assert.equal(h.goal()?.waiting, "jobs"); assert.equal(h.faux.state.callCount, 4);
  } finally { await h.dispose(); }
});

test("reload restores one deadline wakeup and does not leave a runnable stale timer", { timeout: 15000 }, async () => {
  const h = await host(); const resumed = Promise.withResolvers<void>();
  try {
    h.faux.setResponses([
      context => fauxAssistantMessage(fauxToolCall("goal_wait", { goal_id: goalId(context), reason: "Arranged deadline", resume_after_ms: 200 })),
      context => { resumed.resolve(); return complete(context); },
    ]);
    await h.session.prompt("/goal Wake after reload"); await h.idle();
    const id = h.goal()!.id;
    await h.session.reload(); await resumed.promise; await h.idle();
    assert.equal(h.goal()?.id, id); assert.equal(h.goal()?.status, "completed"); assert.equal(h.faux.state.callCount, 2);
  } finally { await h.dispose(); }
});
