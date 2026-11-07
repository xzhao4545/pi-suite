import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { AskForm } from "./form.ts";
import type { Option } from "./schema.ts";

export type AskAction = "confirm" | "previous" | "next" | "search" | "details" | "text";

/** Dispatch page/list keys only. Text editors and readers retain their native bindings. */
export function askKey(data: string, form: AskForm, options: Option[], height: number): AskAction | undefined {
  if (matchesKey(data, Key.left)) return "previous";
  if (matchesKey(data, Key.right)) return "next";
  if (form.reviewing) return matchesKey(data, Key.enter) ? "confirm" : undefined;
  const draft = form.draft;
  const count = options.length + Number(form.question.allowFreeform);
  if (matchesKey(data, Key.up)) draft.cursor = Math.max(0, draft.cursor - 1);
  else if (matchesKey(data, Key.down)) draft.cursor = Math.min(count - 1, draft.cursor + 1);
  else if (matchesKey(data, Key.pageUp)) draft.cursor = Math.max(0, draft.cursor - Math.max(1, height - 2));
  else if (matchesKey(data, Key.pageDown)) draft.cursor = Math.min(count - 1, draft.cursor + Math.max(1, height - 2));
  else if (data === "/") return "search";
  else if (data === "d") return "details";
  else if (data === "f" && form.question.allowFreeform) return "text";
  else if (matchesKey(data, Key.enter) || data === " ") {
    const option = options[draft.cursor];
    if (!option && form.question.allowFreeform) return "text";
    if (data === " ") { if (option) form.choose(option.id); }
    else {
      // Enter confirms multi-select without toggling its focused item off.
      if (option && !form.question.allowMultiple) form.choose(option.id);
      return "confirm";
    }
  }
}
