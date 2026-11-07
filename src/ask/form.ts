import type { AskResult, Question, Response } from "./schema.ts";

export interface Draft {
  // Text survives deselection; editing is focus, independent of the option's selection.
  text: string; selected: Set<string>; customSelected: boolean; editing: boolean; cursor: number; query: string; comment: string;
}
export class AskForm {
  readonly drafts: Draft[];
  index = 0;
  reviewing = false;

  constructor(readonly questions: Question[]) {
    // Initialize exactly once. Filtering and view changes operate on these drafts.
    this.drafts = questions.map(question => ({
      text: question.defaultAnswer ?? "", comment: "",
      selected: new Set(question.defaultOptionIds ?? (question.defaultOptionId ? [question.defaultOptionId] : [])),
      customSelected: !question.options.length || question.defaultAnswer !== undefined,
      // Page navigation owns focus until the user explicitly enters the editor.
      editing: false, cursor: question.defaultAnswer !== undefined ? question.options.length : 0, query: "",
    }));
  }
  get question(): Question { return this.questions[this.index]; }
  get draft(): Draft { return this.drafts[this.index]; }

  choose(id?: string): void {
    const draft = this.draft;
    draft.editing = false;
    if (!this.question.allowMultiple) { draft.selected.clear(); draft.customSelected = false; }
    // The custom option has no model-provided ID, so it cannot collide with a preset ID.
    if (id === undefined) draft.customSelected = !draft.customSelected;
    else if (draft.selected.has(id)) draft.selected.delete(id); else draft.selected.add(id);
  }
  editText(): void {
    if (!this.question.allowMultiple) this.draft.selected.clear();
    this.draft.customSelected = true; this.draft.editing = true;
  }
  response(index = this.index, automatic = false): Response | undefined {
    const question = this.questions[index], draft = this.drafts[index];
    const comment = draft.comment ? { comment: draft.comment } : {};
    const text = draft.customSelected && draft.text.trim() ? draft.text : undefined;
    let selected = question.options.filter(option => draft.selected.has(option.id));
    if (!selected.length && !text && automatic) {
      const recommended = question.options.filter(option => option.recommended);
      selected = recommended.length ? question.allowMultiple ? recommended : recommended.slice(0, 1) : question.options.slice(0, 1);
    }
    if (!selected.length) return text ? { kind: "freeform", text, ...comment } : undefined;
    return { kind: "selection", selections: selected.map(o => o.title), optionIds: selected.map(o => o.id),
      ...text !== undefined ? { text } : {}, ...comment };
  }
  answered(index: number): boolean { return this.response(index) !== undefined; }
  get complete(): boolean { return this.questions.every((_, index) => this.answered(index)); }
  responses(): Response[] { return this.questions.map((_, index) => this.response(index)!); }
  skip(): AskResult {
    // Skipping closes the form, not the answers already drafted; keep empty slots
    // so subsequent responses remain attached to their original questions.
    return { status: "skipped", responses: this.questions.map((_, index) => this.response(index)) };
  }
  expire(): AskResult {
    // Keep question positions even when a text question has no draft: dropping a slot
    // would incorrectly attribute the next answer to the unanswered question.
    const responses = this.questions.map((_, index) => {
      const response = this.response(index, true);
      return response ? { ...response, autoSelected: true as const } : undefined;
    });
    return { status: "timed_out", responses: responses.length === 1 && !responses[0] ? [] : responses };
  }
}
