import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuiteConfig } from "../runtime/config.ts";
import type { SessionBinding } from "../runtime/binding.ts";
import type { Notifications } from "../runtime/notifications.ts";
import type { Dock } from "../ui/dock.ts";
import type { AskView } from "./view.ts";
import { AskQueue, cancelled } from "./queue.ts";
import { askSchema, normalize, type AskParams, type AskResult, type Question } from "./schema.ts";
import { askToolResult } from "./result.ts";

import { customRendererLookup, registerBoundTool, toolRenderer } from '../runtime/tools.ts';
import { askRenderers } from './tool-render.ts';

export class AskManager {
  private queue = new AskQueue();
  private active?: AskView;
  private rendererApi?: ExtensionAPI;
  constructor(private binding: SessionBinding, private notifications: Notifications, private dock: Dock,
    private onResult?: (status: AskResult["status"], ctx: ExtensionContext) => void | Promise<void>) {}
  setRendererApi(pi: ExtensionAPI): void { this.rendererApi = pi; }
  cancel(): void { this.active?.cancel(); }

  async ask(params: AskParams, ctx: ExtensionContext, config: SuiteConfig, signal?: AbortSignal, requester = "main"): Promise<{ result: AskResult; questions: Question[] }> {
    const questions = normalize(params);
    const captured = this.binding.current;
    if (!captured || captured.sessionId !== ctx.sessionManager.getSessionId()) return { result: cancelled(), questions };
    if (ctx.mode !== "tui") throw new Error("ask_user needs the interactive Pi terminal and is unavailable in this mode. Continue without asking, or state the open question in your reply.");
    const result = await this.queue.enqueue(async () => {
      const { Transcript } = await import('../ui/transcript.ts');
      const { AskForm } = await import('./form.ts');
      const { AskView } = await import('./view.ts');
      // Loading the first question can outlive a reload or cancellation.
      if (signal?.aborted) return cancelled();
      if (!this.binding.isCurrent(captured)) return cancelled();
      const release = this.notifications.hold();
      this.dock.setAsk(true);
      try {
        return await ctx.ui.custom<AskResult>((tui, theme, _keys, done) => {
          const pi = this.rendererApi;
          const transcript = new Transcript(tui, ctx.cwd, pi && (name => toolRenderer(pi, name)),
            pi && { theme, ...customRendererLookup(pi) });
          transcript.setEntries(ctx.sessionManager.getBranch());
          this.active = new AskView(new AskForm(questions), tui, theme, this.dock, config, transcript,
            done, params.timeoutMs ?? config.ask.timeout, signal, params.allowComment, requester, params.questions ? params.question : undefined);
          return this.active;
        }, { blocked: { kind: "question", message: questions[0].question } });
      } finally {
        this.active?.dispose(); this.active = undefined; this.dock.setAsk(false); release();
      }
    }, signal);
    // A response from a revoked view cannot authorize work in the next session or reload.
    if (!this.binding.isCurrent(captured)) return { result: cancelled(), questions };
    await this.onResult?.(result.status, ctx);
    return { result, questions };
  }
}

export function registerAsk(pi: ExtensionAPI, manager: AskManager, getConfig: () => SuiteConfig): void {
  manager.setRendererApi(pi);
  registerBoundTool(pi, {
    ...askRenderers(),
    name: "ask_user", label: "Ask user",
    description: "Ask the user one question, or 2–4 independent questions in questions. Every question also accepts custom text; multi-select can return presets plus text. User input restarts the idle timeout (default 10 minutes). Results: answered; skipped (Esc; keeps partial answers and your turn continues); timed_out (drafts, else recommended options, else the first option are auto-submitted); cancelled (aborted; ends your turn). skipped and timed_out answers are never consent.",
    promptGuidelines: ["Put batch settings inside each questions entry. Recommended options are separate from defaultOptionId/defaultOptionIds.",
      "skipped retains partial answers; unanswered entries remain unanswered. Use the supplied answers and continue independent work, or ask missing questions again later.",
      "timed_out answers are automatic recommendations, not explicit user choices. Do not use skipped, timed_out or cancelled as authorization for destructive actions or work requiring consent; ask again for explicit consent."],
    parameters: askSchema, executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const { result, questions } = await manager.ask(params, ctx, getConfig(), signal);
      return { ...askToolResult(params, questions, result), terminate: result.status === "cancelled" };
    },
  }, 'initial');
}
