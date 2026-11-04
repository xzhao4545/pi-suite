import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Transcript } from "../../src/ui/transcript.ts";
import { ScrollView } from "../../src/ui/scroll.ts";
import { terminal } from "../support/terminal.ts";

test("native transcript pairs tool calls/results and retains Markdown, thinking and reading positions", () => {
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
});
