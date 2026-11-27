# Pi Suite

[中文](README.zh-CN.md) · [Documentation](docs/en/index.md)

Pi Suite is an extension package for [Pi](https://github.com/earendil-works/pi), the terminal coding agent. It adds interactive questions, task lists, background jobs, persistent goals and subagents as one extension that shares a single UI, storage layer and notification queue.

## Features

| Module | What it gives you |
| --- | --- |
| [Ask](docs/en/modules/ask.md) | `ask_user`: the model asks you one question or a batch of 2–4, with options, defaults, multi-select, free-text answers and an idle timeout. |
| [Goal](docs/en/modules/goal.md) | `/goal <objective>`: the model keeps working across turns until it completes the goal with evidence, reports a blocker, or you pause it. Optional token budget. |
| [Tasks](docs/en/modules/tasks.md) | A two-level task list (groups and child tasks) that the model maintains and the Dock displays, with dependencies and atomic batch edits. |
| [Jobs](docs/en/modules/jobs/index.md) | Background commands in pipe or PTY mode: bounded log reading, input, output monitors, coding-agent CLI presets, supervised terminals, and stops that check every captured process has exited and report `unconfirmed` when they cannot. |
| [Agents](docs/en/modules/agents/index.md) | Subagents as child Pi sessions in the same process: custom types, per-type models and thinking, `@handle` mentions, questions to the parent, automatic resume after network or upstream errors, schedules, scripted [workflows](docs/en/modules/agents/workflows.md) and an [RPC API](docs/en/modules/agents/rpc.md) for other extensions. |

Shared pieces:

- **Dock**: one panel above the editor showing goal, tasks, subagents, jobs and workflows. Press ← in an empty editor to select a row and open it.
- **Browsers**: `/tasks`, `/jobs` and `/subagents` for filtering, reading transcripts and logs, and controlling runs.
- **`wait`**: one tool that waits for any mix of jobs, subagents and workflows.
- **Notifications**: results and questions are merged and delivered to the owning session once.
- **Extras**: the `oh-my-pi` dark theme, and the `pi-suite-jobs` and `pi-suite-workflow` skills.

## Requirements

- Node.js 24 or later.

## Install

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

Then run `/reload` in an open session, or restart Pi. All modules are enabled by default. See [Installation](docs/en/installation.md) for updates and local installs.

## Commands

| Command | What it does |
| --- | --- |
| `/goal [--tokens 100k] <objective>` | Starts a goal; the model keeps working across turns until it is done. `/goal status`, `edit`, `pause`, `resume` and `clear` show, change, pause, resume or clear it. |
| `/tasks [group ID]` | Browse the task list, optionally opening one group. |
| `/jobs [finished\|all] [workspace]` | Browse jobs, read logs, or take over a PTY with `i`. Lists active jobs of this session by default. |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | Browse subagent runs, transcripts, types, schedules and workflows; `/subagents workspace [...]` covers the whole workspace. |
| `/suite` | View and edit settings one by one. |
| `/exit` | Quit Pi after stopping jobs and subagents and waiting for cleanup, up to 10 seconds for jobs. |

Type `@<type>` in the editor (for example `@explore where is the config loaded?`) to hand the message to a subagent of that type.

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
| `runtime.openAIResponsesAutoRecovery` | `false` | Recover from one class of OpenAI Responses item ID errors. |

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
