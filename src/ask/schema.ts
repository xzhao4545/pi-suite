import { Type, type Static } from "typebox";

const option = Type.Union([Type.String({ minLength: 1 }), Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })), title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()), recommended: Type.Optional(Type.Boolean()),
})]);
const fields = {
  context: Type.Optional(Type.String()), options: Type.Optional(Type.Array(option)),
  allowMultiple: Type.Optional(Type.Boolean()), allowFreeform: Type.Optional(Type.Boolean()),
  defaultAnswer: Type.Optional(Type.String()), defaultOptionId: Type.Optional(Type.String()),
  defaultOptionIds: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
};
export const askSchema = Type.Object({
  question: Type.Optional(Type.String({ minLength: 1 })), ...fields,
  questions: Type.Optional(Type.Array(Type.Object({ question: Type.String({ minLength: 1 }), ...fields }), { minItems: 2, maxItems: 4 })),
  allowComment: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647,
    description: "Milliseconds from display. Omit for configured default; 0 disables expiry. Expiry never submits defaults." })),
}, { additionalProperties: false });
export type AskParams = Static<typeof askSchema>;
export type QuestionInput = NonNullable<AskParams["questions"]>[number];

export interface Option { id: string; title: string; description?: string; recommended?: boolean }
export interface Question extends Omit<QuestionInput, "options" | "allowMultiple" | "allowFreeform"> {
  options: Option[]; allowMultiple: boolean; allowFreeform: boolean;
}
export type Response =
  | { kind: "selection"; selections: string[]; optionIds: string[]; comment?: string }
  | { kind: "freeform"; text: string };
export interface AskResult { status: "answered" | "timed_out" | "cancelled"; responses: Response[] }

export function normalize(params: AskParams): Question[] {
  if (!params.questions && !params.question?.trim()) throw new Error("question or questions is required");
  if (params.questions && [params.options, params.allowMultiple, params.allowFreeform,
    params.context, params.defaultAnswer, params.defaultOptionId, params.defaultOptionIds].some(value => value !== undefined)) {
    throw new Error("Batch question settings must be inside each questions entry");
  }
  return (params.questions ?? [{ ...params, question: params.question! }]).map(input => {
    const options = (input.options ?? []).map((value, index) => typeof value === "string"
      ? { id: `option-${index + 1}`, title: value } : { ...value, id: value.id ?? `option-${index + 1}` });
    const ids = new Set(options.map(o => o.id));
    if (ids.size !== options.length) throw new Error("Option IDs must be unique");
    const allowMultiple = input.allowMultiple ?? false;
    const allowFreeform = input.allowFreeform ?? true;
    if (!options.length && !allowFreeform) throw new Error("A question must allow an answer");
    const hasText = input.defaultAnswer !== undefined;
    const hasSingle = input.defaultOptionId !== undefined;
    const hasMulti = input.defaultOptionIds !== undefined;
    if (Number(hasText) + Number(hasSingle) + Number(hasMulti) > 1) throw new Error("Default answer parameters conflict");
    if (hasText && options.length && !allowFreeform) throw new Error("defaultAnswer requires allowFreeform");
    if ((hasSingle && allowMultiple) || (hasMulti && !allowMultiple)) throw new Error("Default selection must match allowMultiple");
    const defaults = input.defaultOptionIds ?? (hasSingle ? [input.defaultOptionId!] : []);
    if (defaults.some(id => !ids.has(id))) throw new Error("Default references an unknown option ID");
    return { ...input, options, allowMultiple, allowFreeform };
  });
}
