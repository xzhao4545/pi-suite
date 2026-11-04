import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileSource, readBounded, ReadArgumentError, textSource } from "../../src/runtime/read.ts";
import { normalizeVisibleText, sanitizeText } from "../../src/jobs/terminal/visible-text.ts";

const plain = (text: string) => text;

test("a log within limitBytes is returned whole", async () => {
  const text = "line 1\nline 2\n".repeat(30);
  const page = await readBounded(textSource(text), {}, plain);
  assert.equal(page.text, text); assert.equal(page.endOfStream, true); assert.equal(page.truncated, undefined);
});

for (const [label, bytes] of [["1 MiB", 1 << 20], ["100 MiB", 100 << 20]] as const) {
  test(`${label} log: head, middle error lines and tail fit the budget with exact resume ranges`, { timeout: 120000 }, async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pi-suite-read-")), "out.log");
    const out = createWriteStream(path);
    const row = "progress ".padEnd(99, ".") + "\n";
    const rows = Math.floor(bytes / row.length);
    let chunk = "";
    for (let i = 0; i < rows; i++) {
      chunk += i === Math.floor(rows / 3) ? "ERROR: first failure here\n".padEnd(100, " ") : i === Math.floor(rows * 2 / 3) ? "Traceback (most recent call last)\n".padEnd(100, " ") : row;
      if (chunk.length > 1 << 20) { if (!out.write(chunk)) await once(out, "drain"); chunk = ""; }
    }
    out.end(chunk + "final result: 3 failed\n");
    await once(out, "finish");
    const source = await fileSource(path);
    try {
      const started = Date.now();
      const page = await readBounded(source, { limitBytes: 16384 }, plain);
      assert.ok(Buffer.byteLength(page.text) <= 16384 + 512, `budget kept: ${Buffer.byteLength(page.text)}`);
      assert.match(page.text, /^progress/); assert.match(page.text, /final result: 3 failed\n?$/);
      assert.match(page.text, /> ERROR: first failure here/); assert.match(page.text, /> Traceback/);
      assert.match(page.text, /omitted \(bytes \d+–\d+\), 2 matching lines/);
      const { head, tail, omittedBytes } = page.truncated!;
      assert.equal(head[0], 0); assert.equal(tail[1], source.size); assert.equal(omittedBytes, tail[0] - head[1]);
      const resumed = await readBounded(source, { offset: head[1], limitBytes: 200 }, plain);
      assert.equal(resumed.offset, head[1]); assert.match(resumed.text, /^progress/);
      if (bytes > 1 << 20) assert.ok(Date.now() - started < 60000, "100 MiB default read finishes within a minute");
    } finally { await source.close(); }
  });
}

test("offset pages never split Chinese or emoji characters and rejoin to the original text", async () => {
  const text = "构建步骤：编译完成 ✅ 测试通过 🎉 日志 ".repeat(200);
  const source = textSource(text);
  let offset = 0, joined = "";
  for (let limit = 7; offset < source.size; limit = limit % 13 + 7) {
    const page = await readBounded(source, { offset, limitBytes: limit }, plain);
    assert.ok(!page.text.includes("\uFFFD"), `no replacement character at offset ${offset}`);
    assert.equal(page.offset, offset); assert.ok(page.nextOffset > offset);
    joined += page.text; offset = page.nextOffset;
  }
  assert.equal(joined, text);
  const late = await readBounded(source, { offset: 1, limitBytes: 64 }, plain);
  assert.ok(late.offset > 1, "a start inside a character moves to the next boundary");
});

test("search returns line numbers, byte offsets and context, and resumes after the match limit", async () => {
  const lines = Array.from({ length: 200 }, (_, i) => i % 3 === 0 ? `warn ${i}` : `ok ${i}`);
  const source = textSource(lines.join("\n") + "\n");
  const first = await readBounded(source, { search: "/^warn/", context: 1 }, plain);
  assert.equal(first.matches, 50); assert.equal(first.endOfStream, false);
  assert.match(first.text, /^1@0> warn 0\n2  ok 1/);
  const second = await readBounded(source, { search: "/^warn/", offset: first.nextOffset }, plain);
  assert.equal(second.offset, first.nextOffset);
  assert.equal(first.matches! + second.matches!, 67); assert.equal(second.endOfStream, true);
  const insensitive = await readBounded(textSource("A\nERROR x\n"), { search: "error" }, plain);
  assert.equal(insensitive.matches, 1);
  await assert.rejects(readBounded(source, { search: "(" }, plain), ReadArgumentError);
});

test("PTY output reads as final visible text; pipe output drops control sequences", () => {
  assert.equal(normalizeVisibleText("\x1b[32m10%\r50%\r100%\x1b[0m done\n"), "100% done\n");
  assert.equal(normalizeVisibleText("tick\ntick\ntick\nend"), "tick  [×3]\nend");
  assert.equal(sanitizeText("\x1b[1mbold\x1b[0m\tcol\x07\n"), "bold\tcol\n");
});
