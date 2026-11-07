// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/tool-description.ts (MIT).
/**
 * tool-description.ts — the model-facing description of the `agent_workflow` tool.
 *
 * The wording follows Claude Code's `Workflow` tool description; deviate only where
 * its sentence would be false about pi. The port rules, omissions and deviations are
 * recorded beside the full guide in skills/pi-suite-workflow/SKILL.md.
 *
 * Why short: the tool sits in every provider request while agents.workflows is on,
 * but it may only be called after an explicit user opt-in. The description therefore
 * keeps what the model needs to decide whether and how to call it (precondition,
 * parameters, background result); the script format, hooks, limits and patterns live
 * in the skill, which the model reads only when it actually writes a script. Keep each
 * passage in exactly one of the two places.
 *
 * `{{typeList}}` is replaced with the enabled agent type names when the tool binds to
 * the current session. Names only: the built-in type descriptions alone exceed this
 * whole description, and agent_start likewise lists names without descriptions.
 */
export const workflowToolDescription = `Execute a workflow script that orchestrates multiple subagents deterministically.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration: asked for a workflow or orchestration in their own words, invoked a skill/command that tells you to call agent_workflow, or requested a saved workflow. Otherwise use agent_start, or describe the workflow and rough cost and ask.

Before writing or editing a script, read the pi-suite-workflow skill.

Pass exactly one of script (inline plain JavaScript beginning with \`export const meta = {...}\`), scriptPath (persisted/edited script) or name (saved workflow). args: JSON value passed verbatim to the script; use arrays/objects, not JSON-encoded strings. resumeFromRunId: a finished wf_ run in this session; reuse its unchanged successful agent() prefix.

Runs in the background; returns immediately with a wf_ ID and resultPath (scriptPath in details). You are notified when it completes.

Enabled agentType values: {{typeList}}`;
