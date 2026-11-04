import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER, Editor, Input, Key, Markdown, fuzzyFilter, matchesKey, truncateToWidth,
  visibleWidth, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type { SuiteConfig } from "../runtime/config.ts";
import type { Dock } from "../ui/dock.ts";
import { ScrollView } from "../ui/scroll.ts";
import type { Transcript } from "../ui/transcript.ts";
import { AskForm } from "./form.ts";
import type { AskResult, Option } from "./schema.ts";

type Focus = "answer" | "search" | "comment" | "actions" | "history" | "details";
export class AskView implements Component {
  focused = true;
  private focus: Focus = "answer";
  private action = 0;
  private search = new Input({ prompt: "Search: " });
  private editors: Editor[];
  private comments: Input[];
  private history: ScrollView;
  private descriptions = new Map<string, ScrollView>();
  private detailKey = "";
  private historyReturn: Focus = "answer";
  private reading?: "history" | "details";
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private countdown?: ReturnType<typeof setInterval>;
  private deadline?: number;
  private started = false;
  private height = 3;
  private abort = () => this.finish({ status: "cancelled", responses: [] });

  constructor(
    readonly form: AskForm, private tui: TUI, private theme: Theme,
    private dock: Dock, private config: SuiteConfig, private transcript: Transcript,
    private done: (result: AskResult) => void, private timeout: number,
    private signal?: AbortSignal, private allowComment = false, private requester = "main", private heading?: string,
  ) {
    const editorTheme = { borderColor: (text: string) => theme.fg("accent", text), selectList: {
      selectedPrefix: (s: string) => theme.fg("accent", s), selectedText: (s: string) => theme.fg("accent", s),
      description: (s: string) => theme.fg("muted", s), scrollInfo: (s: string) => theme.fg("dim", s), noMatch: (s: string) => theme.fg("warning", s),
    } };
    this.editors = form.drafts.map((draft, index) => {
      const editor = new Editor(tui, editorTheme, { paddingX: 0 });
      editor.setText(draft.text);
      editor.onChange = text => { form.drafts[index].text = text; };
      editor.onSubmit = text => { form.drafts[index].text = text; this.advance(); };
      return editor;
    });
    this.comments = form.drafts.map(draft => {
      const input = new Input({ prompt: "Comment: " });
      input.onSubmit = () => { draft.comment = input.getValue(); this.focus = "actions"; };
      return input;
    });
    this.search.onSubmit = () => { this.focus = "answer"; };
    this.history = new ScrollView(transcript);
    signal?.addEventListener("abort", this.abort, { once: true });
  }

  private finish(result: AskResult): void {
    // Input, expiry and abort may reach this boundary in the same event-loop turn.
    if (this.closed) return;
    this.closed = true; this.dispose(); this.done(result);
  }
  dispose(): void {
    clearTimeout(this.timer); clearInterval(this.countdown);
    this.signal?.removeEventListener("abort", this.abort);
    this.dock.setDetail(false);
  }
  cancel(): void { this.abort(); }
  invalidate(): void {
    this.editors.forEach(editor => editor.invalidate());
    this.history.invalidate(); this.descriptions.forEach(view => view.invalidate());
  }
  private options(): Option[] {
    return fuzzyFilter(this.form.question.options, this.form.draft.query, option => `${option.title} ${option.description ?? ""}`);
  }
  private get actions(): string[] {
    if (this.focus === "history" || this.focus === "details") return ["Previous page", "Next page", "Back"];
    if (this.form.reviewing) return ["Submit all", "Edit answers", "History", "Cancel"];
    return ["Confirm", ...(this.form.questions.length > 1 ? ["Previous question", "Next question"] : []),
      "History", "View details", ...(this.form.question.options.length ? ["Search"] : []),
      ...(this.form.question.options.length && this.form.question.allowFreeform ? ["Freeform"] : []),
      ...(this.allowComment ? ["Comment"] : []), "Cancel"];
  }
  private advance(): void {
    if (this.form.reviewing) {
      if (this.form.complete) this.finish({ status: "answered", responses: this.form.responses() });
    } else if (this.form.response()) {
      if (this.form.questions.length === 1) this.finish({ status: "answered", responses: this.form.responses() });
      else if (this.form.index < this.form.questions.length - 1) this.changeQuestion(1);
      else { this.form.reviewing = true; this.focus = "actions"; this.action = 0; }
    }
  }
  private changeQuestion(delta: number): void {
    this.form.index = Math.max(0, Math.min(this.form.index + delta, this.form.questions.length - 1));
    this.search.setValue(this.form.draft.query); this.focus = "answer"; this.action = 0;
  }
  private openHistory(): void {
    this.historyReturn = this.focus; this.reading = "history"; this.focus = "history"; this.action = 0; this.dock.setDetail(true);
  }
  private openDetails(): void {
    const option = this.options()[this.form.draft.cursor];
    this.detailKey = `${this.form.index}:${option?.id ?? "question"}`;
    if (!this.descriptions.has(this.detailKey)) {
      const text = [this.form.question.question, this.form.question.context, option?.title, option?.description].filter(Boolean).join("\n\n");
      this.descriptions.set(this.detailKey, new ScrollView(new Markdown(text, 0, 0, getMarkdownTheme())));
    }
    this.reading = "details"; this.focus = "details"; this.action = 0; this.dock.setDetail(true);
  }
  private get reader(): ScrollView { return this.reading === "history" ? this.history : this.descriptions.get(this.detailKey)!; }
  private closeReader(): void {
    this.focus = this.reading === "history" ? this.historyReturn : "answer";
    this.reading = undefined;
    this.action = 0; this.dock.setDetail(false);
  }
  private act(): void {
    const action = this.actions[this.action];
    if (action === "Confirm" || action === "Submit all") this.advance();
    else if (action === "Previous question") this.changeQuestion(-1);
    else if (action === "Next question") this.changeQuestion(1);
    else if (action === "History") this.openHistory();
    else if (action === "View details") this.openDetails();
    else if (action === "Search") { this.focus = "search"; this.search.setValue(this.form.draft.query); }
    else if (action === "Freeform" && this.form.question.allowFreeform) { this.form.draft.freeform = true; this.focus = "answer"; }
    else if (action === "Comment") this.focus = "comment";
    else if (action === "Edit answers") { this.form.reviewing = false; this.changeQuestion(0); }
    else if (action === "Cancel") this.abort();
    else if (action === "Previous page") this.reader.scroll(-this.height + 3);
    else if (action === "Next page") this.reader.scroll(this.height - 3);
    else if (action === "Back") this.closeReader();
  }
  handleInput(data: string): void {
    if (this.closed) return;
    if (this.reading === "history" && matchesKey(data, Key.tab)) {
      this.focus = this.focus === "history" ? "answer" : this.focus === "answer" ? "actions" : "history";
      this.action = 0; this.tui.requestRender(); return;
    }
    if (this.focus === "history" || this.focus === "details") {
      if (this.reader.searching) this.reader.handleInput(data);
      else if (matchesKey(data, Key.escape) || matchesKey(data, this.config.ask.historyKey)) this.closeReader();
      else if (matchesKey(data, Key.left)) this.action = Math.max(0, this.action - 1);
      else if (matchesKey(data, Key.right)) this.action = Math.min(this.actions.length - 1, this.action + 1);
      else if (matchesKey(data, Key.enter)) this.act();
      else if (data === "t" && this.focus === "history") this.transcript.toggleTools();
      else if (data === "i" && this.focus === "history") this.transcript.toggleThinking();
      else this.reader.handleInput(data);
    } else if (matchesKey(data, this.config.ask.historyKey)) {
      if (this.reading) this.closeReader(); else this.openHistory();
    }
    else if (matchesKey(data, Key.escape)) {
      if (this.focus !== "answer") this.focus = "answer";
      else if (this.form.draft.freeform && this.form.question.options.length) this.form.draft.freeform = false;
      else this.abort();
    } else if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "actions" ? "answer" : "actions"; this.action = 0;
    } else if (this.focus === "search") {
      this.search.handleInput(data); this.form.draft.query = this.search.getValue(); this.form.draft.cursor = 0;
    } else if (this.focus === "comment") {
      this.comments[this.form.index].handleInput(data); this.form.draft.comment = this.comments[this.form.index].getValue();
    } else if (this.focus === "actions" || this.form.reviewing) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) this.action = Math.max(0, this.action - 1);
      else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) this.action = Math.min(this.actions.length - 1, this.action + 1);
      else if (matchesKey(data, Key.enter)) this.act();
    } else if (this.form.draft.freeform) this.editors[this.form.index].handleInput(data);
    else {
      const options = this.options();
      if (matchesKey(data, Key.up)) this.form.draft.cursor = Math.max(0, this.form.draft.cursor - 1);
      else if (matchesKey(data, Key.down)) this.form.draft.cursor = Math.min(options.length - 1, this.form.draft.cursor + 1);
      else if (matchesKey(data, Key.pageUp)) this.form.draft.cursor = Math.max(0, this.form.draft.cursor - this.height + 2);
      else if (matchesKey(data, Key.pageDown)) this.form.draft.cursor = Math.min(options.length - 1, this.form.draft.cursor + this.height - 2);
      else if (data === "/") { this.focus = "search"; this.search.setValue(this.form.draft.query); }
      else if (data === "d") this.openDetails();
      else if (data === "f" && this.form.question.allowFreeform) this.form.draft.freeform = true;
      else if (matchesKey(data, Key.enter) || data === " ") {
        const option = options[this.form.draft.cursor];
        if (option) this.form.choose(option.id);
        // Selection is explicit. Confirm is separate, including single-select defaults.
      }
    }
    this.tui.requestRender();
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.reading && event.y < this.height - 2) return this.reader.handleMouse(event);
    if (event.type !== "wheel" || this.form.draft.freeform) return;
    this.form.draft.cursor = Math.max(0, Math.min(this.options().length - 1, this.form.draft.cursor + (event.wheelDelta ?? 0)));
    return { handled: true };
  }
  private renderActions(width: number): string {
    // Keep the active action visible even when the whole action strip cannot fit.
    const active = this.actions[this.action] ?? this.actions[0];
    return truncateToWidth(this.theme.fg("accent", `[${active}]`) + ` ${this.action + 1}/${this.actions.length} ←→ Enter · Tab · Esc`, width);
  }
  private answerLine(width: number): string {
    if (this.focus === "search") { this.search.focused = true; return this.search.render(width)[0]; }
    if (this.focus === "comment") { this.comments[this.form.index].focused = true; return this.comments[this.form.index].render(width)[0]; }
    if (this.form.draft.freeform) {
      const editor = this.editors[this.form.index]; editor.focused = this.focus === "answer";
      const lines = editor.render(width).slice(1, -1);
      return lines.find(line => line.includes(CURSOR_MARKER)) ?? lines[0] ?? "";
    }
    const option = this.options()[this.form.draft.cursor];
    return truncateToWidth(`${this.form.draft.selected.has(option?.id ?? "") ? "[x]" : "[ ]"} ${option?.title ?? "No matching options"}`, width);
  }
  render(width: number): string[] {
    if (!this.started) {
      this.started = true;
      if (this.signal?.aborted) this.abort();
      else if (this.timeout > 0) {
        // Start on first render, after queueing and the host's UI factory have finished.
        this.deadline = Date.now() + this.timeout;
        this.timer = setTimeout(() => this.finish({ status: "timed_out", responses: [] }), this.timeout);
        this.countdown = setInterval(() => this.tui.requestRender(), 1000);
      }
    }
    const reading = Boolean(this.reading);
    this.height = reading ? Math.max(4, Math.floor(this.tui.terminal.rows * 0.8)) : this.dock.askBudget(this.tui.terminal.rows);
    const time = this.deadline ? `${Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000))}s` : "no timeout";
    const prefix = `${this.requester} ${this.form.index + 1}/${this.form.questions.length} · ${time}`;
    if (reading) {
      const view = this.reader;
      const answer = this.reading === "history" ? [truncateToWidth(this.form.question.question, width), this.answerLine(width)] : [];
      return [truncateToWidth(`${this.reading} ${view.position} · ${time} · Tab focus · / search`, width),
        ...view.viewport(width, this.height - 2 - answer.length), ...answer,
        ...(view.searching ? view.search.render(width) : [this.renderActions(width)])];
    }
    const lines = [truncateToWidth(`${prefix} · ${this.heading ? `${this.heading} · ` : ""}${this.form.question.question}`, width)];
    const contentHeight = Math.max(1, this.height - 2);
    if (this.form.reviewing) {
      const review = this.form.questions.map((question, index) => {
        const response = this.form.response(index);
        return `${index + 1}. ${question.question}: ${response?.kind === "freeform" ? response.text : response?.selections.join(", ") ?? "unanswered"}`;
      });
      lines.push(...review.slice(Math.max(0, this.form.index - contentHeight + 1), Math.max(0, this.form.index - contentHeight + 1) + contentHeight).map(line => truncateToWidth(line, width)));
    } else if (this.focus === "search") { this.search.focused = true; lines.push(...this.search.render(width)); }
    else if (this.focus === "comment") { this.comments[this.form.index].focused = true; lines.push(...this.comments[this.form.index].render(width)); }
    else if (this.form.draft.freeform) {
      const editor = this.editors[this.form.index]; editor.focused = this.focus === "answer";
      const rendered = editor.render(width).slice(1, -1);
      const cursor = rendered.findIndex(line => line.includes(CURSOR_MARKER));
      lines.push(...rendered.slice(Math.max(0, cursor - contentHeight + 1), Math.max(0, cursor - contentHeight + 1) + contentHeight));
    } else {
      const options = this.options();
      this.form.draft.cursor = Math.max(0, Math.min(this.form.draft.cursor, options.length - 1));
      const start = Math.max(0, this.form.draft.cursor - contentHeight + 1);
      const listWidth = width >= 100 ? Math.floor(width * 0.5) : width;
      const list = options.slice(start, start + contentHeight).map((option, index) => {
        const marker = this.form.draft.selected.has(option.id) ? "[x]" : "[ ]";
        return truncateToWidth(`${start + index === this.form.draft.cursor ? ">" : " "}${marker} ${option.title}${option.recommended ? " (Recommended)" : ""}`, listWidth);
      });
      if (!list.length) list.push("No matching options");
      if (width >= 100 && options.length) {
        const option = options[this.form.draft.cursor];
        const key = `preview:${this.form.index}:${option.id}`;
        let preview = this.descriptions.get(key);
        if (!preview) {
          preview = new ScrollView(new Markdown(`${option.title}\n\n${option.description ?? ""}`, 0, 0, getMarkdownTheme()));
          this.descriptions.set(key, preview);
        }
        const detail = preview.viewport(width - listWidth - 3, contentHeight);
        for (let index = 0; index < Math.max(list.length, detail.length); index++) {
          const left = list[index] ?? "";
          lines.push(left + " ".repeat(Math.max(0, listWidth - visibleWidth(left))) + " │ " + (detail[index] ?? ""));
        }
      } else lines.push(...list);
    }
    const info = !this.form.draft.freeform ? ` · ${this.form.draft.cursor + 1}/${this.options().length} · selected ${this.form.draft.selected.size}` : "";
    const footer = truncateToWidth(this.renderActions(Math.max(1, width - Math.min(15, info.length))) + info, width);
    // On tiny terminals the focused answer takes precedence over the header.
    if (this.height === 1) return [truncateToWidth(`${lines[1] ?? lines[0]} · [${this.actions[this.action]}]`, width)];
    if (this.height === 2) return [lines[1] ?? lines[0], footer];
    lines.push(footer);
    return lines.slice(0, this.height).map(line => truncateToWidth(line, width));
  }
}
