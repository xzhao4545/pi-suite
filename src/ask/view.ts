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
import { askKey } from "./keys.ts";
import { idleTime, optionRow, questionTabs, questionType, reviewRows, type TabRegion } from "./render.ts";

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
  private notice = "";
  private reviewCursor = 0;
  private tabRegions: TabRegion[] = [];
  private listRegion = { y: 0, start: 0, count: 0 };
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
      // Native submission clears the chat editor. Ask confirms without clearing so
      // revisiting a question retains both its draft and native editing position.
      editor.disableSubmit = true;
      editor.setText(draft.text);
      editor.onChange = text => { form.drafts[index].text = text; };
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
  private skip(): void { this.finish({ status: "skipped", responses: [] }); }
  private touch(): void {
    if (!this.started || this.closed || this.timeout === 0) return;
    this.deadline = Date.now() + this.timeout;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(this.form.expire()), this.timeout);
  }
  invalidate(): void {
    this.editors.forEach(editor => editor.invalidate());
    this.history.invalidate(); this.descriptions.forEach(view => view.invalidate());
  }
  private options(): Option[] {
    return fuzzyFilter(this.form.question.options, this.form.draft.query, option => `${option.title} ${option.description ?? ""}`);
  }
  private get actions(): string[] {
    if (this.focus === "history" || this.focus === "details") return ["Previous page", "Next page", "Back"];
    if (this.form.reviewing) return ["Submit", "History", "Skip"];
    return ["View details", "History", ...(this.form.question.options.length ? ["Search"] : []),
      ...(this.allowComment ? ["Comment"] : []), "Skip"];
  }
  private advance(): void {
    if (this.form.reviewing) {
      if (this.form.complete) this.finish({ status: "answered", responses: this.form.responses() });
      else this.notice = `${this.form.questions.filter((_, index) => !this.form.answered(index)).length} unanswered`;
    } else if (this.form.response()) {
      if (this.form.questions.length === 1) this.finish({ status: "answered", responses: this.form.responses() });
      else this.changeQuestion(1);
    } else this.notice = this.form.question.allowMultiple && !this.form.draft.editing ? "Space to select" : "Answer required";
  }
  private selectPage(page: number): void {
    this.form.reviewing = page === this.form.questions.length;
    if (!this.form.reviewing) this.form.index = page;
    this.search.setValue(this.form.draft.query); this.focus = "answer"; this.action = 0; this.notice = "";
  }
  private changeQuestion(delta: number): void {
    if (this.form.questions.length === 1) return;
    const count = this.form.questions.length + 1;
    const page = this.form.reviewing ? count - 1 : this.form.index;
    this.selectPage((page + delta + count) % count);
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
    if (action === "Submit") this.advance();
    else if (action === "History") this.openHistory();
    else if (action === "View details") this.openDetails();
    else if (action === "Search") this.openSearch();
    else if (action === "Comment") this.focus = "comment";
    else if (action === "Skip") this.skip();
    else if (action === "Previous page") this.reader.scroll(-this.height + 3);
    else if (action === "Next page") this.reader.scroll(this.height - 3);
    else if (action === "Back") this.closeReader();
  }
  private openSearch(): void { this.focus = "search"; this.search.setValue(this.form.draft.query); }
  private editText(): void { this.form.draft.freeform = true; this.form.draft.editing = true; this.focus = "answer"; }
  private pageKey(data: string): void {
    if (this.form.reviewing) {
      if (matchesKey(data, Key.up) || matchesKey(data, Key.pageUp)) this.reviewCursor = Math.max(0, this.reviewCursor - 1);
      else if (matchesKey(data, Key.down) || matchesKey(data, Key.pageDown)) this.reviewCursor = Math.min(this.form.questions.length - 1, this.reviewCursor + 1);
    }
    const action = askKey(data, this.form, this.options(), this.height);
    if (action === "confirm") this.advance();
    else if (action === "previous") this.changeQuestion(-1);
    else if (action === "next") this.changeQuestion(1);
    else if (action === "search") this.openSearch();
    else if (action === "details") this.openDetails();
    else if (action === "text") this.editText();
  }
  handleInput(data: string): void {
    if (this.closed) return;
    this.touch(); this.notice = "";
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
    } else if (matchesKey(data, Key.escape)) {
      if (this.focus !== "answer") this.focus = "answer";
      else if (!this.form.reviewing && this.form.draft.editing && this.form.question.options.length) this.form.draft.editing = false;
      else this.skip();
    } else if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "actions" ? "answer" : "actions"; this.action = 0;
    } else if (this.focus === "search") {
      this.search.handleInput(data); this.form.draft.query = this.search.getValue(); this.form.draft.cursor = 0;
    } else if (this.focus === "comment") {
      this.comments[this.form.index].handleInput(data); this.form.draft.comment = this.comments[this.form.index].getValue();
    } else if (this.focus === "actions") {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) this.action = Math.max(0, this.action - 1);
      else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) this.action = Math.min(this.actions.length - 1, this.action + 1);
      else if (matchesKey(data, Key.enter)) this.act();
    } else if (!this.form.reviewing && this.form.draft.editing) {
      if (matchesKey(data, Key.enter)) this.advance();
      else this.editors[this.form.index].handleInput(data);
    }
    else this.pageKey(data);
    this.tui.requestRender();
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.closed) return;
    let result: TuiMouseEventResult | undefined;
    if (this.reading && event.y < this.height - 2) result = this.reader.handleMouse(event);
    else if (!this.reading && event.type === "click" && event.button === "left" && event.y === 0 && this.tabRegions.length) {
      const tab = this.tabRegions.find(tab => event.x >= tab.start && event.x < tab.end);
      if (tab) { this.selectPage(tab.page); result = { handled: true }; }
    } else if (!this.reading && event.type === "wheel" && (this.form.reviewing || !this.form.draft.editing)) {
      if (this.form.reviewing) this.reviewCursor = Math.max(0, Math.min(this.form.questions.length - 1, this.reviewCursor + (event.wheelDelta ?? 0)));
      else this.form.draft.cursor = Math.max(0, Math.min(this.options().length - 1 + Number(this.form.question.allowFreeform), this.form.draft.cursor + (event.wheelDelta ?? 0)));
      result = { handled: true };
    } else if (!this.reading && !this.form.reviewing && !this.form.draft.editing && event.type === "click" && event.button === "left") {
      const row = event.y - this.listRegion.y;
      if (row >= 0 && row < this.listRegion.count) {
        this.form.draft.cursor = this.listRegion.start + row; this.focus = "answer"; this.pageKey(" "); result = { handled: true };
      }
    }
    if (result?.handled) { this.touch(); this.notice = ""; this.tui.requestRender(); }
    return result;
  }
  private get escapeHint(): string {
    return this.reading || this.focus !== "answer" || (!this.form.reviewing && this.form.draft.editing && this.form.question.options.length) ? "Esc back" : "Esc skip";
  }
  private renderActions(width: number): string {
    const active = this.actions[this.action] ?? this.actions[0];
    return truncateToWidth(`${this.escapeHint} · Tab · ` + this.theme.fg("accent", `[${active}]`) + ` ${this.action + 1}/${this.actions.length} ←→ Enter`, width);
  }
  private editorLines(width: number, height: number): string[] {
    const editor = this.editors[this.form.index]; editor.focused = this.focus === "answer";
    const rendered = editor.render(Math.max(1, width - 2)).slice(1, -1);
    const cursor = rendered.findIndex(line => line.includes(CURSOR_MARKER));
    const start = Math.max(0, cursor - height + 1);
    return rendered.slice(start, start + height).map(line => this.theme.fg("accent", "✎ ") + line);
  }
  private answerLine(width: number): string {
    if (this.focus === "search") { this.search.focused = true; return this.search.render(width)[0]; }
    if (this.focus === "comment") { this.comments[this.form.index].focused = true; return this.comments[this.form.index].render(width)[0]; }
    if (this.form.reviewing) return reviewRows(this.form, this.theme, width)[this.reviewCursor];
    if (this.form.draft.editing) return this.editorLines(width, 1)[0] ?? "";
    const options = this.options();
    if (!options.length && !this.form.question.allowFreeform) return "No matching options";
    return truncateToWidth(optionRow(this.theme, this.form.question, this.form.draft, options[this.form.draft.cursor], this.focus === "answer"), width);
  }
  private optionLines(width: number, height: number, y: number): string[] {
    const options = this.options(), choices = [...options, ...this.form.question.allowFreeform ? [undefined] : []];
    this.form.draft.cursor = Math.max(0, Math.min(this.form.draft.cursor, choices.length - 1));
    const start = Math.max(0, this.form.draft.cursor - height + 1);
    const listWidth = width >= 100 ? Math.floor(width * 0.5) : width;
    const list = choices.slice(start, start + height).map((option, index) => truncateToWidth(
      optionRow(this.theme, this.form.question, this.form.draft, option, start + index === this.form.draft.cursor && this.focus === "answer"), listWidth));
    this.listRegion = { y, start, count: list.length };
    const option = options[this.form.draft.cursor];
    if (!list.length) return ["No matching options"];
    if (width < 100 || !option) return list;
    const key = `preview:${this.form.index}:${option.id}`;
    let preview = this.descriptions.get(key);
    if (!preview) {
      preview = new ScrollView(new Markdown(`${option.title}\n\n${option.description ?? ""}`, 0, 0, getMarkdownTheme()));
      this.descriptions.set(key, preview);
    }
    const detail = preview.viewport(width - listWidth - 3, height);
    return Array.from({ length: Math.max(list.length, detail.length) }, (_, index) => {
      const left = list[index] ?? "";
      return left + " ".repeat(Math.max(0, listWidth - visibleWidth(left))) + " │ " + (detail[index] ?? "");
    });
  }
  render(width: number): string[] {
    if (!this.started) {
      this.started = true;
      if (this.signal?.aborted) this.abort();
      else if (this.timeout > 0) {
        // First render is the display boundary; queued views consume no idle time.
        this.touch(); this.countdown = setInterval(() => this.tui.requestRender(), 1000);
      }
    }
    this.height = this.reading ? Math.max(4, Math.floor(this.tui.terminal.rows * 0.8)) : this.dock.askBudget(this.tui.terminal.rows);
    this.tabRegions = []; this.listRegion = { y: 0, start: 0, count: 0 };
    const time = idleTime(this.deadline);
    if (this.reading) {
      const answer = this.reading === "history" ? [truncateToWidth(this.form.question.question, width), this.answerLine(width)] : [];
      return [truncateToWidth(`${this.reading} ${this.reader.position} · ${time} · Tab focus · / search`, width),
        ...this.reader.viewport(width, this.height - 2 - answer.length), ...answer,
        ...(this.reader.searching ? this.reader.search.render(width) : [this.renderActions(width)])];
    }
    // Tiny layouts reserve the focused editor/control first; extra metadata shares
    // its header rather than increasing the Dock's terminal-height allowance.
    if (this.height < 3) {
      const answer = this.focus === "actions" ? this.renderActions(width) : this.answerLine(width);
      return this.height === 1 ? [truncateToWidth(answer, width)] : [truncateToWidth(answer, width), this.renderActions(width)];
    }
    const batch = this.form.questions.length > 1;
    const lines: string[] = [];
    if (batch) {
      const tabs = questionTabs(this.form, this.theme, width);
      this.tabRegions = tabs.regions;
      lines.push(truncateToWidth(tabs.line + ` · ${time}`, width));
    }
    const title = this.form.reviewing ? "Review" : this.form.question.question;
    const metadata = ` · Q${this.form.index + 1}/${this.form.questions.length}${batch ? "" : ` · ${time}`}`;
    const label = `${this.requester} · ${this.heading ? `${this.heading} · ` : ""}${title} · ${questionType(this.form)}`;
    // Keep inactivity time and page identity visible even for long titles.
    const header = truncateToWidth(label, Math.max(0, width - visibleWidth(metadata)), "") + truncateToWidth(metadata, width);
    if (!batch || this.height > 3) lines.push(header);
    const bodyHeight = Math.max(1, this.height - lines.length - 1);
    if (this.form.reviewing) {
      const review = reviewRows(this.form, this.theme, width);
      const start = Math.max(0, this.reviewCursor - bodyHeight + 1);
      lines.push(...review.slice(start, start + bodyHeight));
    } else if (this.focus === "search" || this.focus === "comment") lines.push(this.answerLine(width));
    else if (this.form.draft.editing) lines.push(...this.editorLines(width, bodyHeight));
    else lines.push(...this.optionLines(width, bodyHeight, lines.length));
    if (batch && this.height === 3 && !this.form.reviewing) {
      // One body line on a short terminal can still show both the question and its answer.
      const tag = !this.form.question.options.length ? "✎ Text" : this.form.question.allowMultiple ? `☐ Multi ${this.form.draft.selected.size}` : "○ Single";
      const prefix = truncateToWidth(`${tag} ${this.form.question.question}`, Math.floor(width * 0.4), "") + ": ";
      if (this.form.draft.editing) lines[1] = prefix + this.editorLines(Math.max(1, width - visibleWidth(prefix)), 1)[0];
      else lines[1] = prefix + truncateToWidth(lines[1], Math.max(1, width - visibleWidth(prefix)));
    }
    const footer = this.notice ? truncateToWidth(this.theme.fg("warning", this.notice) + ` · ${this.escapeHint}`, width) : this.renderActions(width);
    lines.push(footer);
    return lines.slice(0, this.height).map(line => truncateToWidth(line, width));
  }
}
