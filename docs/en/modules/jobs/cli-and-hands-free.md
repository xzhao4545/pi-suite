# CLI presets and PTY supervision

[Jobs](index.md) · [Documentation index](../../index.md)

## CLI presets

Instead of `command`, `job_start` can take `agent` to run a coding-agent CLI with a literal task prompt:

| `agent` field | Meaning |
| --- | --- |
| `preset` | A key of `jobs.agents`: lowercase letter first, then lowercase letters, digits or `-`, up to 64 characters. |
| `prompt` | The task, 1–16000 characters. It is passed verbatim; spaces, newlines, quotes, `$` and backticks are preserved. |
| `fork` | `pi` only. Start with `--fork <current session file>`. Requires a saved session. |

Built-in presets:

| Preset | Command | Default args |
| --- | --- | --- |
| `pi` | `pi` | none |
| `codex` | `codex` | none |
| `claude` | `claude` | none |
| `cursor` | `agent` | `--model composer-2-fast` |

The suite does not install these CLIs. A missing command shows up as the job's real exit result.

The prompt is passed as one positional argument after `--`, so a prompt that starts with `--` is still treated as text. For `pi`, a prompt starting with `@` is passed through a dedicated flag so Pi does not treat it as a file attachment.

With the default `pipe` mode, the `pi` preset closes stdin after starting so Pi runs the task and exits. Use `mode: "pty"` when you want to keep talking to the CLI. A `pi` preset configured for RPC mode is rejected, because RPC mode does not run an initial prompt.

### Custom presets

`jobs.agents` merges per preset and per field across the built-in, user and project layers. `command` is one executable name or path, not a shell command line. `args` is an array that replaces the earlier layer's array as a whole.

```json
{
  "jobs": {
    "agents": {
      "claude": { "args": ["--model", "sonnet"] },
      "local": { "command": "local-cli", "args": ["--verbose"] }
    }
  }
}
```

A new preset must have a `command`. Apply changes with `/reload`.

## Hands-free supervision

`handsFree` lets the model supervise a PTY program through periodic updates instead of reading the log repeatedly. It requires `mode: "pty"` and can be combined with `monitor`.

| Field | Default | Meaning |
| --- | --- | --- |
| `mode` | `hands-free` | `hands-free` sends progress updates. `dispatch` sends only the final result. |
| `updateMode` | `onQuiet` | `onQuiet` sends new output after the program goes quiet. `interval` sends on a fixed period. |
| `quietMs` | 8000 | Silence that counts as quiet. Visible output and model input restart it. |
| `updateIntervalMs` | 60000 | The `interval` period, or the longest gap in `onQuiet` while output keeps flowing. |
| `autoExitOnQuiet` | `false` for hands-free, `true` for dispatch | Stop the program when it goes quiet after the grace period. |
| `graceMs` | 15000 | Time after start before quiet stopping can happen. `0` means none. |
| `updateMaxChars` | 1500 | Output characters per update, 1–65536. |
| `maxTotalChars` | 100000 | Output character budget for all updates, 0–1000000. After it is spent, updates carry status only. |

One-off delegation to another agent CLI:

```json
{
  "agent": { "preset": "pi", "prompt": "Read the plan in PLAN.md and continue the implementation", "fork": true },
  "mode": "pty",
  "handsFree": { "mode": "dispatch" }
}
```

Quiet output is not proof that the program succeeded. A job stopped this way ends as `stopped` with `completionReason: "quiet"`. Updates arrive as notifications; `wait` returns early on them and `goal_wait` resumes on them. `job_start.timeoutMs` still limits the total run time.

## Terminal view

The terminal view shows the PTY's live screen with colors, cursor and scrollback. It is opened by `attach: true`, from the Dock, or from `/jobs`. From the Dock or `/jobs` it starts in browse mode, which never sends keys to the program; `attach: true` opens it already in control mode.

| Key | Mode | Action |
| --- | --- | --- |
| ↑ / ↓, PageUp / PageDown, Home / End, wheel | browse | Scroll the scrollback. End or `f` follows new output. |
| `i` | browse | Take over input. |
| any key | input | Sent to the program as typed. |
| Ctrl+G (`jobs.returnKey`) | input | Hand input back to the model and stay in the view. |
| Ctrl+T (`jobs.transferKey`) | input | Leave and send the current screen to the model. |
| Ctrl+] (`jobs.detachKey`) | any | Leave the view. The job keeps running. |
| Shift+↑ / ↓ | input | Scroll the scrollback. |
| `x` twice | browse | Stop the job. |
| Esc, or ← ← | browse | Go back, or close the whole browser chain. |

While you have input control, model writes return `USER_CONTROL` and hands-free updates and quiet stopping pause. Leaving the view always hands control back to the model. Keys you type are logged like `sensitive` input: time, source and byte count only.

When a PTY job ends, its final screen and up to 1000 lines of scrollback are saved, so the screen can still be viewed after Pi restarts. Records without a saved screen show `Logs only`.

`job_read` on a PTY returns visible text: carriage-return overwrites and line edits are applied and password echo is masked, but full-screen layouts are not rebuilt into a 2-D image. `offset` values still refer to raw log bytes.

## Verified CLIs

On Linux, Pi 1.5.0, Codex 0.166.0 and Claude Code 2.1.153 have been checked for PTY text interaction. On Windows, Pi 1.5.0, Codex 0.162.1 and Claude Code 2.1.301 have been checked. The `cursor` preset has not been checked against the real CLI.
