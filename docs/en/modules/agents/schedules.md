# Schedules

[Agents](index.md) · [Documentation index](../../index.md)

`agent_start` with `schedule` registers a future background run instead of starting one now. Switch: `agents.scheduling` (default `true`). Only the main session's `agent_start` has this parameter.

```json
{ "type": "Explore", "prompt": "Summarize new issues in the tracker", "schedule": "0 0 9 * * 1" }
```

The call returns the schedule ID, the type and the next run time. `schedule` cannot be combined with `background: false` or `inheritContext`.

## Time formats

| Format | Example | Meaning |
| --- | --- | --- |
| Six-field cron | `0 0 9 * * 1` | Seconds, minutes, hours, day of month, month, weekday, in Pi's local time zone. Every Monday at 09:00. |
| Interval | `5m`, `1h`, `2d` | Repeat every period. Units `s`, `m`, `h`, `d`. |
| Relative once | `+10m` | Once, ten minutes from now. |
| Absolute once | `2026-12-01T09:00:00+08:00` | Once at an ISO timestamp. Past times are rejected. |

Missed periods are skipped, never replayed. A schedule only fires while its session is open in a running Pi. A one-shot time that passed while the session was closed is disabled and reported. Periodic runs may overlap.

## Behaviour

Each firing starts a normal background subagent, recorded with its `scheduleId`. The run uses the explicit parameters saved at registration (`model`, `thinking`, `maxTurns`, `isolated`, `taskId`, `name`), and reads the current type configuration at firing time. Scheduled runs skip the queue but still count against the background pool.

Schedules belong to the main session and are stored in `<agentDir>/pi-suite/agents/schedules/<sessionId>.json`. `/resume` and `/reload` restore them; `/new` and `/fork` start without them.

## Managing schedules

`/subagents schedules` lists the session's schedules with their rule, next run, last status, run count and last agent. Enter opens the details, and **x Cancel schedule** removes a schedule after confirmation. Cancelling only prevents future firings; stop a run that already started with `agent_stop`.

Extensions can listen for `subagents:scheduler_ready` and `subagents:scheduled` events (`added`, `removed`, `fired`, `error`).
