# Pi Suite

[中文](README.zh-CN.md) · [Documentation](docs/en/index.md)

Pi Suite is an extension package for [Pi](https://github.com/earendil-works/pi), the terminal coding agent. It adds interactive questions, task lists, background jobs, persistent goals and subagents as one extension that shares a single UI, storage layer and notification queue.

It runs on official, unmodified Pi 1.5.0 and needs no changes to Pi itself. The current version is 0.1.2 (Git tag `v0.1.2`).

## Features

| Module | What it gives you |
| --- | --- |
| [Ask](docs/en/modules/ask.md) | `ask_user`: the model asks you one question or a batch of 2–4, with options, defaults, multi-select, free-text answers and an idle timeout. |
| [Goal](docs/en/modules/goal.md) | `/goal <objective>`: the model keeps working across turns until it completes the goal with evidence, reports a blocker, or you pause it. Optional token budget. |
| [Tasks](docs/en/modules/tasks.md) | A two-level task list (groups and child tasks) that the model maintains and the Dock displays, with dependencies and atomic batch edits. |
| [Jobs](docs/en/modules/jobs/index.md) | Background commands in pipe or PTY mode: bounded log reading, input, output monitors, coding-agent CLI presets, supervised terminals, and stops that check every captured process has exited and report `unconfirmed` when they cannot. |
| [Agents](docs/en/modules/agents/index.md) | Subagents as child Pi sessions in the same process: custom types, per-type models and thinking, `@handle` mentions, questions to the parent, schedules, scripted [workflows](docs/en/modules/agents/workflows.md) and an [RPC API](docs/en/modules/agents/rpc.md) for other extensions. |

Shared pieces:

- **Dock**: one panel above the editor showing goal, tasks, subagents, jobs and workflows. Press ← in an empty editor to select a row and open it.
- **Browsers**: `/tasks`, `/jobs` and `/subagents` for filtering, reading transcripts and logs, and controlling runs.
- **`wait`**: one tool that waits for any mix of jobs, subagents and workflows.
- **Notifications**: results and questions are merged and delivered to the owning session once.
- **Extras**: the `oh-my-pi` dark theme, and the `pi-suite-jobs` and `pi-suite-workflow` skills.

## Requirements

- Node.js 24 or later.
- Pi 1.5.0 (official build). Other Pi versions are not supported.
- Linux or Windows.

## Install

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

Then run `/reload` in an open session, or restart Pi. All modules are enabled by default.

The package has been loaded and tested from this repository. Installing it as a Git, local or tarball package from another project has not been verified yet.

If you use any of `pi-ask-user`, `@tintinweb/pi-tasks`, `pi-interactive-shell`, `pi-background-jobs`, `@narumitw/pi-goal` or `@tintinweb/pi-subagents`, remove them to avoid duplicate tools. See [Installation](docs/en/installation.md) for local installs, updates and replacing these extensions.

## Quick start

| Try | What happens |
| --- | --- |
| `/goal Make the test suite pass` | Starts a goal; the model keeps working across turns while the goal stays active. |
| Ask the model to "run the dev server in the background and tell me when it's ready" | It starts a job with a monitor and is woken when the output matches. |
| `@explore where is the config loaded?` | Sends the question to an Explore subagent. |
| `/subagents` | Browse subagent runs, transcripts, types, schedules and workflows. |
| `/jobs` | Browse jobs, read logs, or take over a PTY with `i`. |
| `/tasks` | Browse the task list. |
| `/suite` | Edit settings. |
| `/exit` | Quit Pi. The suite stops jobs and subagents and waits for cleanup, up to 10 seconds for jobs. |

## Configuration

No configuration is required. Optional settings live in `~/.pi/agent/pi-suite.json` (user) and `.pi/pi-suite.json` (project); the project file overrides the user file field by field.

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
pnpm exec pi -e .
```

See [Development](docs/en/development.md) for the source layout and project rules.

## Credits and license

Pi Suite adapts code and tool contracts from several MIT-licensed Pi extensions: `pi-ask-user`, `@tintinweb/pi-tasks`, `pi-interactive-shell`, `pi-background-jobs`, `@narumitw/pi-goal` and `@tintinweb/pi-subagents`. The theme is based on Oh My Pi's Titanium palette. Details and license texts are in [`third-party/UPSTREAM.md`](third-party/UPSTREAM.md).

Pi Suite is released under the [MIT License](LICENSE).
