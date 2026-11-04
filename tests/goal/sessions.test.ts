import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { host, goalId, complete } from "../support/host.ts";

test("actual runtime new/resume/fork keeps goals branch-local and restores original identity", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-suite-replace-"));
  let current = await host({ root, persisted: true });
  const runtime = new AgentSessionRuntime(current.session, current.services, async options => {
    current = await host({ root, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent });
    return { ...current, diagnostics: [] };
  });
  try {
    current.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", {
      goal_id: goalId(context), reason: "Arranged external result",
    }))]);
    await current.session.prompt("/goal Keep original session goal"); await current.idle();
    const id = current.goal()!.id, originalPath = current.session.sessionFile!;
    assert.ok(originalPath);
    await runtime.newSession();
    assert.equal(current.goal(), undefined); assert.equal(current.statuses.get("goal"), undefined);
    assert.equal(current.faux.state.callCount, 0);
    await runtime.switchSession(originalPath);
    assert.equal(current.goal()?.id, id); assert.equal(current.goal()?.waiting, "jobs");
    const leaf = current.session.sessionManager.getLeafId()!;
    await runtime.fork(leaf, { position: "at" });
    assert.notEqual(current.session.sessionFile, originalPath);
    assert.equal(current.goal()?.id, id); assert.equal(current.faux.state.callCount, 0);
    current.faux.setResponses([complete]); await current.session.prompt("/goal resume"); await current.idle();
    assert.equal(current.goal()?.status, "completed");
    await runtime.switchSession(originalPath);
    assert.equal(current.goal()?.status, "active"); assert.equal(current.goal()?.waiting, "jobs");
    assert.equal(current.faux.state.callCount, 0, "completing fork must not complete or wake original session");
  } finally { await runtime.dispose(); rmSync(root, { recursive: true, force: true }); }
});
