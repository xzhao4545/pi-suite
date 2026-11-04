import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import piSuite from "../../src/index.ts";
import { terminal } from "../support/terminal.ts";

test("actual Pi SDK registers one ask_user and executes typed results through its native tool wrapper", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-suite-host-"));
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root, agentDir: root, settingsManager, noExtensions: true,
    noSkills: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [piSuite],
  });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd: root, agentDir: root,
    settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(root), tools: ["ask_user"] });
  try {
    assert.deepEqual(extensionsResult.errors, []);
    const tui = terminal();
    const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme") as unknown as keyof typeof globalThis] as unknown as Theme;
    const uiContext = {
      theme, setStatus() {}, setWidget() {}, notify() {},
      custom: async (factory: Parameters<ExtensionUIContext["custom"]>[0]) => new Promise(resolve => {
        Promise.resolve(factory(tui, theme, {} as never, resolve)).then(view => {
          view.render(40); view.handleInput?.("\r");
        });
      }),
    } as unknown as ExtensionUIContext;
    await session.bindExtensions({ uiContext, mode: "tui" });
    const tools = session.agent.state.tools.filter(tool => tool.name === "ask_user");
    assert.equal(tools.length, 1);
    const result = await tools[0].execute("ask:1", { question: "Branch", defaultAnswer: "feature/test", timeoutMs: 0 });
    const details = result.details as { status: string; response: { kind: string; text: string }; cancelled: boolean };
    assert.equal(details.status, "answered"); assert.equal(details.cancelled, false);
    assert.deepEqual(details.response, { kind: "freeform", text: "feature/test" });
  } finally { session.dispose(); rmSync(root, { recursive: true, force: true }); }
});
