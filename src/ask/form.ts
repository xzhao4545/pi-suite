import type { Question, Response } from "./schema.ts";

export interface Draft {
  text: string; selected: Set<string>; freeform: boolean; cursor: number; query: string; comment: string;
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
      freeform: !question.options.length || question.defaultAnswer !== undefined, cursor: 0, query: "",
    }));
  }
  get question(): Question { return this.questions[this.index]; }
  get draft(): Draft { return this.drafts[this.index]; }

  choose(id: string): void {
    const draft = this.draft;
    draft.freeform = false;
    if (this.question.allowMultiple) {
      if (draft.selected.has(id)) draft.selected.delete(id); else draft.selected.add(id);
    } else { draft.selected.clear(); draft.selected.add(id); }
  }
  response(index = this.index): Response | undefined {
    const question = this.questions[index], draft = this.drafts[index];
    if (draft.freeform) return draft.text.trim() ? { kind: "freeform", text: draft.text } : undefined;
    if (!draft.selected.size) return undefined;
    const selected = question.options.filter(option => draft.selected.has(option.id));
    return { kind: "selection", selections: selected.map(o => o.title), optionIds: selected.map(o => o.id),
      ...(draft.comment ? { comment: draft.comment } : {}) };
  }
  get complete(): boolean { return this.questions.every((_, index) => this.response(index)); }
  responses(): Response[] { return this.questions.map((_, index) => this.response(index)!); }
}
