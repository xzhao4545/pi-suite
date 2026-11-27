# Installation

[Documentation index](index.md)

## Requirements

- Node.js 24 or later.
- Official, unmodified Pi **1.6.1** or later. The suite is developed and tested against 1.6.1 and follows Pi releases.

## Install from npm

```sh
pi install npm:pi-suite
pi list
```

Pi installs the latest published version and its runtime dependencies under the Pi npm directory, loads `src/index.ts` through `pi.extensions`, and discovers the bundled skills and theme. The source is written to your user-level Pi `settings.json`. Add `-l` to write it to the project-level settings instead; project resources follow Pi's trust rules.

Update later with:

```sh
pi update npm:pi-suite
```

A source pinned to a version, such as `npm:pi-suite@0.3.0`, is not updated; install the new version to move to it.

After installing or updating, run `/reload` in an open session or restart Pi. All modules are enabled by default and no configuration file is needed.

Pi's `/reload` reloads extensions only. After upgrading Pi or the suite's dependencies, quit Pi and start it again; use `--resume` to continue the same session.

## Replace standalone extensions

Pi Suite includes the capabilities of the extensions below. Keeping both registers duplicate tools, commands and UI. Install Pi Suite first, check the exact sources with `pi list`, then remove the standalone packages.

| Standalone extension | Pi Suite module |
| --- | --- |
| `pi-ask-user` | ask |
| `@tintinweb/pi-tasks` | tasks |
| `pi-interactive-shell` | jobs (PTY, interaction and supervision) |
| `pi-background-jobs` | jobs (background execution and logs) |
| `@narumitw/pi-goal` | goal |
| `@tintinweb/pi-subagents` | agents, schedules and workflows |

Use the full source shown by `pi list`, including a pinned version suffix if there is one:

```sh
pi remove npm:pi-ask-user
pi remove npm:@tintinweb/pi-tasks
pi remove npm:pi-interactive-shell
pi remove npm:pi-background-jobs@0.1.3
pi remove npm:@narumitw/pi-goal
pi remove npm:@tintinweb/pi-subagents
```

Pi Suite does not migrate configuration or stored data from these extensions.

`@narumitw/pi-starship` is a separate footer and can stay installed. Pi Suite publishes its status through Pi's extension status API, which pi-starship reads; see [Interface](interface.md#footer-status).
