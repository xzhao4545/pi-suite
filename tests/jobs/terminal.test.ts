import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { TerminalView, type TerminalExit } from "../../src/ui/terminal.ts";
import { manager, owner, settled, testShell } from "../support/jobs.ts";
import { terminal } from "../support/terminal.ts";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
const keys = { detachKey: "ctrl+b", returnKey: "ctrl+g", transferKey: "ctrl+t" } as const;

test("terminal view: typing takes control from the model, ctrl+g returns it, ctrl+t sends the screen, ctrl+b leaves the job running", { timeout: 30000 }, async () => {
  const jobs = manager();
  try {
    const { id } = await jobs.start({ command: "while read line; do echo \"got:$line\"; done", mode: "pty", cwd: mkdtempSync(join(tmpdir(), "pi-suite-term-")), ...owner }, testShell());
    const source = jobs.terminal(id)!;
    const exits: TerminalExit[] = [];
    const open = () => new TerminalView(terminal(24, 60), theme, source, keys, {
      title: () => id,
      write: data => { jobs.write(id, data, { source: "user", kind: "keys", sensitive: true }); },
      returnControl: () => jobs.returnControl(id), userControl: () => jobs.userControlled(id),
    }, exit => exits.push(exit));
    const view = open();
    await sleep(300);
    assert.match(view.render(60)[0], /model controls input/);
    for (const key of "abc\r") view.handleInput(key);
    assert.equal(jobs.userControlled(id), true);
    assert.throws(() => jobs.write(id, "x\r", { source: "model", kind: "text", text: "x" }), (error: { code?: string }) => error.code === "USER_CONTROL");
    view.handleInput("\x07"); // ctrl+g
    assert.equal(jobs.userControlled(id), false);
    jobs.write(id, "model\r", { source: "model", kind: "text", text: "model" });
    await sleep(500);
    view.handleInput("\x14"); // ctrl+t
    assert.equal(exits[0].action, "transfer");
    assert.ok(exits[0].screen.some(line => line.includes("got:abc")) && exits[0].screen.some(line => line.includes("got:model")), exits[0].screen.join("\n"));
    open().handleInput("\x02"); // ctrl+b
    assert.equal(exits[1].action, "detach"); assert.equal(jobs.peek(id).state, "running", "leaving the view does not stop the job");
    await jobs.stop(id, "user");
    const job = await settled(jobs, id);
    assert.equal(job.state, "stopped");
  } finally { await jobs.shutdown(Date.now() + 5000); }
});
