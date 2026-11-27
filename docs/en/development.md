# Development

[Documentation index](index.md)

## Setup and checks

Requires Node.js 24+ and pnpm 12.6.0. From the package root:

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # Node's built-in test runner with TypeScript transforms
```

Pi loads the TypeScript sources directly; there is no build step. To try changes:

```sh
pnpm exec pi -e .                # whole package, including skills and theme
pnpm exec pi -e ./src/index.ts   # extension only
```

Run `/reload` after editing source files. Restart Pi after upgrading dependencies, because `/reload` does not replace modules that Pi itself has already loaded.

To use a checkout as your installed copy, install the directory and remove the npm package so that only one Pi Suite source remains:

```sh
pi install /absolute/path/to/pi-suite
pi remove npm:pi-suite
pi list
```

Pi loads the directory in place, so it must stay accessible. After changing dependencies, run `pnpm install` first. `-l` only controls which settings file records the source.

`pnpm-lock.yaml` and `pnpm-workspace.yaml` are committed. The workspace file keeps Windows and Linux optional dependencies in the lockfile (`supportedArchitectures`) and disables two dependency install scripts that only print messages (`allowBuilds`). Commit lockfile changes together with the `package.json` change that caused them.

## Source layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | The only extension entry point. |
| `src/runtime/` | Session binding, configuration, notifications, JSON store, shared `wait`, tool registration and renderers, `/suite` settings, Responses recovery. |
| `src/ui/` | Dock, browser, details and reading views, tool display, command highlighting. |
| `src/ask/` | `ask_user`. |
| `src/goal/` | Goal state, lifecycle, context and `/goal`. |
| `src/tasks/` | Task store, model, tools and `/tasks`. |
| `src/jobs/` | Job manager, pipe/PTY backends, monitors, presets, terminal and `/jobs`. |
| `src/agents/` | Subagent manager, runner, types and resources, mentions, schedules, RPC, workflows and `/subagents`. |
| `skills/` | The `pi-suite-jobs` and `pi-suite-workflow` skills. |
| `themes/` | The `oh-my-pi` theme. |
| `tests/` | Tests grouped by module, with shared helpers in `tests/support/`. |
| `third-party/` | Upstream source records and licenses. |

Modules are loaded lazily: viewers, the PTY backend, the child runner and the workflow worker are imported the first time they are used.

## Documentation

| Location | Audience and content |
| --- | --- |
| `README.md`, `README.zh-CN.md` | Project overview. |
| `docs/en/`, `docs/zh/` | User documentation, kept in sync in English and Chinese. Update it whenever user-visible behavior changes. |
| `doc/current/` | Maintainer documentation (Chinese): current design, protocols, data models and validation. |
| `doc/todo/`, `doc/finished/` | Planned work and archived completed work. |

Project rules for code and documentation are in [`AGENTS.md`](../../AGENTS.md).

## Releasing

The package is published to npm as `pi-suite`. Pushing a `v*` tag runs `.github/workflows/publish.yml`: it checks that the tag matches `version` in `package.json`, runs `pnpm typecheck` and `pnpm test`, then publishes through npm trusted publishing, so the repository stores no npm token. The tarball contains only the paths listed in `files` in `package.json`.

To release a new version:

1. Bump `version` in `package.json` and commit.
2. Create an annotated tag with the same version, for example `git tag -a v0.3.1 -m "pi-suite 0.3.1"`.
3. Push the commit and the tag: `git push origin main v0.3.1`.

## Platform coverage

- Supported host: official, unmodified Pi 1.6.1 or later. Peer dependencies are `>=1.6.1`; dev dependencies are pinned to exactly `1.6.1` as the test baseline and are upgraded when adapting to a new Pi release.
- Verified on Linux and Windows, each within the scope recorded for the module in [`doc/current/validation.md`](../../doc/current/validation.md).
- Subagents share the parent's model runtime through a guarded read of a private Pi field. A Pi upgrade can break this; such a failure is reported as `MODEL_RUNTIME_UNAVAILABLE`, and the suite never falls back to a separate runtime.

## Upstream sources

Parts of the suite are adapted from MIT-licensed extensions: `pi-ask-user`, `@tintinweb/pi-tasks`, `pi-interactive-shell`, `pi-background-jobs`, `@narumitw/pi-goal` and `@tintinweb/pi-subagents`. The theme is based on Oh My Pi's Titanium palette (MIT). Versions, imported files and license texts are listed in [`third-party/UPSTREAM.md`](../../third-party/UPSTREAM.md) and [`third-party/licenses/`](../../third-party/licenses/).

The OpenAI Responses recovery follows the observed behavior of `pi-model-manager` (AGPL-3.0-only) but is implemented independently, without copying its code.
