import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { Transcript } from "../../src/ui/transcript.ts";
import { ScrollView } from "../../src/ui/scroll.ts";
import { terminal } from "../support/terminal.ts";

test("native transcript pairs streamed child tools, caches canonical components and retains native reading positions", () => {
  const transcript = new Transcript(terminal(), process.cwd());
  const entries: SessionEntry[] = [
    { type: "message", id: "a", parentId: null, timestamp: new Date().toISOString(), message: {
      role: "assistant", api: "openai-completions", provider: "offline", model: "faux", timestamp: Date.now(), stopReason: "toolUse",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: "# Markdown heading\n\n```ts\nconst code = 1;\n```" },
        { type: "toolCall", id: "call", name: "read", arguments: { path: "example.ts" } }],
    } },
    { type: "message", id: "b", parentId: "a", timestamp: new Date().toISOString(), message: {
      role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "tool result line\n".repeat(40) + "result end" }], isError: false, timestamp: Date.now(),
    } },
  ];
  transcript.setEntries(entries);
  assert.ok(transcript.render(40).some(line => line.includes("Markdown heading")));
  assert.ok(transcript.render(40).some(line => line.includes("example.ts")));
  transcript.toggleThinking();
  assert.ok(transcript.render(40).some(line => line.includes("hidden reasoning")));
  transcript.toggleTools();
  const reader = new ScrollView(transcript); reader.viewport(40, 6); reader.handleInput("\x1b[F");
  assert.ok(reader.viewport(40, 6).some(line => line.includes("result end")));
  const offset = reader.offset; reader.viewport(60, 6); assert.equal(reader.offset, offset);

  const childCwd = `${process.cwd()}/child`, renderedCalls: { id: string; state: unknown }[] = [];
  const updates: { id: string; partial: boolean; text: string }[] = [];
  const renderer: ToolRenderers = {
    renderCall(args, _theme, ctx) {
      assert.equal(ctx.cwd, childCwd); renderedCalls.push({ id: ctx.toolCallId, state: ctx.state });
      return new Text(`child-call ${ctx.toolCallId} ${(args as { path: string }).path}`, 0, 0);
    },
    renderResult(result, options, _theme, ctx) {
      assert.equal(ctx.cwd, childCwd); assert.equal(ctx.isPartial, options.isPartial);
      const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      updates.push({ id: ctx.toolCallId, partial: options.isPartial, text });
      return new Text(`child-result ${ctx.toolCallId} ${options.isPartial ? "partial" : "final"} ${text}`, 0, 0);
    },
  };
  const child = new Transcript(terminal(), childCwd, name => name === "read" ? renderer : undefined);
  const assistant = entries[0];
  assert.ok(assistant?.type === "message" && assistant.message.role === "assistant");
  const assistantMessage = assistant.message;
  const calls: SessionEntry = { ...assistant, id: "calls", message: { ...assistantMessage, content: [
    { type: "toolCall", id: "first", name: "read", arguments: { path: "first.ts" } },
    { type: "toolCall", id: "second", name: "read", arguments: { path: "second.ts" } },
  ] } };
  const stream = (text: string): SessionEntry => ({ ...assistant, id: "stream:assistant", message: {
    ...assistantMessage, content: [{ type: "text", text }],
  } });
  const result = (entryId: string, toolCallId: string, text: string): SessionEntry => ({
    type: "message", id: entryId, parentId: calls.id, timestamp: assistant.timestamp, message: {
      role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: Date.now(),
    },
  });
  const partialFirst = result("stream:first", "first", "alpha"), partialSecond = result("stream:second", "second", "beta");
  const streamed = [calls, stream("streaming original"), partialFirst, partialSecond];
  child.setEntries(streamed);
  assert.deepEqual(updates, [{ id: "first", partial: true, text: "alpha" }, { id: "second", partial: true, text: "beta" }]);
  const callCount = renderedCalls.length, updateCount = updates.length;

  // Stable entries keep their tool renderer state even when a synthetic entry in the middle changes.
  child.setEntries([...streamed]);
  child.setEntries([calls, stream("streaming replacement"), partialFirst, partialSecond]);
  let lines = child.render(40);
  assert.ok(lines.some(line => line.includes("streaming replacement")));
  assert.ok(!lines.some(line => line.includes("streaming original")));
  assert.equal(renderedCalls.length, callCount); assert.equal(updates.length, updateCount);
  child.setEntries([calls, stream("streaming replacement"), result("stream:first", "first", "alpha updated"), partialSecond]);
  assert.deepEqual(updates.at(-1), { id: "first", partial: true, text: "alpha updated" });
  assert.equal(updates.length, updateCount + 1, "the unchanged second tool result retains its renderer");

  const finalFirst = result("final:first", "first", "alpha complete");
  const finalText = "child result line\n".repeat(40) + "child result end";
  const finalSecond = result("final:second", "second", finalText);
  child.setEntries([calls, finalFirst, finalSecond, { ...stream("assistant complete"), id: "final:assistant" }]);
  lines = child.render(40);
  assert.equal(lines.filter(line => line.includes("child-call first first.ts")).length, 1);
  assert.equal(lines.filter(line => line.includes("child-call second second.ts")).length, 1);
  assert.ok(!lines.some(line => line.includes("partial") || line.includes("streaming replacement")));
  assert.deepEqual(updates.slice(-2), [{ id: "first", partial: false, text: "alpha complete" }, { id: "second", partial: false, text: finalText }]);
  // Pi redraws a call when its result changes; its renderer state still belongs to the same component.
  for (const id of ["first", "second"]) assert.equal(new Set(renderedCalls.filter(call => call.id === id).map(call => call.state)).size, 1);
  const finalUpdateCount = updates.length, finalCallCount = renderedCalls.length;
  const childReader = new ScrollView(child); childReader.viewport(40, 6); childReader.scroll(3);
  const childOffset = childReader.offset;
  for (const width of [40, 60, 120]) {
    assert.ok(child.render(width).every(line => visibleWidth(line) <= width));
    childReader.viewport(width, 6); assert.equal(childReader.offset, childOffset);
  }
  assert.equal(renderedCalls.length, finalCallCount, "resizing preserves the canonical call components");
  assert.equal(updates.length, finalUpdateCount, "resizing reuses result components without rerunning renderers");
});
