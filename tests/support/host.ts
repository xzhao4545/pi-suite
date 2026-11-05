import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  type ExtensionAPI, type ExtensionUIContext, type Theme, type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import piSuite from "../../src/index.ts";
import { terminal } from "./terminal.ts";
import { GOAL_ENTRY, type Goal } from "../../src/goal/state.ts";

/** Real SDK session with the SDK's own offline provider; no credentials or network. */
export async function host(options: {
  retry?: boolean; compact?: boolean; sessionManager?: SessionManager;
  root?: string; persisted?: boolean; sessionStartEvent?: SessionStartEvent;
  contextWindow?: number; reserveTokens?: number;
  extend?: (pi: ExtensionAPI) => void;
  answer?: "confirm" | "cancel";
  tools?: string[];
  /** Set before session_start, for turns the extension starts while binding. */
  responses?: FauxResponseStep[];
} = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "pi-suite-goal-"));
  // The extension resolves its agent dir from the environment; keep it on the session's dir.
  process.env.PI_CODING_AGENT_DIR = root;
  const faux = fauxProvider({ provider: `suite-test-${randomUUID()}`, models: [{ id: "offline", contextWindow: options.contextWindow }] });
  if (options.responses) faux.setResponses(options.responses);
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: options.retry ?? false, maxRetries: 1, baseDelayMs: 1 },
    compaction: { enabled: options.compact ?? false, reserveTokens: options.reserveTokens ?? 1024, keepRecentTokens: 128 },
  });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [pi => { pi.registerProvider(faux.provider); piSuite(pi); options.extend?.(pi); }],
  });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd: root, agentDir: root,
    settingsManager, resourceLoader, sessionStartEvent: options.sessionStartEvent,
    sessionManager: options.sessionManager ?? (options.persisted ? SessionManager.create(root, join(root, "sessions")) : SessionManager.inMemory(root)),
    model: faux.getModel(), tools: ["ask_user", "goal_complete", "goal_blocked", "goal_wait", ...options.tools ?? []] });
  assert.deepEqual(extensionsResult.errors, []);
  const statuses = new Map<string, string | undefined>();
  const writes: (string | undefined)[] = [];
  const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme") as unknown as keyof typeof globalThis] as unknown as Theme;
  const uiContext = {
    theme, setStatus(key: string, text?: string) { statuses.set(key, text); if (key === "goal") writes.push(text); },
    setWidget() {}, notify() {}, confirm: async () => true,
    custom: async (factory: Parameters<ExtensionUIContext["custom"]>[0]) => new Promise(resolve => {
      Promise.resolve(factory(terminal(), theme, {} as never, resolve)).then(view => {
        view.render(40);
        if (options.answer === "cancel") view.handleInput?.("\x1b");
        else {
          // A selection needs both choosing the focused option and confirming it in actions.
          view.handleInput?.("\r"); view.handleInput?.("\t"); view.handleInput?.("\r");
        }
      });
    }),
  } as unknown as ExtensionUIContext;
  await session.bindExtensions({ uiContext, mode: "tui" });
  const goal = (): Goal | undefined => {
    const entry = session.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === GOAL_ENTRY);
    return entry?.type === "custom" ? (entry.data as { goal: Goal | null }).goal ?? undefined : undefined;
  };
  return { session, extensionsResult, faux, goal, statuses, writes,
    services: { cwd: root, agentDir: root, modelRuntime: session.modelRuntime, settingsManager, resourceLoader, diagnostics: [] },
    async idle() { await session.waitForIdle(); },
    async dispose() {
      await session.abort();
      // The SDK host owns shutdown delivery; dispose alone only invalidates contexts.
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose(); if (!options.root) rmSync(root, { recursive: true, force: true });
    },
  };
}

export function goalId(context: TranscriptContext): string {
  const sections: Record<string, string | null> = {};
  for (const message of context.messages) if (message.role === "system") Object.assign(sections, message.sections);
  const id = /Active goal ([^:]+):/.exec(sections["pi-suite-goal"] ?? "")?.[1];
  assert.ok(id, "admitted goal must reach the provider's system contract");
  return id;
}

export const complete = (context: TranscriptContext) => fauxAssistantMessage(fauxToolCall("goal_complete", {
  goalId: goalId(context), summary: "All requested checks passed",
}));
