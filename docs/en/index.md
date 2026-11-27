# Pi Suite documentation

[中文](../zh/index.md) · [Project README](../../README.md)

These pages describe how to install, configure and use Pi Suite. They are written for Pi users and for people who write prompts, agent types or workflows that rely on the suite's tools. Implementation design notes for maintainers live in [`doc/current`](../../doc/current/index.md) (Chinese).

## Getting started

- [Installation](installation.md): install from GitHub or a local checkout, update, and remove standalone extensions that the suite replaces.
- [Concepts](concepts.md): sessions and ownership, IDs, notifications, the shared `wait` tool, and what survives `/reload`.
- [Configuration](configuration.md): `pi-suite.json` fields, precedence, the `/suite` settings page, `/exit`, and OpenAI Responses recovery.
- [Interface](interface.md): the Dock, browsers and reading views, footer status, the bundled theme and command highlighting.

## Modules

- [Ask](modules/ask.md): `ask_user` questions, defaults, timeouts and result states.
- [Goal](modules/goal.md): `/goal`, goal lifecycle, budgets and the `goal_*` tools.
- [Tasks](modules/tasks.md): two-level task lists, generations, `/tasks` and reminders.
- [Jobs](modules/jobs/index.md): pipe and PTY background jobs, logs, monitors and `/jobs`.
  - [CLI presets and PTY supervision](modules/jobs/cli-and-hands-free.md)
- [Agents](modules/agents/index.md): in-process subagents, `/subagents`, `@handle` mentions and parent questions.
  - [Agent types, models and resources](modules/agents/types-and-models.md)
  - [Schedules](modules/agents/schedules.md)
  - [Workflows](modules/agents/workflows.md)
  - [Cross-extension RPC](modules/agents/rpc.md)

## Reference

- [Model tools](tools.md): every tool the suite registers, its parameters and common error codes.
- [Skills](skills.md): the `pi-suite-jobs` and `pi-suite-workflow` skills.
- [Development](development.md): source layout, checks, documentation rules and platform coverage.
