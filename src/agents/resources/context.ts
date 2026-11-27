// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/context.ts (MIT).

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function extractText(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(c => c.type === "text")
    .map(c => c.text ?? "")
    .join("\n");
}

/** Snapshot the parent's current branch for inherit_context, without tool results or thinking. */
export function buildParentContext(ctx: Pick<ExtensionContext, 'sessionManager'>): string {
  const entries = ctx.sessionManager.getBranch();
  if (entries.length === 0) return "";

  const parts: string[] = [];

  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const text = typeof msg.content === "string"
          ? msg.content
          : extractText(msg.content);
        if (text.trim()) parts.push(`[User]: ${text.trim()}`);
      } else if (msg.role === "assistant") {
        const text = extractText(msg.content);
        if (text.trim()) parts.push(`[Assistant]: ${text.trim()}`);
      }
    } else if (entry.type === "compaction") {
      if (entry.summary) {
        parts.push(`[Summary]: ${entry.summary}`);
      }
    }
  }

  if (parts.length === 0) return "";

  return `# Parent Conversation Context
Use this parent conversation as context for the task below.

${parts.join("\n\n")}

---
# Your Task (below)
`;
}
