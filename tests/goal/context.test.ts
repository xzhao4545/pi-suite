import { test } from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, getCurrentSystemPrompt, resolveTranscript, type TranscriptContext } from "@earendil-works/pi-ai";
import { host, complete, goalView } from "../support/host.ts";
import { GOAL_CONTINUATION } from "../../src/goal/context.ts";

// Two request shapes: natural tool follow-ups and boundary-driven auto continuations.
// Both remain in one high-level run, which is the stale-system-snapshot failure path.
test("stable Goal history preserves request prefixes, prompt/tool patches and forced prompts", { timeout: 15000 }, async () => {
  for (const boundary of [false, true]) {
    let starts = 0;
    const h = await host({ tools: ["evidence", "late_evidence"], extend: pi => {
      pi.on("before_agent_start", event => {
        starts++;
        event.systemPromptOptions.sections["other-extension"] = "Keep other guidance";
        if (boundary) return { systemPrompt: "Exact forced prompt" };
      });
      pi.registerTool({ name: "evidence", label: "Evidence", description: "Read changing evidence", parameters: Type.Object({ step: Type.Number() }),
        execute: async (_id, params) => {
          if (params.step === 5) {
            pi.registerTool({ name: "late_evidence", label: "Late", description: "Late evidence", parameters: Type.Object({}),
              execute: async () => ({ content: [{ type: "text", text: "late" }], details: undefined }) });
            pi.setActiveTools([...pi.getActiveTools(), "late_evidence"]);
          }
          if (params.step === 10) pi.setActiveTools(pi.getActiveTools().filter(name => name !== "late_evidence"));
          return { content: [{ type: "text", text: `Evidence ${params.step}` }], details: undefined, terminate: boundary };
        } });
    } });
    try {
      const objective = "Verify all twenty independent evidence steps <unsafe-wrapper>";
      let count = 0;
      h.faux.setResponses(Array.from({ length: 20 }, (_, i) => (context: TranscriptContext) => {
        count++;
        const view = goalView(context);
        assert.equal(view.objective, objective); assert.equal(view.access, "execute");
        assert.ok(!('usedTokens' in view) && !('turns' in view) && !('progress' in view));
        const text = JSON.stringify(context.messages);
        assert.equal(text.split(objective).length - 1, 1);
        assert.equal(text.split(GOAL_CONTINUATION).length - 1, boundary ? i + 1 : 1);
        assert.equal(context.messages[0].role, "system");
        for (const mid of [false, true]) {
          const projected = resolveTranscript(context, mid);
          assert.equal(goalView(projected).goalId, view.goalId);
          assert.ok(getCurrentTools(projected.messages).some(tool => tool.name === "evidence"));
          assert.equal(getCurrentTools(projected.messages).some(tool => tool.name === "late_evidence"), i > 5 && i <= 10);
          if (!boundary && i > 5) assert.ok(context.messages.filter(message => message.role === "system").length > 1, "request projection retains in-place tool deltas");
          assert.match(getCurrentSystemPrompt(projected.messages), boundary ? /^Exact forced prompt$/ : /Keep other guidance/);
        }
        return i === 19 ? complete(context) : fauxAssistantMessage(fauxToolCall("evidence", { step: i }));
      }));
      await h.session.prompt(`/goal ${objective}`); await h.idle();
      assert.equal(count, 20, h.goal()?.error); assert.equal(starts, 1); assert.equal(h.goal()?.status, "completed");
      const raw = h.session.sessionManager.getBranch();
      assert.equal(raw.filter(entry => entry.type === 'custom_message' && entry.customType === 'pi-suite:goal-context').length, 1);
      assert.ok(!raw.some(entry => entry.type === 'custom' && entry.customType === 'pi-suite:goal'));
      if (boundary) assert.equal(raw.filter(entry => entry.type === "custom_message" && entry.customType === "pi-suite:notification").length, 20);
    } finally { await h.dispose(); }
  }
});
