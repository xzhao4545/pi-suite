# Goal

[Documentation index](../index.md)

A goal is a persistent objective for the main session. While a goal is active, the suite keeps asking the model to continue after each turn until the model completes it, reports a blocker, or you pause it. Switch: `modules.goal`. Display: `goal.display`.

Each main session has one current goal, shared by all branches of that session tree. A new or forked session starts without a goal. Subagents do not inherit the goal.

## Commands

| Command | Effect |
| --- | --- |
| `/goal <objective>` | Create a goal and start working on it. Replacing an unfinished goal asks for confirmation. |
| `/goal --tokens 100k <objective>` | Create a goal with a token budget. `k` and `m` suffixes are accepted. |
| `/goal` or `/goal status` | Show the full objective, state, reason, ID, usage, turns, active time, progress and errors. |
| `/goal edit <text>` | Change the objective. A turn running for the old text is aborted. |
| `/goal edit --tokens 200k` | Change the budget. Raise an exhausted budget, then `/goal resume`. |
| `/goal pause` | Pause and cancel pending continuation and waits. Progress, usage and evidence are kept. |
| `/goal resume` | Resume an unfinished goal. If Pi is busy, it reports `Goal resumed · waiting` and continues when Pi is idle. |
| `/goal clear` | Remove the goal. |

Objectives are limited to 4000 characters; for longer requirements, point to a file. The budget counts total tokens reported by the provider, including input, output and cache tokens. Without `--tokens` there is no limit.

## States

The goal is stored as `active`, `paused` or `completed`. The status display shows four states:

| Display | Meaning |
| --- | --- |
| `🎯 goal 03:27` | In progress: the model is working, or a continuation is scheduled. |
| `⏳ goal` | Waiting for you, for external work (`goal_wait`), or for Pi to finish a retry or compaction. |
| `⏸ goal` | Paused. `/goal` shows the reason. |
| `✅ goal` | Completed. Shown for 5 seconds. |

The time is active working time only; waiting and paused time are not counted.

## Pausing and resuming

Pausing only stops automatic continuation. Whatever the reason, the model still handles every message you send, with all its tools; it just does not keep going on its own after that turn. If every requirement is already verified, it can complete the goal in that turn.

Whether your next message also restarts automatic work depends on why the goal paused:

| Cause | Your next message | `/goal resume` |
| --- | --- | --- |
| Esc in the editor, a cancelled `ask_user`, a failed or cancelled compaction | Restarts automatic work. | Restarts it. |
| `goal_blocked`, final request failure after retries, automatic stop (below) | Restarts automatic work. | Restarts it. |
| `/goal pause` | Handled; the goal stays paused. | Restarts it. |
| Budget exhausted | Handled; the goal stays paused. | Raise the budget first. |
| Quitting Pi, or a cold start of Pi | Handled; the goal stays paused. A new Pi process never continues a goal on its own. | Restarts it. |

Background notifications, `/reload`, tree navigation and compaction never restart a paused goal.

**Automatic stop.** If 5 consecutive automatic turns make no tool calls, or repeat exactly the same tool calls and results, the goal pauses with reason `no_tools` or `repeated_tools`. This is a guard against loops; it does not judge quality. Your next message restarts automatic work and resets the count.

An `ask_user` that is skipped or times out keeps the goal running. Neither result counts as your consent.

## Model tools

The model receives the exact `goalId` in the goal context and must pass it to these tools.

| Tool | Use |
| --- | --- |
| `goal_complete(goalId, summary)` | Mark the goal complete. `summary` must audit each requirement with verification evidence. Completing twice is harmless and keeps the first evidence. |
| `goal_blocked(goalId, reason, evidence, repeatedTurns)` | Pause because the same external blocker has repeated for at least 3 consecutive turns. Unfinished work is not a blocker. |
| `goal_wait(goalId, reason, waitFor?, resumeAfterMs?)` | Wait for work the model has already started. `waitFor` lists 1–50 `job_`/`agent_`/`wf_` IDs; the goal resumes when all of them settle. It also resumes at the optional `resumeAfterMs` deadline (1–2147483647 ms), on a monitor event or hands-free update from a listed job, on a question from any direct subagent, or on your message. Without `waitFor`, any notification resumes it. |

Tool errors: `INVALID_ARGS` for blank arguments, `NOT_FOUND` for an unknown `goalId`, `NOT_RUNNING` when `goal_wait` or `goal_blocked` is called while the goal is not running automatically, and `STALE_BINDING` when the goal was edited or replaced, or the turn no longer owns it.

## Status display

With `goal.display: "status"` (default), the summary appears in the footer status; with `dock`, it appears in the Dock; with `hidden`, it is not shown. `/goal` opens a detail view with the usual reading keys (scroll, `/` search, `n`/`N`, Esc).

## Context use

The goal objective and execution rules are added to the conversation once per goal revision, as a session message. Small control messages are appended only when the state, budget or the model's allowed goal tools change. Usage, turns and progress stay in the suite's state and are not copied into every request, which keeps the request prefix stable across turns.
