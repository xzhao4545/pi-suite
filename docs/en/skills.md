# Skills

[Documentation index](index.md)

The package publishes two skills through `pi.skills`. Pi lists their names and descriptions in the system prompt, and the model reads the full text when a task matches.

| Skill | Use |
| --- | --- |
| [`pi-suite-jobs`](../../skills/pi-suite-jobs/SKILL.md) | Background commands, interactive CLIs and supervised coding-agent terminals: choosing pipe or PTY, input, bounded logs, waits, monitors, terminal handoff, stopping and history cleanup. |
| [`pi-suite-workflow`](../../skills/pi-suite-workflow/SKILL.md) | Writing, running, iterating and resuming `agent_workflow` scripts. Read only after the user has opted into multi-agent orchestration. |

Skills stay discoverable even when the related module is disabled. The `pi-suite-jobs` skill tells the model to check which job tools exist first; if a required tool is missing, it asks the user with `ask_user` when that tool is available, otherwise explains the limitation, and does not edit the configuration on its own.
