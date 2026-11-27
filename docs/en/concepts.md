# Concepts

[Documentation index](index.md)

This page covers the rules that all modules share. Module pages refer back here instead of repeating them.

## One extension, several modules

Pi loads a single entry point, `src/index.ts`. On the first `session_start` it reads the configuration for the session's working directory and activates the enabled modules: ask, tasks, jobs, goal and agents. The modules share one Dock, one set of browser and reading views, one notification queue, one JSON storage layer and one `wait` tool.

Module switches (`modules.*`) are applied when Pi activates the extension. Changing a switch takes effect after `/reload`. Switching to a new, resumed or forked session, or moving in the session tree, keeps the same module set and only rebinds it to the new session.

## Execution lifetime

Jobs, subagents and workflows run inside the current Pi process and are owned by the session that started them.

- `/reload`, `/new`, `/resume`, `/fork` and tree navigation do not stop them. The suite only rebinds its UI and notifications.
- Quitting Pi (`/quit`, or the suite's `/exit`) stops all managed jobs, PTYs, subagents and workflows, and waits for their cleanup. Jobs share a 10-second stop deadline; a job whose cleanup cannot be confirmed by then is recorded as `unconfirmed`.
- After Pi restarts, saved records and logs can still be read, but a process or PTY from the old Pi process cannot be reattached or controlled.

## IDs

| Prefix or form | Object |
| --- | --- |
| `job_3fa1c2d0` | A background job (`job_` plus 8 hex digits). |
| `agent_…` | A subagent. The ID stays the same when the agent is resumed. |
| `run_…` | One execution of a subagent. Each resume creates a new run. |
| `wf_…` | A workflow run. |
| `1`, `1.2` | A task group and a child task. Task references also carry a list `generation`; see [Tasks](modules/tasks.md#generations). |
| `goalId` | The current goal. The model receives the exact ID in the goal context. |

## Visibility scopes

List tools and browsers offer two scopes:

- **session** (default): objects owned by the current session whose starting point is on the current branch. For jobs this includes jobs started by visible subagents; for agents it is the direct children.
- **workspace**: saved records of the whole workspace. For jobs, the workspace is the Git top-level directory of the job's cwd, or the cwd itself outside a repository or without Git. For agents, it is the session's working directory.

Being listed does not mean being controllable. Records owned by other sessions, other branches or an earlier Pi process can be read but not stopped, resumed or written to.

## Notifications

When a job, subagent or workflow settles, or a subagent asks its parent a question, the suite sends one `pi-suite:notification` message to the owning session. Notifications that have not been delivered yet are merged into a single message and wake the model once.

- Delivery waits while an `ask_user` question, a browser or a detail view is open, and resumes when it closes.
- After you press Esc to interrupt the model, pending results stop waking it automatically. They arrive with your next message.
- If a result is returned by `wait`, `job_stop` or a similar call first, its notification is withdrawn.
- Notifications for a session that is not currently bound are kept until that session is bound again.

## The `wait` tool

`wait` blocks until jobs, subagents or workflows settle.

| Parameter | Meaning |
| --- | --- |
| `ids` | 1–50 IDs with `job_`, `agent_` or `wf_` prefixes. |
| `mode` | `all` (default) or `any`. |
| `timeoutMs` | Default 300000 (5 minutes), maximum 3600000. |

`wait` also returns early when another visible object settles, a job monitor event or hands-free update arrives, a direct child asks a question, or the user sends a message. `details.reason` reports `condition`, `question`, `event`, `other`, `user` or `timeout`. A timeout or cancellation only ends the wait; it never stops the objects.

## Timeouts are scoped

Several tools take a millisecond timeout, and each one controls something different:

- `ask_user.timeoutMs`: how long the user may stay idle before the question is answered automatically.
- `wait.timeoutMs`: how long this one `wait` call blocks.
- `job_start.timeoutMs`: the job's run time limit. When it expires the process is stopped.

## Reading output

`job_read` and `agent_read` share one reader:

- `limitBytes` defaults to 4096 and is capped at 65536.
- Without `offset`, a long output is summarized as head, error-like lines and tail. The skipped byte ranges are reported so you can fetch them.
- `offset` reads raw bytes and returns `nextOffset`, which always lands on a UTF-8 character boundary. Continue with the returned value. While a job is still writing, the end of its log may be an incomplete character; `nextOffset` then stops before it until the rest arrives.
- `search` takes a JavaScript regular expression, either `/re/flags` or a bare pattern matched case-insensitively. `context` sets the number of surrounding lines (default 2).

## Errors

Tool errors start with a code, followed by the reason and a suggested next step. All codes are listed in [Model tools](tools.md#error-codes).

## Where data is stored

`<agentDir>` is Pi's agent directory (`~/.pi/agent` by default, or `PI_CODING_AGENT_DIR`).

| Data | Location |
| --- | --- |
| User configuration | `<agentDir>/pi-suite.json` |
| Project configuration | `<session cwd>/.pi/pi-suite.json` (the suite does not search parent directories) |
| Tasks | `<cwd>/.pi/tasks/tasks-<sessionId>.json` |
| Goal | `<agentDir>/pi-suite/goals/session-<sessionId>/state.json` |
| Jobs | `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/` |
| Schedules | `<agentDir>/pi-suite/agents/schedules/<sessionId>.json` |
| Workflow runs | `<agentDir>/pi-suite/agents/workflows/<sessionId>/<wfId>/` |

Sessions that are not saved to disk keep tasks and the goal in memory only. Every JSON file is written atomically (write to a temporary file, then rename). Configuration, tasks, the goal, schedules and workflow runs are also written under a cross-process lock; job metadata and PTY screen snapshots are not locked. A corrupt file is reported as an error and is never overwritten.
