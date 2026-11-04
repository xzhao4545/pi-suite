import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { JobManager } from "../../src/jobs/manager.ts";
import { isTerminal } from "../../src/jobs/state.ts";
import type { ResolvedShellConfig } from "../../src/jobs/terminal/shell.ts";
import type { JobSummary } from "../../src/jobs/types.ts";

/** Git Bash on Windows (Pi's default may be WSL bash, which reads commands from stdin); bash elsewhere. */
export function bashPath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const fromEnv = process.env.PI_SUITE_TEST_BASH;
  if (fromEnv) return fromEnv;
  const exec = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const bash = resolve(exec, "..", "..", "..", "bin", "bash.exe");
  assert.ok(existsSync(bash), `Git Bash not found at ${bash}; set PI_SUITE_TEST_BASH`);
  return bash;
}
export function testShell(): ResolvedShellConfig {
  const config = getShellConfig(bashPath());
  return { shell: config.shell, args: config.args, commandTransport: config.commandTransport ?? "argv" };
}
/** Temp agent dir whose settings.json selects the test Bash, as a user would configure it. */
export function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-suite-jobs-"));
  const shellPath = bashPath();
  if (shellPath) writeFileSync(join(dir, "settings.json"), JSON.stringify({ shellPath }));
  return dir;
}
let counter = 0;
export function manager(dir = agentDir()): JobManager {
  return new JobManager({ agentDir: dir, runtimeId: `rt_${(++counter).toString(16).padStart(8, "0")}` });
}
export async function settled(jobs: JobManager, id: string, timeoutMs = 10000): Promise<JobSummary> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = jobs.peek(id);
    if (isTerminal(job.state) && job.cleanup.state !== "pending") return job;
    assert.ok(Date.now() < deadline, `${id} did not settle: ${job.state}`);
    await new Promise(r => setTimeout(r, 25));
  }
}
export const owner = { ownerSessionId: "session-a", anchorEntryId: null };
