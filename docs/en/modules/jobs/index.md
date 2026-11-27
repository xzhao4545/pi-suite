# Jobs

[Documentation index](../../index.md) · [CLI presets and PTY supervision](cli-and-hands-free.md)

The jobs module runs commands in the background of the current Pi process and lets the model read their output, send input and stop them. Switch: `modules.jobs`. Display: `jobs.display`.

## Pipe and PTY

| Mode | Use | Logs |
| --- | --- | --- |
| `pipe` (default) | Builds, tests and batch commands. | `stdout` and `stderr` kept separately, plus an `input` record. |
| `pty` | Interactive programs, REPLs, login prompts and coding-agent CLIs. | Terminal `output` and `input`, plus a saved final screen. |

Both modes run through Pi's own Bash selection: `shellPath` in Pi's settings, otherwise Pi's default lookup. On Windows, the WSL `C:\Windows\System32\bash.exe` reads its script from stdin. PTY jobs refuse it. Pipe jobs run, but they cannot accept `job_write` input or use `monitor.detector`. Set `shellPath` to Git Bash to avoid these limits.

Jobs are grouped by workspace: the Git top-level directory of the job's cwd, or the cwd itself outside a repository or when Git is not installed.

## Tools

| Tool | Parameters |
| --- | --- |
| `job_start` | `command` or `agent` (a [CLI preset](cli-and-hands-free.md#cli-presets)), `mode?`, `name?`, `cwd?`, `timeoutMs?` (no limit by default), `taskId?` with `taskGeneration?`, `attach?`, `monitor?`, `handsFree?`. Returns the job ID at once. Do not add `&` or `nohup`. |
| `job_list` | `state?` (`active` default, `finished`, `all`), `scope?` (`session` default, `workspace`), `cursor?`, `limit?` (default 10, max 100). |
| `job_get` | `id`, `detail?`. `detail: true` adds the full command, cwd, timing, ownership and supervision settings. |
| `job_read` | `id`, `stream?`, `offset?`, `limitBytes?`, `search?`, `context?`. Pipe streams: `stdout` (default), `stderr`, `input`. PTY streams: `output` (default), `input`. Jobs with a monitor also have `events`. See [Reading output](../../concepts.md#reading-output). |
| `job_write` | `id` and exactly one of `input`, `keys` (named keys such as `enter`, `up`, `ctrl+c`; PTY only) or `paste`. `submit` appends Enter. `sensitive` keeps the text out of the input log. `endInput` closes pipe stdin. `submit` or `endInput` may also be sent alone, without text. |
| `job_stop` | `id`. Returns the real result: `requested`, `cleanup` and `affected`. |

`attach: true` is for a PTY job that you must operate yourself, such as a login. It opens the terminal view at once, already in input-control mode, and returns when you leave it. Jobs opened from the Dock or `/jobs` start in browse mode.

Results start with a summary line such as `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`.

## How jobs end

A job only settles when its process is observed to exit:

| State | When |
| --- | --- |
| `completed` | Exit code 0 and no signal. |
| `failed` | Any other exit, or the 100 MiB log limit was reached. |
| `stopped` | Stopped by `job_stop`, the user, or a quiet-exit rule. |
| `timed_out` | `timeoutMs` expired. |

Stopping is verified per platform, for the processes captured when the stop starts. On Linux, the suite records the process group and its descendants from `/proc`, checks each PID's start time, sends SIGTERM, sends SIGKILL only if some of them are still alive after 250 ms, and checks that all of them are gone. On Windows, it records the process tree through CIM, runs `taskkill /T /F`, and checks that the tree is gone. Processes that escape this captured scope are not covered. If cleanup cannot be confirmed before the deadline (10 seconds), the result says `unconfirmed`. Such a job counts as active until its root process is seen to exit. A stop is never reported as successful without this evidence.

A job loaded from history after Pi restarts has no control handle. Stopping it returns `HISTORY_READ_ONLY`; the suite never signals a PID taken from history.

## Notifications

When a job settles, its result (with up to 2 KiB of output preview) is delivered to the owning session once, as described in [Notifications](../../concepts.md#notifications). `wait` and `job_stop` consume the notification if they return the result first.

## Monitors

`monitor` wakes the model when output matches, instead of polling. It works with both modes.

| Field | Meaning |
| --- | --- |
| `strategy` | `stream` (default): match each complete output line. `poll-diff`: rerun `command` every `poll.intervalMs` (default 5000, minimum 250) and match when its output changes; the first run is the baseline. `file-watch`: watch `fileWatch.path` (with `recursive?` and `events?` of `rename`/`change`); give no `command` or `agent`. |
| `triggers` | 1–20 triggers with unique `id`, each with `literal` or `regex` (`/re/flags`, or a bare case-insensitive pattern). `threshold: { captureGroup, op, value }` compares a captured number with `lt`, `lte`, `gt`, `gte` or `eq`. |
| `dedupeExactLine` | Default `true`: the same line fires a trigger only once. |
| `cooldownMs` | Minimum gap between two firings of a trigger. A trigger's own `cooldownMs` wins. |
| `detector` | `{ command, timeoutMs? }`. Receives the candidate event as JSON on stdin and prints `true`/`false` or `{"emit": bool, ...}`. Default timeout 3000 ms. If it fails, the event is delivered with `detectorError`. |

Example: wake the model when a dev server is ready or prints an error.

```json
{
  "command": "pnpm dev",
  "name": "dev server",
  "monitor": {
    "triggers": [
      { "id": "ready", "literal": "Local:" },
      { "id": "error", "regex": "/error|failed/i" }
    ]
  }
}
```

Events are stored in the `events` stream. Undelivered events for one job merge into a single notification with the newest 10. `wait` returns early on monitor events, and `goal_wait` resumes on them.

## Jobs browser

`/jobs [finished|all] [workspace]` opens `Jobs ▸ List`. By default it shows all jobs of the current session, with active jobs first.

| Key | Action |
| --- | --- |
| `w` | Toggle scope: This session or Workspace. |
| `s` | Toggle state: All or Finished. |
| `/`, Tab, Esc | Filter, move to details, go back; see [Browsers](../../interface.md#browsers-and-reading-views). |
| Enter | Open the job viewer. |

The job viewer shows the command and the live output together. Opening a job from the Dock goes straight to this view.

| Key | Action |
| --- | --- |
| `c` | Expand or collapse the command. |
| `d` | Show every field: full command, ID, cwd, ownership, cleanup, monitor and hands-free settings. |
| `s` | Switch stream: stdout, stderr, input, events; for a PTY, the screen and its logs. |
| `[` / `]` / `f` | Load the previous or next 64 KiB of the log, or jump to the latest output and follow it. |
| `i` | Take over input of a running PTY (see [Terminal view](cli-and-hands-free.md#terminal-view)). |
| `x` twice | Stop the job. |
| Delete twice | Delete a settled job's record, logs and screen snapshot. Only offered when cleanup is confirmed and this Pi process can control the record; read-only history cannot be deleted. |

Leaving the viewer never stops the job. Settled-job notifications wait until you close it.

## Storage and limits

Records live in `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`: `job.json`, the log files, `input.jsonl`, `events.jsonl` with a monitor, and `terminal.json` for a PTY's final screen. The final screen is saved on a best-effort basis, limited to 1000 scrollback lines and 4 MiB; if saving fails, the logs are still readable. Sensitive input is logged only as time, source and byte count. One job's logs are limited to 100 MiB; new jobs are refused with `WORKSPACE_CAPACITY` once a workspace holds 1 GiB of history.

## Errors

Besides the [common codes](../../tools.md#error-codes): `RUNTIME_UNAVAILABLE` when an incompatible suite version loaded earlier in the same Pi process still owns running jobs (history, logs and stop keep working; after those jobs end, `/reload` replaces it), `USER_CONTROL` when the user has taken over a PTY, and `REGEX_RESOURCE_LIMIT` when a search regex exhausts the engine.
