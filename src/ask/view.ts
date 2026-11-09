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
import { answerText, idleTime, optionRow, questionTabs, type TabRegion } from "./render.ts";

import { choiceLines, frame, frameLines, listWindow, questionLines, reviewLines, topBorder, type ListPosition } from './layout.ts';

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
  private listRegion = { y: 0, x: 0, width: 0, indices: [] as number[] };
  private tabY = 0;
  private scrollPosition = { offset: 0, total: 0, height: 0 };
  private readerRegion = { y: 0, height: 0 };
  private previewRegion?: { x: number; y: number; width: number; height: number; view: ScrollView };
  private expanded = false;
  private collapsible = false;
  private measured = '';
  private inlineHeight = 3;
  private positions = new Map<number, ListPosition>();
  private position(): ListPosition {
    const key = this.form.reviewing ? -1 : this.form.index;
    if (!this.positions.has(key)) this.positions.set(key, { offset: 0, cursor: -1 });
    return this.positions.get(key)!;
  }
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
  private skip(): void { this.finish(this.form.skip()); }
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
    const expand = this.expanded ? ["Collapse"] : this.collapsible ? ["Expand"] : [];
    if (this.form.reviewing) return ["Submit", "View details", ...expand, "History", "Skip"];
    return ["View details", ...expand, "History", ...(this.form.question.options.length ? ["Search"] : []),
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
    this.form.draft.editing = false;
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
    const index = this.form.reviewing ? this.reviewCursor : this.form.index;
    const question = this.form.questions[index];
    const option = this.form.reviewing || this.form.draft.editing ? undefined : this.options()[this.form.draft.cursor];
    const response = this.form.reviewing ? this.form.response(index) : undefined;
    const text = [this.requester, this.heading, question.question, question.context, option?.title, option?.description,
      ...!this.form.reviewing && !option && this.form.draft.text ? [`✎ ${this.form.draft.text}`] : [],
      response ? answerText(response) : undefined, response?.comment].filter(Boolean).join("\n\n");
    this.detailKey = `details:${index}:${option?.id ?? 'question'}`;
    let reader = this.descriptions.get(this.detailKey);
    if (!reader) { reader = new ScrollView(new Markdown(text, 0, 0, getMarkdownTheme())); this.descriptions.set(this.detailKey, reader); }
    else reader.setContent(new Markdown(text, 0, 0, getMarkdownTheme()));
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
    else if (action === "Expand" || action === "Collapse") this.toggleExpanded();
    else if (action === "Search") this.openSearch();
    else if (action === "Comment") this.focus = "comment";
    else if (action === "Skip") this.skip();
    else if (action === "Previous page") this.reader.scroll(-this.height + 3);
    else if (action === "Next page") this.reader.scroll(this.height - 3);
    else if (action === "Back") this.closeReader();
  }
  private openSearch(): void { this.focus = "search"; this.search.setValue(this.form.draft.query); }
  private editText(): void {
    this.form.editText(); this.form.draft.cursor = this.options().length; this.focus = "answer";
  }
  private toggleExpanded(): void { this.expanded = !this.expanded; this.measured = ''; }
  private pageKey(data: string): void {
    if (this.expanded && (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown))) {
      this.position().offset += (matchesKey(data, Key.pageUp) ? -1 : 1) * Math.max(1, this.listRegion.indices.length - 1); return;
    }
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
    else if (action === "expand" && (this.collapsible || this.expanded)) this.toggleExpanded();
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
      else if (!this.form.reviewing && this.form.draft.editing) this.form.draft.editing = false;
      else this.skip();
    } else if (matchesKey(data, Key.tab)) {
      this.focus = this.focus === "actions" ? "answer" : "actions"; this.action = 0;
    } else if (this.focus === "search") {
      this.search.handleInput(data); this.form.draft.query = this.search.getValue(); this.form.draft.cursor = 0; this.position().offset = 0; this.position().cursor = -1;
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
    const preview = this.previewRegion;
    if (this.reading && event.y >= this.readerRegion.y && event.y < this.readerRegion.y + this.readerRegion.height)
      result = this.reader.handleMouse({ ...event, y: event.y - this.readerRegion.y });
    else if (!this.reading && event.type === "click" && event.button === "left" && event.y === this.tabY && this.tabRegions.length) {
      const tab = this.tabRegions.find(tab => event.x >= tab.start && event.x < tab.end);
      if (tab) { this.selectPage(tab.page); result = { handled: true }; }
    } else if (!this.reading && preview && event.x >= preview.x && event.x < preview.x + preview.width
      && event.y >= preview.y && event.y < preview.y + preview.height) result = preview.view.handleMouse(event);
    else if (!this.reading && event.x >= this.listRegion.x && event.x < this.listRegion.x + this.listRegion.width
      && event.y >= this.listRegion.y && event.y < this.listRegion.y + this.listRegion.indices.length) {
      if (event.type === 'wheel') {
        if (this.form.reviewing) this.reviewCursor = Math.max(0, Math.min(this.form.questions.length - 1, this.reviewCursor + (event.wheelDelta ?? 0)));
        else this.form.draft.cursor = Math.max(0, Math.min(this.options().length, this.form.draft.cursor + (event.wheelDelta ?? 0)));
        result = { handled: true };
      } else if (event.type === 'click' && event.button === 'left') {
        const index = this.listRegion.indices[event.y - this.listRegion.y];
        this.focus = 'answer';
        if (this.form.reviewing) this.reviewCursor = index;
        else { this.form.draft.cursor = index; this.pageKey(' '); }
        result = { handled: true };
      }
    }
    if (result?.handled) { this.touch(); this.notice = ""; this.tui.requestRender(); }
    return result;
  }
  private get escapeHint(): string {
    return this.reading || this.focus !== "answer" || (!this.form.reviewing && this.form.draft.editing) ? "Esc back" : "Esc skip";
  }
  private renderActions(width: number): string {
    const active = this.actions[this.action] ?? this.actions[0];
    const listFocus = this.focus === 'answer' && (this.form.reviewing || !this.form.draft.editing);
    const hint = !this.reading && listFocus ? `${this.expanded ? ' · e collapse' : this.collapsible ? ' · e expand' : ''} · d full text` : '';
    const controls = this.theme.fg('accent', `[${active}]`) + ` · ${this.escapeHint} · Tab · ${this.action + 1}/${this.actions.length} ←→ Enter`;
    return truncateToWidth(controls, Math.max(0, width - visibleWidth(hint)), '') + hint;
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
    if (this.form.reviewing) return reviewLines(this.form, this.theme, width, false)[this.reviewCursor][0];
    if (this.form.draft.editing) return this.editorLines(width, 1)[0] ?? "";
    const options = this.options();
    return truncateToWidth(optionRow(this.theme, this.form.question, this.form.draft, options[this.form.draft.cursor], this.focus === "answer"), width);
  }
  private preview(option: Option): ScrollView {
    const key = `preview:${this.form.index}:${option.id}`;
    if (!this.descriptions.has(key)) this.descriptions.set(key,
      new ScrollView(new Markdown(`${option.title}\n\n${option.description ?? ''}`, 0, 0, getMarkdownTheme())));
    return this.descriptions.get(key)!;
  }
  private optionLines(width: number, height: number, y: number, x: number): string[] {
    const options = this.options(), choices = [...options, undefined];
    this.form.draft.cursor = Math.max(0, Math.min(this.form.draft.cursor, choices.length - 1));
    const wide = this.tui.terminal.columns >= 100, listWidth = wide ? Math.floor(width * 0.5) : width;
    const blocks = choices.map((option, index) => choiceLines(this.theme, this.form.question, this.form.draft, option,
      index === this.form.draft.cursor && this.focus === 'answer', listWidth, this.expanded, wide));
    const list = listWindow(blocks, this.form.draft.cursor, height, this.position());
    this.listRegion = { y, x, width: listWidth, indices: list.indices };
    this.scrollPosition = { offset: this.position().offset, total: list.total, height };
    if (!list.lines.length) return ['No matching options'];
    const option = options[this.form.draft.cursor];
    if (!wide || !option) return list.lines;
    const preview = this.preview(option), previewWidth = width - listWidth - 3;
    let detail = preview.viewport(previewWidth, height);
    if (!preview.atBottom) detail = [...detail.slice(0, height - 1), this.theme.fg('dim', '↓ more · d full text')];
    this.previewRegion = { x: x + listWidth + 3, y, width: previewWidth, height, view: preview };
    return Array.from({ length: height }, (_, index) => {
      const left = list.lines[index] ?? '';
      return left + ' '.repeat(Math.max(0, listWidth - visibleWidth(left))) + ' │ ' + (detail[index] ?? '');
    });
  }
  private measure(width: number, limit: number): number {
    const geometry = frame(width, limit), batch = Number(this.form.questions.length > 1);
    const chrome = 3 + batch + (geometry.separators ? 2 : 0);
    const headerCap = Math.max(0, Math.min(this.expanded ? limit : 4, limit - chrome - 3));
    const wide = this.tui.terminal.columns >= 100, listWidth = wide ? Math.floor(geometry.width * 0.5) : geometry.width;
    const heights = this.form.questions.map((question, index) => {
      const header = questionLines(question, this.theme, geometry.width, headerCap, this.expanded).length;
      const options = [...question.options, undefined].reduce((height, option) => height + choiceLines(this.theme, question, this.form.drafts[index], option,
        false, listWidth, this.expanded, wide).length, 0);
      const preview = wide ? Math.max(0, ...question.options.map(option => this.previewForMeasure(option, geometry.width - listWidth - 3))) : 0;
      return chrome + header + Math.max(1, options, preview);
    });
    if (batch) heights.push(chrome + reviewLines(this.form, this.theme, geometry.width, this.expanded).flat().length);
    return Math.min(limit, Math.max(5, ...heights));
  }
  private previewForMeasure(option: Option, width: number): number {
    return new Markdown(`${option.title}\n\n${option.description ?? ''}`, 0, 0, getMarkdownTheme()).render(width).length;
  }
  private canExpand(width: number, headerCap: number): boolean {
    if (this.form.reviewing) return reviewLines(this.form, this.theme, width, true).some(lines => lines.length > 1);
    const question = this.form.question;
    const full = questionLines(question, this.theme, width, Number.MAX_SAFE_INTEGER, true);
    const wide = this.tui.terminal.columns >= 100, listWidth = wide ? Math.floor(width * 0.5) : width;
    return full.length > headerCap || [...question.options, undefined].some(option =>
      choiceLines(this.theme, question, this.form.draft, option, false, listWidth, true, false).length >
      choiceLines(this.theme, question, this.form.draft, option, false, listWidth, false, wide).length) ||
      visibleWidth(`${this.requester} ${this.heading ?? ''}`) > width - 30;
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
    const limit = this.dock.askBudget(this.tui.terminal.rows);
    const measurement = `${width}:${this.tui.terminal.rows}:${limit}:${this.expanded}`;
    if (this.measured !== measurement) { this.inlineHeight = this.measure(width, limit); this.measured = measurement; }
    this.height = this.reading ? Math.max(4, Math.floor(this.tui.terminal.rows * 0.8)) : this.inlineHeight;
    this.tabRegions = []; this.listRegion = { y: 0, x: 0, width: 0, indices: [] }; this.previewRegion = undefined; this.scrollPosition = { offset: 0, total: 0, height: 0 };
    const time = idleTime(this.deadline);
    if (this.reading) {
      const answer = this.reading === 'history' ? [truncateToWidth(this.form.question.question, width), this.answerLine(width)] : [];
      this.readerRegion = { y: 1, height: this.height - 2 - answer.length };
      return [truncateToWidth(`${this.reading} ${this.reader.position} · ${time} · Tab focus · / search`, width),
        ...this.reader.viewport(width, this.readerRegion.height), ...answer,
        ...(this.reader.searching ? this.reader.search.render(width) : [this.renderActions(width)])];
    }
    const geometry = frame(width, limit);
    if (!geometry.bordered) {
      this.collapsible = true;
      const answer = this.focus === 'actions' ? this.renderActions(width) : this.answerLine(width);
      this.listRegion = { y: 0, x: 0, width, indices: [this.form.reviewing ? this.reviewCursor : this.form.draft.cursor] };
      return this.height === 1 ? [truncateToWidth(answer, width)] : [truncateToWidth(answer, width), this.renderActions(width)];
    }
    const batch = this.form.questions.length > 1;
    const lines: string[] = [], markers = new Map<number, string>();
    if (batch && this.height >= 6) {
      const tabs = questionTabs(this.form, this.theme, geometry.width);
      this.tabRegions = tabs.regions.map(tab => ({ ...tab, start: tab.start + geometry.inset, end: tab.end + geometry.inset }));
      this.tabY = 1; lines.push(tabs.line);
    }
    const headerCap = Math.max(0, Math.min(this.expanded ? this.height : 4,
      this.height - 3 - lines.length - (geometry.separators ? 2 : 0) - (this.expanded ? 3 : 1)));
    this.collapsible = this.canExpand(geometry.width, headerCap);
    if (!this.form.reviewing) lines.push(...questionLines(this.form.question, this.theme, geometry.width, headerCap, this.expanded));
    if (geometry.separators) lines.push('\0separator');
    const bodyHeight = Math.max(1, this.height - 3 - lines.length - Number(geometry.separators));
    const bodyY = lines.length + 1;
    let body: string[];
    if (this.form.reviewing) {
      const list = listWindow(reviewLines(this.form, this.theme, geometry.width, this.expanded), this.reviewCursor, bodyHeight, this.position());
      body = list.lines.map((line, index) => list.indices[index] === this.reviewCursor ? this.theme.fg('accent', line) : line);
      this.listRegion = { y: bodyY, x: geometry.inset, width: geometry.width, indices: list.indices };
      this.scrollPosition = { offset: this.position().offset, total: list.total, height: bodyHeight };
    } else if (this.focus === 'search' || this.focus === 'comment') body = [this.answerLine(geometry.width)];
    else if (this.form.draft.editing) body = this.editorLines(geometry.width, bodyHeight);
    else body = this.optionLines(geometry.width, bodyHeight, bodyY, geometry.inset);
    lines.push(...body, ...Array(Math.max(0, bodyHeight - body.length)).fill(''));
    const count = this.form.reviewing ? this.form.questions.length : this.options().length + 1;
    const cursor = this.form.reviewing ? this.reviewCursor : this.form.draft.cursor;
    const scroll = this.scrollPosition, scrolling = scroll.total > scroll.height;
    if (geometry.inset && scrolling) {
      const thumb = Math.round((bodyHeight - 1) * scroll.offset / (scroll.total - scroll.height));
      markers.set(bodyY - 1 + thumb, '┃');
      if (scroll.offset > 0 && thumb > 0) markers.set(bodyY - 1, '↑');
      if (scroll.offset + scroll.height < scroll.total && thumb < bodyHeight - 1) markers.set(bodyY + bodyHeight - 2, '↓');
    }
    if (geometry.separators) lines.push('\0separator');
    const status = this.notice ? this.theme.fg('warning', this.notice) + ` · ${this.escapeHint}` : this.renderActions(geometry.width);
    lines.push(truncateToWidth((!geometry.inset && scrolling ? `${cursor + 1}/${count} · ` : '') + status, geometry.width));
    const kind = !this.form.question.options.length ? '✎' : this.form.question.allowMultiple
      ? `☐${this.form.draft.selected.size + Number(this.form.draft.customSelected && Boolean(this.form.draft.text.trim()))}` : '○';
    const page = this.form.reviewing ? 'Review' : `${this.form.index + 1}/${this.form.questions.length} ${kind}`;
    return frameLines(this.theme, geometry, width, topBorder(this.theme, width, this.requester, this.heading, page, time), lines, markers)
      .map(line => truncateToWidth(line, width));
  }
}
