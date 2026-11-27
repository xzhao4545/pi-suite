# Configuration

[Documentation index](index.md)

Pi Suite works without a configuration file. Everything below is optional.

## Files and precedence

Settings are read from three layers. Each later layer overrides the earlier one field by field, so a project file only needs the fields it changes.

1. Built-in defaults.
2. User file: `<agentDir>/pi-suite.json` (`~/.pi/agent/pi-suite.json` by default; Pi's `PI_CODING_AGENT_DIR` changes `<agentDir>`).
3. Project file: `.pi/pi-suite.json` in the session's working directory. Parent directories and the Git root are not searched.

A missing file means no overrides. Invalid JSON, unknown fields, out-of-range values and read errors are reported, and the suite does not overwrite such a file.

Most settings apply after `/reload`. Agent type settings (`agents.types`) edited from `/subagents types` apply immediately to new runs.

## Editing with `/suite`

`/suite` opens a settings list that shows every field with its effective value, default, user value, project value and source.

- Type to search, use ↑/↓ to select, Enter to edit and Esc to go back.
- For each field you can edit the user layer or the project layer, or remove the value from a layer so the field inherits again.
- Booleans and enums use a selector. Numbers, text and keys use an input box. Package lists, CLI presets and agent type overrides are edited as JSON.
- Saving rewrites only the edited field, under the same lock and atomic write as the rest of the suite.

Without a TUI, `/suite` prints the effective configuration.

## Full example with defaults

```json
{
  "commands": { "exit": true },
  "modules": { "ask": true, "tasks": true, "jobs": true, "goal": true, "agents": true },
  "runtime": { "openAIResponsesAutoRecovery": false },
  "ui": { "maxRows": 12, "highlightBuiltinCommands": true },
  "ask": { "timeout": 600000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "tasks": { "reminders": true },
  "agents": {
    "display": "status",
    "maxConcurrent": 10,
    "maxConcurrentForeground": 0,
    "maxDepth": 3,
    "persistSessions": true,
    "mentions": true,
    "scheduling": true,
    "workflows": true,
    "types": {}
  },
  "jobs": {
    "display": "status",
    "detachKey": "ctrl+]",
    "returnKey": "ctrl+g",
    "transferKey": "ctrl+t",
    "agents": {}
  }
}
```

## Fields

### commands and modules

| Field | Default | Meaning |
| --- | --- | --- |
| `commands.exit` | `true` | Register `/exit`. It cancels a busy turn, then quits through Pi's normal shutdown so jobs and agents are cleaned up. Pi's own `/quit` is always available. |
| `modules.ask` | `true` | Enable `ask_user`. |
| `modules.tasks` | `true` | Enable the task tools and `/tasks`. |
| `modules.jobs` | `true` | Enable the job tools and `/jobs`. Jobs created by subagents can still be viewed from `/subagents` when this is off. |
| `modules.goal` | `true` | Enable `/goal` and the goal tools. |
| `modules.agents` | `true` | Enable subagents, schedules, workflows and `/subagents`. |

### runtime

| Field | Default | Meaning |
| --- | --- | --- |
| `runtime.openAIResponsesAutoRecovery` | `false` | Recover automatically from two kinds of OpenAI Responses history errors; see [below](#openai-responses-recovery). |

### ui

| Field | Default | Meaning |
| --- | --- | --- |
| `ui.maxRows` | `12` | Maximum rows of the idle Dock, 1–30. It does not limit `ask_user`. |
| `ui.highlightBuiltinCommands` | `true` | Syntax-highlight the command in Pi's built-in `bash` and `powershell` tool calls. `false` keeps Pi's original call display. Job commands are always highlighted. |

### ask, goal and tasks

| Field | Default | Meaning |
| --- | --- | --- |
| `ask.timeout` | `600000` | Default idle timeout of `ask_user` in milliseconds, 0–2147483647. `0` waits forever. |
| `ask.historyKey` | `ctrl+h` | Key that opens the conversation history while a question is shown. |
| `goal.display` | `status` | Where the goal summary appears: `status` (footer status), `dock` or `hidden`. |
| `tasks.reminders` | `true` | Add a short task reminder to the model's next request after several turns without task tool use. |

### agents

| Field | Default | Meaning |
| --- | --- | --- |
| `agents.display` | `status` | Where the active subagent count appears: `status`, `dock` or `hidden`. |
| `agents.maxConcurrent` | `10` | Maximum concurrent background subagents. Extra runs wait in a queue. |
| `agents.maxConcurrentForeground` | `0` | Maximum concurrent foreground subagents. `0` means unlimited. |
| `agents.maxDepth` | `3` | Maximum session depth including the main session, so `3` allows two nested levels. |
| `agents.persistSessions` | `true` | Save top-level subagent sessions to disk by default. |
| `agents.defaultModel` | unset | Default model for subagents, as `provider/modelId`. |
| `agents.types` | `{}` | Per-type `enabled`, `model` and `thinking` overrides. See [Agent types](modules/agents/types-and-models.md#configuration-overrides). |
| `agents.packageAgents` | all | Load agent types declared by installed Pi packages. `false` or `[]` disables; an array of package names or sources selects packages. |
| `agents.mentions` | `true` | Enable `@handle` mentions and completion in the editor. |
| `agents.scheduling` | `true` | Enable the `schedule` parameter of `agent_start` and the Schedules page. |
| `agents.workflows` | `true` | Enable `agent_workflow` and the Workflows page. |
| `agents.packageWorkflows` | all | Load workflows declared by installed Pi packages, with the same values as `packageAgents`. |

### jobs

| Field | Default | Meaning |
| --- | --- | --- |
| `jobs.display` | `status` | Where the active job count appears: `status`, `dock` or `hidden`. |
| `jobs.detachKey` | `ctrl+]` | Leave the terminal view; the job keeps running. The default avoids tmux's `Ctrl+B` prefix. |
| `jobs.returnKey` | `ctrl+g` | Hand input back to the model while staying in the terminal view. |
| `jobs.transferKey` | `ctrl+t` | Leave the view and send the current screen to the model. |
| `jobs.agents` | built-in presets | CLI presets used by `job_start` `agent` requests. See [CLI presets](modules/jobs/cli-and-hands-free.md#cli-presets). |

Key fields use Pi key identifiers such as `ctrl+h`, `alt+x` or `shift+tab`.

## OpenAI Responses recovery

An OpenAI Responses endpoint can reject a request when its history was created under a different resource or account. This happens, for example, when a gateway switches between upstream accounts. With `runtime.openAIResponsesAutoRecovery` set to `true`, the suite handles two cases:

- **Item IDs from another resource.** The final request failed with an explicit resource, ownership or missing-dependency error. An HTTP 400 alone is not enough. The suite removes the upstream `id` from the history items that the failed request carried and asks the model to continue. Content, encrypted reasoning, call IDs and tool outputs stay intact.
- **Encrypted reasoning that can't be decrypted.** The final request failed because encrypted reasoning content could not be verified or decrypted. If the error quotes a shortened piece of the ciphertext, it must match reasoning in the failed request. The suite drops those reasoning items from the replayed history, removes the upstream `id` from the other items, and asks the model to continue. Messages, call IDs and tool outputs stay intact. New reasoning produced afterwards is replayed as usual.
- It only acts on an `openai-responses` model.
- It only acts when the failed request's history can be replayed on its own. Requests that depend on server-side state, such as `previous_response_id`, `item_reference` items or server-side compaction, are left alone.
- It does not retry when the failed response already produced content or tool calls, so side effects are not repeated. Rate limits, auth errors, quota errors, context overflow and ordinary schema errors are left alone.
- It records the isolated IDs and hashes of the dropped ciphertext in a `pi-suite:responses-isolation` session entry, together with a hash of the provider, API, model and base URL. Prompt text, the ciphertext itself and credentials are not stored. The original history stays on disk.

Retries after the repair use Pi's own retry budget. Each kind of repair runs at most once until a request succeeds, so an ID repair followed by a decryption error can still recover.

## Shutdown with `/exit`

`/exit` aborts the current turn if Pi is busy, waits for it to become idle, then asks Pi to shut down. Pi's quit flow restores the terminal and the suite stops jobs, PTYs, subagents and workflows before exiting. Jobs share a 10-second stop deadline; cleanup that cannot be confirmed by then is recorded as `unconfirmed` and Pi still exits. Set `commands.exit` to `false` and `/reload` to remove the command.
