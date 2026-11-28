# Pi Suite

[中文](README.zh-CN.md) · [Documentation](docs/en/index.md)

An all-in-one extension bundle for [Pi](https://github.com/earendil-works/pi), the terminal coding agent, that integrates six standalone extensions into five modules: goals, subagents, user questions, background jobs and task lists. The modules share one storage layer, one notification queue and one panel above the editor (the Dock).

## Install

```sh
pi install npm:pi-suite
pi list
```

Run `/reload` in an open session or restart Pi. All modules are enabled by default. Updates are covered in [Installation](docs/en/installation.md).

The package ships two skills: `pi-suite-jobs` teaches the model to run commands and coding-agent CLIs as jobs, and `pi-suite-workflow` teaches it to write and resume workflow scripts.

## Modules

| Module | Upstream |
| --- | --- |
| [Goal](docs/en/modules/goal.md) | `@narumitw/pi-goal` |
| [Agents](docs/en/modules/agents/index.md) | `@tintinweb/pi-subagents` |
| [Ask](docs/en/modules/ask.md) | `pi-ask-user` |
| [Jobs](docs/en/modules/jobs/index.md) | `pi-background-jobs`, `pi-interactive-shell` |
| [Tasks](docs/en/modules/tasks.md) | `@tintinweb/pi-tasks` |

### Goal

`/goal <objective>` sets one objective for the session. The model keeps working across turns until it completes the goal with evidence (`goal_complete`), reports a blocker (`goal_blocked`), or you pause it. `--tokens 100k` sets an optional token budget. `goal_wait` waits for jobs, subagents and workflows in the same way as `wait` (see [Agents](#agents)).

### Agents

Subagents are child Pi sessions that run in the same process, in the foreground or background.

- **Types**: the built-in `general-purpose`, `Explore` and `Plan`, plus custom types defined by a Markdown file in `~/.pi/agent/agents/` (user) or `.pi/agents/` (project). A type sets the system prompt, tools, model, thinking level, turn limit, skills and persistent memory; `agents.types` overrides the model and thinking of any type. See [Agent types, models and resources](docs/en/modules/agents/types-and-models.md).
- **Mentions**: `@<type> <message>` in the editor, for example `@explore where is the config loaded?`, hands the message to a subagent of that type.
- **Questions**: a subagent's `ask_user` question goes to the session that started it.
- **Recovery**: a subagent stopped by a network or upstream error is resumed in the same session.
- **Waiting**: `wait` waits for any mix of jobs, subagents and workflows, and returns early when a monitor fires or a subagent asks a question.

Subagents can also run on a [schedule](docs/en/modules/agents/schedules.md). A [workflow](docs/en/modules/agents/workflows.md) script fans out many subagents and can resume from an earlier run. Other extensions start and control subagents through the [RPC API](docs/en/modules/agents/rpc.md).

### Ask

`ask_user` lets the model ask you one question or a batch of 2–4, with options, defaults, multi-select, free-text answers and an idle timeout (`ask.timeout`).

### Jobs

Jobs run commands in the background in pipe or PTY mode. The model reads bounded log slices, sends input, and sets output monitors that wake it on a literal, regex or numeric threshold match. In `/jobs` you can read the logs or take over a PTY with `i`.

Presets start coding-agent CLIs in a PTY. The model supervises them hands-free, and you can take over the terminal at any time. See [CLI presets and PTY supervision](docs/en/modules/jobs/cli-and-hands-free.md).

Stopping a job checks that every captured process has exited, and reports `unconfirmed` when it cannot.

### Tasks

A two-level task list (groups and child tasks) that the model maintains and the Dock displays, with dependencies and atomic batch edits. A job or subagent can be linked to a task, and a subagent started for a task can update it.

## Interface

The Dock shows the goal, tasks, subagents, jobs and workflows; press ← in an empty editor to select a row. `/tasks`, `/jobs` and `/subagents` share one browser layout, whose detail pane colors names, IDs, states and errors.

Each suite tool call and notification takes one line and expands to labeled fields; a failed tool shows the first line of its error. Results from all modules are merged into one notification per wake-up and delivered only to the session that owns the work.

Commands in Pi's built-in `bash` / `powershell` calls and in jobs are highlighted by structure: program, options, variables, strings, operators and redirections. The highlighter only scans the text and never runs the command.

The package also includes the `oh-my-pi` dark theme, and makes Pi's copy work inside tmux through OSC 52. See [Interface](docs/en/interface.md).

## Commands

| Command | What it does |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | Starts a goal. `/goal status`, `edit`, `pause`, `resume` and `clear` show, change, pause, resume or clear it. |
| `/tasks [group ID]` | Browse the task list, optionally opening one group. |
| `/jobs [finished\|all] [workspace]` | Browse jobs, read logs, or take over a PTY with `i`. Lists active jobs of this session by default. |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | Browse subagent runs, transcripts, types, schedules and workflows; `/subagents workspace [...]` covers the whole workspace. |
| `/suite` | View and edit settings one by one. |
| `/exit` | Quit Pi after stopping jobs and subagents and waiting for cleanup, up to 10 seconds for jobs. |

## Settings

No configuration is required. Optional settings live in `~/.pi/agent/pi-suite.json` (user) and `.pi/pi-suite.json` (project); the project file overrides the user file field by field. Common settings:

| Setting | Default | What it does |
| --- | --- | --- |
| `modules.<ask\|tasks\|jobs\|goal\|agents>` | `true` | Enable or disable one module. |
| `commands.exit` | `true` | Register `/exit`. |
| `ui.maxRows` | `12` | Maximum rows the Dock uses. |
| `ui.highlightBuiltinCommands` | `true` | Highlight commands in Pi's built-in `bash`/`powershell` calls. |
| `ask.timeout` | `600000` | Default `ask_user` idle timeout in ms; `0` waits forever. |
| `goal.display`, `agents.display`, `jobs.display` | `status` | Show the summary in the footer status, the Dock, or nowhere. |
| `tasks.reminders` | `true` | Remind the model when it has not updated tasks for several turns. |
| `agents.maxConcurrent` | `10` | Background subagent concurrency limit. |
| `agents.maxDepth` | `3` | Maximum session depth, including the main session. |
| `agents.defaultModel`, `agents.types` | unset | Default subagent model; per-type model, thinking and enabled overrides. |
| `agents.mentions`, `agents.scheduling`, `agents.workflows` | `true` | `@handle` mentions, schedules and workflows. |
| `jobs.detachKey`, `jobs.returnKey`, `jobs.transferKey` | `ctrl+]`, `ctrl+g`, `ctrl+t` | Leave the terminal view, hand input back to the model, send the screen. |
| `runtime.openAIResponsesAutoRecovery` | `false` | When an OpenAI Responses endpoint rejects history created under another upstream account (for example behind a gateway), drop the rejected item IDs or encrypted reasoning and continue. See [OpenAI Responses recovery](docs/en/configuration.md#openai-responses-recovery). |

```json
{
  "modules": { "goal": false },
  "agents": { "maxConcurrent": 4, "types": { "Explore": { "model": "anthropic/claude-haiku-4-5" } } }
}
```

All fields are listed in [Configuration](docs/en/configuration.md). You can also edit them with `/suite`.

## Documentation

- [English documentation](docs/en/index.md)
- [中文文档](docs/zh/index.md)

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
```

See [Development](docs/en/development.md) for the source layout and project rules.

## Credits and license

Pi Suite adapts code and tool contracts from several MIT-licensed Pi extensions: `pi-ask-user`, `@tintinweb/pi-tasks`, `pi-interactive-shell`, `pi-background-jobs`, `@narumitw/pi-goal` and `@tintinweb/pi-subagents`. The theme is based on Oh My Pi's Titanium palette. Details and license texts are in [`third-party/UPSTREAM.md`](third-party/UPSTREAM.md).

Pi Suite is released under the [MIT License](LICENSE).
