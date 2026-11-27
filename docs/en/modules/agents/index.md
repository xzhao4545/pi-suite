# Agents

[Documentation index](../../index.md) · [Types and models](types-and-models.md) · [Schedules](schedules.md) · [Workflows](workflows.md) · [RPC](rpc.md)

The agents module runs subagents: child Pi sessions inside the same process, each with its own prompt, model, tools and transcript. Switch: `modules.agents`. Display: `agents.display`.

Built-in types:

| Type | Purpose |
| --- | --- |
| `general-purpose` | Full tool access for any task. |
| `Explore` | Investigation with `read`, `bash`, `grep`, `find` and `ls`. Its prompt tells it not to change anything, and it has no edit tools, but this is not a sandbox: `bash` can still modify files. |
| `Plan` | Planning, with the same tools and the same limits as `Explore`. |

You can add your own types; see [Types and models](types-and-models.md).

## Runs and lifetime

Each subagent has a stable `agent_` ID. Each execution, including every resume, gets its own `run_` ID. Starting a subagent, sending it a message after it finished, or answering it all go through the same agent ID.

- **Background** (default): `agent_start` returns the ID immediately. The result arrives as a notification, or through `wait`.
- **Foreground** (`background: false`): `agent_start` waits for the result. It returns early when any direct child asks a question. Pressing Esc in the parent cancels a foreground call and its child; background children keep running.
- **Concurrency**: up to `agents.maxConcurrent` (10) background runs; foreground runs are unlimited by default. Extra runs wait in a FIFO queue. Nested children and workflow children do not use these slots.
- **Nesting**: a type can start its own subagents only if `allowed_subagents` permits it, up to `agents.maxDepth` (3 session levels).
- **States**: `queued`, `starting`, `running`, `waiting`, `stopping`, `completed`, `failed`, `stopped`, and `limited` when `maxTurns` was reached.
- **Stopping** a run also stops its nested children and every job they created, and reports the real cleanup result.

Top-level sessions are saved to disk by default (`agents.persistSessions`). The in-memory transcript of a run that ended more than 10 minutes ago may be released after you close its viewer. The record, result and saved session stay available.

`/reload` replaces idle subagent and workflow runtimes. If Pi reports a runtime from an earlier load, you can still steer or stop existing runs and answer their questions. Once the runs finish and their results have been delivered, run `/reload` again to start or resume agents and launch workflows. If the warning asks you to restart Pi, restart it once. Replacing a runtime can release unsaved subagent transcripts.

## Tools

| Tool | Parameters |
| --- | --- |
| `agent_start` | `prompt`, `type?`, `name?`, `background?`, `model?`, `thinking?`, `maxTurns?`, `taskId?` with `taskGeneration?`, `inheritContext?`, `isolated?`, `schedule?`. |
| `agent_list` | `state?` (`active` default, `queued`, `finished`, `all`), `scope?` (`session` default, `workspace`), `agentId?`, `cursor?`, `limit?` (default 10, max 100). |
| `agent_get` | `id`, `runId?`, `detail?`. Shows state, activity, model, thinking, task and any pending question. `detail: true` adds sources, context use, token usage and active jobs. |
| `agent_read` | `id`, `runId?`, `stream?` (`transcript` while active, `result` once settled), and the [shared reading parameters](../../concepts.md#reading-output). |
| `agent_send` | `id`, `message`. Returns `answered`, `steered`, `queued` or `resumed`. Only the direct parent can send. |
| `agent_stop` | `id`, `runId?`. Stops the run subtree and its jobs. |
| `agent_workflow` | See [Workflows](workflows.md). |

- `inheritContext: true` gives the child the parent's user and assistant text and compaction summaries, without tool results.
- `isolated: true` turns off external extensions, skills and nesting for the child.
- `schedule` registers a future run instead of starting now; see [Schedules](schedules.md).
- A type's frontmatter values for `max_turns`, `inherit_context`, `run_in_background` and `isolated` take precedence over these parameters.

## Parent questions

When a subagent calls `ask_user`, the question goes to its direct parent, and the run shows `waiting(parent)`. For a top-level subagent the parent is the main session, which receives the question as a notification. The parent answers with `agent_send`:

- A message that exactly matches an option ID or title selects it; anything else is a free-text answer.
- For multiple choice, send a JSON array of strings. For a batch, send a JSON array with one element per question.

The answer carries `source: parent`, so the child cannot present it as the user's own approval. The question uses `ask.timeout` unless it set its own; a timeout or cancellation stops the child.

## Mentions

In the TUI editor, `@name message` talks to a subagent directly:

- `@explore …` or `@agent-explore …` addresses the Explore instance. Instance handles come from the type name; repeated names get `-2`, `-3`. The `name` passed to `agent_start` also works as an alias.
- If the agent is running, the message steers it. If it is queued, the message waits. If it is waiting for an answer, the message answers it. If it has finished, the message resumes it.
- If a type has no instance yet, a temporary copy of the main session turns your message into an `agent_start` task.
- `@main message` sends the message to the main session.
- Completion after `@` lists active instances, finished instances and enabled types, alongside Pi's file completion.

Set `agents.mentions` to `false` to turn this off.

## Subagents browser

`/subagents [queued|finished|all|types|schedules|workflows]` opens `Subagents ▸ <page>`. `/subagents workspace [queued|finished|all]` opens Runs in workspace scope. Pages: Runs, Types, and when enabled, Schedules and Workflows.

| Key | Action |
| --- | --- |
| `1`–`4`, `[` / `]`, ← / → | Switch page. On Runs, ← twice within 300 ms closes the browser. |
| `w` | Runs: toggle scope (This session / Workspace). |
| `s` | Runs: cycle state (All / Queued / Finished). |
| `/`, Tab, Esc | Filter, details, back. |
| Enter | Open the run's transcript (task details for a queued run). |
| `m` | Message the run, or answer its question. |
| `j` | Jobs created by this run. |
| `c` | Change model and thinking for this run's next request. |
| `b` | Move a running foreground run to the background. |
| `x` twice | Stop the run subtree, or cancel a queued run. On a finished run with leftover jobs, clean up those jobs. |

Records from other sessions or branches in Workspace scope are marked **Read only**. You can read them, but cannot message, stop or reconfigure them.

The transcript uses Pi's own message and tool components. Extra keys there:

| Key | Action |
| --- | --- |
| `o` | Expand or collapse all tool calls. |
| `h` | Show or hide thinking. |
| `d` | Details: IDs, cwd, sources, permissions, usage and errors. |
| `m`, `j`, `c`, `b`, `x` | As in the list. |

The transcript follows new output while you are at the bottom. Scrolling up pauses following; End resumes it. The message editor is Pi's multi-line editor: Enter sends, Shift+Enter or Ctrl+J inserts a newline, and Esc cancels editing without stopping the run.

The Types page lists every type, including disabled ones (● enabled, ○ disabled), with model and thinking. Enter or `c` sets the type's default model and thinking. `d` enables or disables the type, and `u` (Use definition) removes the enabled override. See [Types and models](types-and-models.md).

## Errors

Besides the [common codes](../../tools.md#error-codes): `MODEL_UNAVAILABLE` when a configured model has no credentials, `MODEL_RUNTIME_UNAVAILABLE` when the parent model runtime cannot be shared, `TASK_STALE` and `TASK_SCOPE` for task links.
