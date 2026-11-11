import { Type, type Static } from "typebox";

const option = Type.Union([Type.String({ minLength: 1 }), Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })), title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()), recommended: Type.Optional(Type.Boolean()),
})]);
const fields = {
  options: Type.Optional(Type.Array(option)),
  allowMultiple: Type.Optional(Type.Boolean()),
  defaultAnswer: Type.Optional(Type.String()), defaultOptionId: Type.Optional(Type.String()),
  defaultOptionIds: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
};
export const askSchema = Type.Object({
  question: Type.Optional(Type.String({ minLength: 1 })), ...fields,
  questions: Type.Optional(Type.Array(Type.Object({
    question: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 60,
      description: "Concise tab title, e.g. 'Scope' or 'Database'. Omit to derive a short title from question; the full question stays in the body." })),
    ...fields,
  }, { additionalProperties: false }), { minItems: 2, maxItems: 4 })),
  allowComment: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647,
    description: "Milliseconds of user inactivity before expiry. Omit for configured default (600000); 0 disables expiry. On expiry each question submits the user's current draft, else recommended options, else the first option." })),
}, { additionalProperties: false });
export type AskParams = Static<typeof askSchema>;
export type QuestionInput = NonNullable<AskParams["questions"]>[number];

export interface Option { id: string; title: string; description?: string; recommended?: boolean }
export interface Question extends Omit<QuestionInput, "options" | "allowMultiple"> {
  options: Option[]; allowMultiple: boolean;
}
export type Response = (
  // Custom text has no preset ID; mixed multi-select answers keep it in its own field.
  | { kind: "selection"; selections: string[]; optionIds: string[]; text?: string; comment?: string }
  | { kind: "freeform"; text: string; comment?: string }
) & { autoSelected?: true };
export type AskResult =
  | { status: "answered"; responses: Response[] }
  | { status: "timed_out"; responses: (Response | undefined)[] }
  | { status: "skipped"; responses: (Response | undefined)[] }
  | { status: "cancelled"; responses: [] };

export function normalize(params: AskParams): Question[] {
  if (!params.questions && !params.question?.trim()) throw new Error("question or questions is required");
  if (params.questions && [params.options, params.allowMultiple,
    params.defaultAnswer, params.defaultOptionId, params.defaultOptionIds].some(value => value !== undefined)) {
    throw new Error("Batch question settings must be inside each questions entry");
  }
  return (params.questions ?? [{ ...params, question: params.question! }]).map(input => {
    const options = (input.options ?? []).map((value, index) => typeof value === "string"
      ? { id: `option-${index + 1}`, title: value } : { ...value, id: value.id ?? `option-${index + 1}` });
    const ids = new Set(options.map(o => o.id));
    if (ids.size !== options.length) throw new Error("Option IDs must be unique");
    const allowMultiple = input.allowMultiple ?? false;
    const hasText = input.defaultAnswer !== undefined;
    const hasSingle = input.defaultOptionId !== undefined;
    const hasMulti = input.defaultOptionIds !== undefined;
    if (Number(hasText) + Number(hasSingle) + Number(hasMulti) > 1) throw new Error("Default answer parameters conflict");
    if ((hasSingle && allowMultiple) || (hasMulti && !allowMultiple)) throw new Error("Default selection must match allowMultiple");
    const defaults = input.defaultOptionIds ?? (hasSingle ? [input.defaultOptionId!] : []);
    if (defaults.some(id => !ids.has(id))) throw new Error("Default references an unknown option ID");
    // Project current question fields instead of spreading input: historical/foreign
    // fields must not leak into live forms or newly persisted details.
    const { question, title, defaultAnswer, defaultOptionId, defaultOptionIds } = input as QuestionInput;
    return { question, title, defaultAnswer, defaultOptionId, defaultOptionIds, options, allowMultiple };
  });
}
