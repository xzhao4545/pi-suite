// Imported from @tintinweb/pi-subagents 0.23.0 src/prompts.ts (MIT).
// Child skills/cwd/extension sections are rendered by Pi; inherit the stable parent prefix.
export function inheritableParentPrompt(rendered: string, cwd: string): string {
  const cwdAt = rendered.lastIndexOf(`\n\n<cwd>\n${cwd.replace(/\\/g, "/")}\n</cwd>`);
  if (cwdAt < 0) return rendered;
  const head = rendered.slice(0, cwdAt);
  if (!head.endsWith("\n</skills>")) return head;
  const skillsAt = head.lastIndexOf("\n\n<skills>\n");
  return skillsAt < 0 ? head : head.slice(0, skillsAt);
}

