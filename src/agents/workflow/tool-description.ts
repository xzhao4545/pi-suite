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
export const workflowToolDescription = `Run a JavaScript workflow to coordinate subagents.

Call only if the user requests a workflow or orchestration, invokes a skill or command that requires this tool, or requests a saved workflow. Otherwise use agent_start, or explain the plan and rough cost and ask for approval.

Read the pi-suite-workflow skill before you write or edit a workflow script.

- Choose one source: script (inline JavaScript with \`export const meta = {...}\`), scriptPath (relative to the working directory or absolute), or name (saved workflow).
- args: optional JSON value. Pass arrays and objects directly.
- resumeFromRunId: optional finished wf_ run on the current session branch. Reuse its unchanged, successful agent() prefix.

Starts in the background. Returns a wf_ ID and resultPath; details include the saved scriptPath. On completion, use read on resultPath for the full result.

Enabled agentType names: {{typeList}}`;
