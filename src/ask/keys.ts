import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { AskForm } from "./form.ts";
import type { Option } from "./schema.ts";

export type AskAction = "confirm" | "previous" | "next" | "search" | "details" | "expand" | "text";

/** Dispatch page/list keys only. Text editors and readers retain their native bindings. */
export function askKey(data: string, form: AskForm, options: Option[], height: number): AskAction | undefined {
  if (matchesKey(data, Key.left)) return "previous";
  if (matchesKey(data, Key.right)) return "next";
  if (data === "e") return "expand";
  if (data === "d") return "details";
  if (form.reviewing) return matchesKey(data, Key.enter) ? "confirm" : undefined;
  const draft = form.draft;
  const count = options.length + 1;
  if (matchesKey(data, Key.up)) draft.cursor = Math.max(0, draft.cursor - 1);
  else if (matchesKey(data, Key.down)) draft.cursor = Math.min(count - 1, draft.cursor + 1);
  else if (matchesKey(data, Key.pageUp)) draft.cursor = Math.max(0, draft.cursor - Math.max(1, height - 2));
  else if (matchesKey(data, Key.pageDown)) draft.cursor = Math.min(count - 1, draft.cursor + Math.max(1, height - 2));
  else if (data === "/") return "search";
  else if (data === "f") return "text";
  else if (matchesKey(data, Key.enter) || data === " ") {
    const option = options[draft.cursor];
    if (!option && (data !== " " || !draft.text.trim())) return "text";
    if (data === " ") form.choose(option?.id);
    else {
      // Enter confirms multi-select without toggling its focused item off.
      if (option && !form.question.allowMultiple) form.choose(option.id);
      return "confirm";
    }
  }
}
