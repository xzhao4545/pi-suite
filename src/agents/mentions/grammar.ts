// Imported from @tintinweb/pi-subagents 0.23.0 src/mention.ts (MIT).
/**
 * Suggestion trigger: `@` at a token boundary plus the partial handle typed so
 * far. Ported from Claude Code, including the CJK sentence-ending punctuation
 * it accepts as a boundary.
 */
export const MENTION_TRIGGER = /(^|[\s。、？！])@([\w-]*)$/;

/** Send grammar: leading `@handle`, then a non-empty message. */
const MENTION_SEND = /^@([\w-]+)\s+([\s\S]+)$/;

/**
 * Upper bound on a handle, matching Claude Code's `dSS`. Nothing here generates
 * a name this long, but an agent type or a model-supplied name can be arbitrary
 * text, and an unbounded handle would wrap the suggestion popup.
 */
const MAX_HANDLE_LENGTH = 64;

/**
 * Handles that address something other than a subagent, and so can never be
 * allocated to one. Claude Code reserves exactly this name (`Vq = "main"`),
 * refusing it at spawn and routing it to the main conversation instead.
 */
const RESERVED_HANDLES: ReadonlySet<string> = new Set(["main"]);

/** Whether `@handle` names the main conversation rather than any subagent. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.toLowerCase());
}

/** Slug of an agent type or name, restricted to the `[\w-]` the grammar allows. */
export function handleBase(type: string): string {
  const slug = type.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_HANDLE_LENGTH)
    // The slice can land mid-run and leave the trailing hyphen back.
    .replace(/-+$/, "");
  return slug || "agent";
}

/**
 * `base`, else `base-2`, `base-3`, … — the first form that is neither `taken`
 * nor reserved. Callers pass one shared `taken` set covering type-derived
 * handles and model-supplied aliases alike, so the two can never collide.
 */
export function assignHandle(base: string, taken: ReadonlySet<string>): string {
  let candidate = base;
  let n = 1;
  while (taken.has(candidate) || RESERVED_HANDLES.has(candidate)) {
    n++;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/**
 * Claude Code documents `@agent-<name>` as the form you type by hand when the
 * picker isn't involved. Accepted here as an exact synonym: the caller tries the
 * handle as written first, so an agent genuinely called `agent-foo` still wins
 * over `@agent-` + `foo`, and only falls back to this when that finds nothing.
 * Returns undefined when the prefix is absent or is the whole handle.
 */
export function stripAgentPrefix(handle: string): string | undefined {
  const rest = /^agent-(.+)$/i.exec(handle)?.[1];
  return rest || undefined;
}

/**
 * Split `@handle message` into its parts, or null when the text isn't a send —
 * a bare handle, a leading file path, or a mention that isn't at the start.
 */
export function parseMention(text: string): { handle: string; message: string } | null {
  const match = MENTION_SEND.exec(text);
  if (!match) return null;
  const message = match[2].trim();
  return message ? { handle: match[1], message } : null;
}

export function agentMentionReminder(type: string): string {
  return `<system-reminder>\nThe user has expressed a desire to invoke the agent "${type}". Please invoke the agent appropriately, passing in the required context to it. \n</system-reminder>`;
}
