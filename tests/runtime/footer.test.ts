import { test } from "node:test";
import assert from "node:assert/strict";
import { FooterComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { host, goalId } from "../support/host.ts";

test("native Pi footer reads the goal status slot and budgets one visible status row at all widths", async () => {
  const h = await host();
  try {
    const footer = new FooterComponent(h.session, { getGitBranch: () => null, getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
      getExtensionStatuses: () => new Map([...h.statuses].filter((entry): entry is [string, string] => entry[1] !== undefined)),
    });
    h.faux.setResponses([context => fauxAssistantMessage(fauxToolCall("goal_wait", { goal_id: goalId(context), reason: "External event" }))]);
    await h.session.prompt("/goal Display waiting goal"); await h.idle();
    for (const width of [40, 60, 120]) {
      const lines = footer.render(width);
      assert.equal(lines.length, 3); assert.match(lines[2], /goal 待任务/);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    const calls = h.faux.state.callCount;
    await h.session.prompt("/goal clear");
    assert.equal(footer.render(40).length, 2); assert.equal(h.faux.state.callCount, calls);
    footer.dispose();
  } finally { await h.dispose(); }
});
