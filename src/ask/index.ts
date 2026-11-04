import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuiteConfig } from "../runtime/config.ts";
import type { SessionBinding } from "../runtime/binding.ts";
import type { Notifications } from "../runtime/notifications.ts";
import type { Dock } from "../ui/dock.ts";
import { Transcript } from "../ui/transcript.ts";
import { AskForm } from "./form.ts";
import { AskQueue, cancelled } from "./queue.ts";
import { askSchema, normalize, type AskParams, type AskResult, type Question } from "./schema.ts";
import { AskView } from "./view.ts";

function details(params: AskParams, questions: Question[], result: AskResult) {
  // Keep the upstream non-answer flag while status distinguishes expiry from cancellation.
  const common = { status: result.status, cancelled: result.status !== "answered" };
  return params.questions ? {
    ...common, kind: "batch", heading: params.question, questions,
    answers: result.responses.map(response => ({ status: "answered", response })),
  } : { ...common, question: params.question, context: params.context, options: questions[0].options, response: result.responses[0] ?? null };
}

export class AskManager {
  private queue = new AskQueue();
  private active?: AskView;
  constructor(private binding: SessionBinding, private notifications: Notifications, private dock: Dock,
    private onResult?: (answered: boolean, ctx: ExtensionContext) => void) {}
  cancel(): void { this.active?.cancel(); }

  async ask(params: AskParams, ctx: ExtensionContext, config: SuiteConfig, signal?: AbortSignal, requester = "main"): Promise<{ result: AskResult; questions: Question[] }> {
    const questions = normalize(params);
    const captured = this.binding.current;
    if (!captured || captured.sessionId !== ctx.sessionManager.getSessionId()) return { result: cancelled(), questions };
    if (ctx.mode !== "tui") throw new Error("ask_user requires an interactive Pi terminal");
    const result = await this.queue.enqueue(async () => {
      if (!this.binding.isCurrent(captured)) return cancelled();
      const release = this.notifications.hold();
      this.dock.setAsk(true);
      try {
        return await ctx.ui.custom<AskResult>((tui, theme, _keys, done) => {
          const transcript = new Transcript(tui, ctx.cwd);
          transcript.setEntries(ctx.sessionManager.getBranch());
          this.active = new AskView(new AskForm(questions), tui, theme, this.dock, config, transcript,
            done, params.timeout ?? config.ask.timeout, signal, params.allowComment, requester, params.questions ? params.question : undefined);
          return this.active;
        }, { blocked: { kind: "question", message: questions[0].question } });
      } finally {
        this.active?.dispose(); this.active = undefined; this.dock.setAsk(false); release();
      }
    }, signal);
    if (this.binding.isCurrent(captured)) this.onResult?.(result.status === "answered", ctx);
    return { result, questions };
  }
}

export function registerAsk(pi: ExtensionAPI, manager: AskManager, getConfig: () => SuiteConfig): void {
  pi.registerTool({
    name: "ask_user", label: "Ask user",
    description: "Ask one focused question or 2–4 independent questions. Defaults only prefill; explicit confirmation is required. timed_out is never consent.",
    promptGuidelines: ["Put batch settings inside each questions entry. Recommended options are separate from defaultOptionId/defaultOptionIds.",
      "Do not proceed with work requiring consent when status is timed_out or cancelled."],
    parameters: askSchema, executionMode: "sequential",
    async execute(_id, params, signal, _update, ctx) {
      const { result, questions } = await manager.ask(params, ctx, getConfig(), signal);
      const record = details(params, questions, result);
      return { content: [{ type: "text", text: JSON.stringify(record) }], details: record,
        terminate: result.status !== "answered" };
    },
  });
}
