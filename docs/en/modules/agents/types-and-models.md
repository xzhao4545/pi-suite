# Agent types, models and resources

[Agents](index.md) · [Documentation index](../../index.md)

## Where types come from

Types load in this order; a later definition with the same name replaces an earlier one:

1. Built-in types: `general-purpose`, `Explore`, `Plan`.
2. Types declared by installed Pi packages (`agents.packageAgents`).
3. User types in `<agentDir>/agents/`.
4. Project types in `<project>/.agents/agents/`.
5. Project types in `<project>/.pi/agents/`.

Project directories and project packages are used only when Pi trusts the project. Names match exactly first; a case-insensitive match must be unique.

## Type files

A type is a Markdown file. The frontmatter configures the type and the body is its system prompt. Unknown fields are errors.

```markdown
---
name: reviewer
display_name: Code reviewer
description: Reviews a diff for bugs and missing tests
tools: read, grep, find, ls, bash
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 30
---
You review code changes. Report concrete problems with file and line.
```

| Field | Meaning |
| --- | --- |
| `name`, `display_name`, `description`, `color` | Identity and display. |
| `tools` | Allowed tools: Pi tool names, wildcards, `*`/`all`, `ext:foo` (all tools of extension foo), `ext:foo/bar`, `mcp__server` (all tools of an MCP server). By default: built-in tools plus the suite's task, job and wait tools. |
| `disallowed_tools` (or `disallowedTools`) | Tools removed after everything else; wildcards allowed. |
| `extensions` / `exclude_extensions` | Which Pi extensions the child loads. Default `true` (Pi's configured extensions); `false` loads none. |
| `skills` | `true` (default) uses Pi's skill discovery, `false` disables skills, a list preloads the named skills. |
| `model`, `thinking` | Default model (`provider/modelId`, or a unique fuzzy name) and thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). |
| `max_turns` | Turn limit; the run ends as `limited`. |
| `prompt_mode` | `replace` uses only this prompt; `append` adds it to the parent's stable prompt prefix. |
| `inherit_context` | Pass the parent's conversation text. |
| `run_in_background` | Force background or foreground. |
| `isolated` | No external extensions, skills or nesting. |
| `allowed_subagents` | Nested subagents: off by default; `true`/`all`/`*` or a list of type names. |
| `persist_session`, `session_dir` | Whether and where to save the child session. |
| `memory` | `user`, `project` or `local`: a persistent memory directory whose `MEMORY.md` (first 200 lines) goes into the prompt. |
| `enabled` | `false` prevents new runs of this type. |

Child sessions do not automatically load the project's `AGENTS.md`, prompt templates or `APPEND_SYSTEM.md`; the type controls the prompt.

Memory directories: `<agentDir>/agent-memory/<type>` (user), `<cwd>/.pi/agent-memory/<type>` (project), `<cwd>/.pi/agent-memory-local/<type>` (local). A type with `write` or `edit` tools gets a writable memory; otherwise it is read-only.

MCP tools use Pi's normalized names `mcp__<server>__<tool>`, for example `mcp__context7__query_docs`.

## Model and thinking resolution

The model and the thinking level are each taken from the first source that has a value:

1. The `agent_start` parameter.
2. An override for this one agent, set with `c` in `/subagents`.
3. `agents.types.<type>` in `pi-suite.json`.
4. The type's frontmatter.
5. `agents.defaultModel` (model only).
6. The parent session's current value.

An explicit `provider/modelId` that has no credentials fails with `MODEL_UNAVAILABLE` and names the source; it is never replaced with another provider's model. Pi lowers the thinking level to what the chosen model supports.

A per-agent override applies from that agent's next request, without interrupting the current one. Type defaults apply to runs started afterwards.

## Configuration overrides

`/subagents types` writes overrides to `pi-suite.json` without touching the type's Markdown file:

```json
{
  "agents": {
    "types": {
      "Explore": { "enabled": true, "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

Each field is written to the project file if the project already sets it, otherwise to the user file. Choosing **No override** removes the field. These changes apply at once, without `/reload`. Enabled state resolves as project, then user, then frontmatter, then `true`.

The model picker lists every model that Pi has credentials for, including models outside the session's scoped list.

## Package types

A Pi package can ship agent types and workflows by declaring them in `package.json`:

```json
{
  "pi": {
    "extensions": [],
    "subagents": { "agents": ["./agents"], "workflows": ["./workflows/review.js"] }
  }
}
```

A top-level `pi-subagents` key is accepted when `pi.subagents` is absent, and an array is shorthand for `agents`. Entries are directories (their direct files) or single files; `!path` excludes a file. Glob patterns are not supported. Files must stay inside the package and be at most 1 MiB. A package that only ships resources should declare `"extensions": []`.
