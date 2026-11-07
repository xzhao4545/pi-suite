import type { AskResult, Question, Response } from "./schema.ts";

export interface Draft {
  // Editing is focus state; freeform is the answer mode. Esc may leave the editor
  // without discarding a text answer or its retained selection draft.
  text: string; selected: Set<string>; freeform: boolean; editing: boolean; cursor: number; query: string; comment: string;
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
      freeform: !question.options.length || question.defaultAnswer !== undefined,
      // Page navigation owns focus until the user explicitly enters the editor.
      editing: false, cursor: question.defaultAnswer !== undefined ? question.options.length : 0, query: "",
    }));
  }
  get question(): Question { return this.questions[this.index]; }
  get draft(): Draft { return this.drafts[this.index]; }

  choose(id: string): void {
    const draft = this.draft;
    draft.freeform = false; draft.editing = false;
    if (this.question.allowMultiple) {
      if (draft.selected.has(id)) draft.selected.delete(id); else draft.selected.add(id);
    } else { draft.selected.clear(); draft.selected.add(id); }
  }
  response(index = this.index, automatic = false): Response | undefined {
    const question = this.questions[index], draft = this.drafts[index];
    const comment = draft.comment ? { comment: draft.comment } : {};
    if (draft.freeform && draft.text.trim()) return { kind: "freeform", text: draft.text, ...comment };
    if (draft.freeform && !automatic) return undefined;
    let selected = question.options.filter(option => draft.selected.has(option.id));
    if (!selected.length && automatic) {
      const recommended = question.options.filter(option => option.recommended);
      selected = recommended.length ? question.allowMultiple ? recommended : recommended.slice(0, 1) : question.options.slice(0, 1);
    }
    if (!selected.length) return undefined;
    return { kind: "selection", selections: selected.map(o => o.title), optionIds: selected.map(o => o.id),
      ...comment };
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
