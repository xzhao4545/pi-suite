import type { ExtensionAPI, ExtensionContext, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { SuiteConfig } from "../runtime/config.ts";
import type { SessionBinding } from "../runtime/binding.ts";
import type { Notifications } from "../runtime/notifications.ts";
import type { Dock } from "../ui/dock.ts";
import type { AskView } from "./view.ts";
import { AskQueue, cancelled } from "./queue.ts";
import { askSchema, normalize, type AskParams, type AskResult, type Question } from "./schema.ts";

import { registerBoundTool, toolRenderer } from '../runtime/tools.ts';
import { askRenderers } from './tool-render.ts';

export function askDetails(params: AskParams, questions: Question[], result: AskResult) {
  // Expired answers are recommendations, while skipped/cancelled contain no user answer.
  const common = { status: result.status, cancelled: result.status === "skipped" || result.status === "cancelled" };
  return params.questions ? {
    ...common, kind: "batch", heading: params.question, questions,
    answers: result.responses.map(response => response ? { status: "answered", response } : { status: "unanswered" }),
  } : { ...common, question: params.question, context: params.context, options: questions[0].options, response: result.responses[0] ?? null };
}

export class AskManager {
  private queue = new AskQueue();
  private active?: AskView;
  private rendererLookup?: (name: string) => ToolRenderers | undefined;
  constructor(private binding: SessionBinding, private notifications: Notifications, private dock: Dock,
    private onResult?: (status: AskResult["status"], ctx: ExtensionContext) => void) {}
  setRendererLookup(lookup: (name: string) => ToolRenderers | undefined): void { this.rendererLookup = lookup; }
  cancel(): void { this.active?.cancel(); }

  async ask(params: AskParams, ctx: ExtensionContext, config: SuiteConfig, signal?: AbortSignal, requester = "main"): Promise<{ result: AskResult; questions: Question[] }> {
    const questions = normalize(params);
    const captured = this.binding.current;
    if (!captured || captured.sessionId !== ctx.sessionManager.getSessionId()) return { result: cancelled(), questions };
    if (ctx.mode !== "tui") throw new Error("ask_user requires an interactive Pi terminal");
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
          const transcript = new Transcript(tui, ctx.cwd, this.rendererLookup);
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
    this.onResult?.(result.status, ctx);
    return { result, questions };
  }
}

export function registerAsk(pi: ExtensionAPI, manager: AskManager, getConfig: () => SuiteConfig): void {
  manager.setRendererLookup(name => toolRenderer(pi, name));
  registerBoundTool(pi, {
    ...askRenderers(),
    name: "ask_user", label: "Ask user",
    description: "Ask one focused question or 2–4 independent questions. User input resets the idle timeout (default 10 minutes). Expiry submits drafts, else recommended options, else the first option; timed_out answers are auto-selected, never consent. Esc skips without stopping your response.",
    promptGuidelines: ["Put batch settings inside each questions entry. Recommended options are separate from defaultOptionId/defaultOptionIds.",
      "skipped means the user did not answer: continue work that does not depend on the answer, or ask again later.",
      "timed_out answers are automatic recommendations, not explicit user choices. Do not use skipped, timed_out or cancelled as authorization for destructive actions or work requiring consent; ask again for explicit consent."],
    parameters: askSchema, executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const { result, questions } = await manager.ask(params, ctx, getConfig(), signal);
      const record = askDetails(params, questions, result);
      return { content: [{ type: "text", text: JSON.stringify(record) }], details: record,
        terminate: result.status === "cancelled" };
    },
  }, 'initial');
}
