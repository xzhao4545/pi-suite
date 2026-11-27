# Installation

[Documentation index](index.md)

## Requirements

- Node.js 24 or later.
- Official, unmodified Pi **1.5.0** or later. The suite is developed and tested against 1.5.0 and follows Pi releases.
- pnpm 12.6.0, only when you install from a local checkout or develop the suite.

The package is `private: true` and is not published to npm. Loading through the official Pi CLI and RPC entry points is verified. Consumer installs from Git, a local path or a tarball follow Pi's normal package flow but are not yet part of the verified scope.

## Install from GitHub

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

Pi clones the default branch, installs runtime dependencies, loads `src/index.ts` through `pi.extensions`, and discovers the bundled skills and theme. The source is written to your user-level Pi `settings.json`. Add `-l` to write it to the project-level settings instead; project resources follow Pi's trust rules.

Update later with:

```sh
pi update git:github.com/xzhao4545/pi-suite
```

After installing or updating, run `/reload` in an open session or restart Pi. All modules are enabled by default and no configuration file is needed.

## Install from a local checkout

```sh
cd /absolute/path/to/pi-suite
pnpm install
pi install /absolute/path/to/pi-suite
pi list
```

Pi loads the directory in place, so it must stay accessible. After editing source files, run `/reload`. After changing dependencies, run `pnpm install` first. `-l` only controls which settings file records the source; it is independent of whether the source is a local path.

To switch from the GitHub source to a local checkout, install the local directory first, then run `pi remove git:github.com/xzhao4545/pi-suite`. Use `pi list` to confirm that only one Pi Suite source remains, then `/reload` or restart.

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

## Run without installing

For a one-off session from a checkout:

```sh
pnpm exec pi -e .                  # whole package: extension, skills and theme
pnpm exec pi -e ./src/index.ts     # extension only, no package theme
```

Pi's `/reload` reloads extensions only. After upgrading Pi or the suite's dependencies, quit Pi and start it again; use `--resume` to continue the same session.
