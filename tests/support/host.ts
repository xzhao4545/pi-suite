import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { contentText, fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type TranscriptContext, type RegisterFauxProviderOptions } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  type ExtensionAPI, type ExtensionUIContext, type Theme, type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import piSuite from "../../src/index.ts";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { terminal } from "./terminal.ts";
import { goalStore } from '../../src/goal/store.ts';
import type { Goal } from '../../src/goal/state.ts';

/** Real SDK session with the SDK's own offline provider; no credentials or network. */
export async function host(options: {
  retry?: boolean; compact?: boolean; sessionManager?: SessionManager;
  root?: string; persisted?: boolean; sessionStartEvent?: SessionStartEvent;
  contextWindow?: number; reserveTokens?: number; keepRecentTokens?: number;
  extend?: (pi: ExtensionAPI) => void;
  additionalExtensionPaths?: string[];
  ui?: (ui: ExtensionUIContext) => ExtensionUIContext;
  answer?: "confirm" | "cancel";
  tools?: string[];
  /** Set before session_start, for turns the extension starts while binding. */
  responses?: FauxResponseStep[];
  streaming?: Pick<RegisterFauxProviderOptions, 'tokensPerSecond' | 'tokenSize'>;
} = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), "pi-suite-goal-"));
  // The extension resolves its agent dir from the environment; keep it on the session's dir.
  process.env.PI_CODING_AGENT_DIR = root;
  const faux = fauxProvider({ provider: `suite-test-${randomUUID()}`, models: [{ id: "offline", contextWindow: options.contextWindow }], ...options.streaming });
  if (options.responses) faux.setResponses(options.responses);
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: options.retry ?? false, maxRetries: 1, baseDelayMs: 1 },
    compaction: { enabled: options.compact ?? false, reserveTokens: options.reserveTokens ?? 1024, keepRecentTokens: options.keepRecentTokens ?? 128 },
  });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    additionalExtensionPaths: options.additionalExtensionPaths,
    extensionFactories: [pi => { pi.registerProvider(faux.provider); piSuite(pi); options.extend?.(pi); }],
  });
  await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({ cwd: root, agentDir: root,
    settingsManager, resourceLoader, sessionStartEvent: options.sessionStartEvent,
    sessionManager: options.sessionManager ?? (options.persisted ? SessionManager.create(root, join(root, "sessions")) : SessionManager.inMemory(root)),
    model: faux.getModel(), tools: ["ask_user", "goal_complete", "goal_blocked", "goal_wait", ...options.tools ?? []] });
  assert.deepEqual(extensionsResult.errors, []);
  const statuses = new Map<string, string | undefined>();
  const autocomplete: ((current: AutocompleteProvider) => AutocompleteProvider)[] = [];
  const notices: { text: string; type?: string }[] = [];
  const writes: (string | undefined)[] = [];
  const theme = globalThis[Symbol.for("@earendil-works/pi-coding-agent:theme") as unknown as keyof typeof globalThis] as unknown as Theme;
  const uiContext = {
    theme, setStatus(key: string, text?: string) { statuses.set(key, text); if (key === "goal") writes.push(text); },
    setWidget() {}, onTerminalInput: () => () => {}, getEditorText: () => '',
    notify(text: string, type?: string) { notices.push({ text, type }); }, confirm: async () => true,
    addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) { autocomplete.push(factory); },
    custom: async (factory: Parameters<ExtensionUIContext["custom"]>[0]) => new Promise(resolve => {
      Promise.resolve(factory(terminal(), theme, {} as never, resolve)).then(view => {
        view.render(40);
        if (options.answer === "cancel") view.handleInput?.("\x1b");
        else {
          // Enter selects and confirms in the default single-question fixtures.
          view.handleInput?.("\r"); view.handleInput?.("\t"); view.handleInput?.("\r");
        }
      });
    }),
  } as unknown as ExtensionUIContext;
  await session.bindExtensions({ uiContext: options.ui?.(uiContext) ?? uiContext, mode: "tui" });
  const goal = (): Goal | undefined => goalStore(session.extensionRunner.createContext(), root).current.goal ?? undefined;
  return { session, extensionsResult, faux, goal, statuses, writes, autocomplete, notices,
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

export function goalView(context: TranscriptContext): { goalId: string; revision: number; objective: string; status: string; access: string; budget: number | null } {
  let view: ReturnType<typeof goalView> | undefined;
  for (const message of context.messages) {
    if (message.role !== 'user') continue;
    const text = contentText(message.content);
    if (text.startsWith('Current Goal instruction:')) view = JSON.parse(text.slice(text.lastIndexOf('\n') + 1));
    else if (text.startsWith('Current Goal control')) view = { ...view, ...JSON.parse(text.slice(text.lastIndexOf('\n') + 1)) };
  }
  assert.ok(view, 'current Goal instruction must reach the provider');
  return view;
}

export function goalId(context: TranscriptContext): string { return goalView(context).goalId; }

export const complete = (context: TranscriptContext) => fauxAssistantMessage(fauxToolCall("goal_complete", {
  goalId: goalId(context), summary: "All requested checks passed",
}));
