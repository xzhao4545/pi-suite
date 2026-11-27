# Tasks

[Documentation index](../index.md)

The tasks module gives the model a two-level task list: groups, and child tasks inside each group. It helps the model plan multi-step work and shows you its progress in the Dock. Switch: `modules.tasks`.

## Structure

- Groups have IDs `1`, `2`, …; child tasks have IDs like `1.2`. There are only two levels. Deleted IDs are not reused within the same list generation.
- A child task is `todo`, `doing`, `blocked` or `done`. Several tasks can be `doing` at once. A blocked task can carry a `blockedReason`.
- `blockedBy` lists dependencies. A task with an unfinished dependency is shown as blocked.
- A group's state and progress are derived from its children: done when all children are done, doing when any child is doing, blocked when all unfinished children are blocked. A group's state cannot be set directly.
- Task state is separate from the state of jobs and agents. Finishing a job does not mark its task done.

## Generations

Every list has a `generation` token. `task_list({})` returns the current one, and `task_get`, `task_edit`, and paging by group or cursor must quote it.

When every task in a non-empty list is done, the list is cleared automatically. The model can also clear it with `task_edit({ generation, op: "clear" })`. Clearing resets numbering to `1` and issues a new generation. A call that quotes an old generation fails with `TASK_STALE`, so a stale reference can never point at a new task that reused the same ID. Clearing does not stop jobs or agents and does not complete the goal.

## Tools

| Tool | Parameters |
| --- | --- |
| `task_list` | `generation?`, `groupId?`, `state?` (`unfinished` default, `doing`, `blocked`, `done`, `all`), `cursor?`, `limit?` (default 10). Group counts always include all children. |
| `task_get` | `generation`, `id`. Returns one group or child with description, dependencies and execution references. |
| `task_edit` | `generation` and one operation, or `op: "batch"` with 1–100 `changes`. A batch commits atomically: if any change is invalid, nothing is applied. |

Operations:

| `op` | Fields |
| --- | --- |
| `add` (group) | No `parentId`. `title`, `description?`, `blockedBy?`, and up to 100 `children` titles. A group has no `status` of its own. |
| `add` (child) | `parentId`, `title`, `description?`, `status?`, `blockedBy?`. A child cannot take `children`. |
| `update` | `id` and any of `title`, `description`, `status`, `blockedBy`, `blockedReason`. Only children have a status. To move a task, delete it and add it to the other group. |
| `delete` | `id`; a non-empty group needs `cascade: true`. |
| `start` / `done` / `unblock` | `id` of a child task. |
| `block` | `id` and optional `reason` (up to 500 characters). |
| `clear` | Top level only, not inside a batch. |

Titles are 1–200 characters and descriptions up to 8000. The result lists the actual changes, derived state changes of dependent tasks, group progress and warnings (for example a dependency cycle).

## Linking work to tasks

`job_start` and `agent_start` accept `taskId` (such as `1.2`) together with `taskGeneration`. The job or agent ID is recorded on the task. The link does not change the task's state.

A subagent has its own private task list, which is not shown in your Dock. If it was started with a `taskId`, it can read and update that one parent task with `scope: "assigned"`:

```json
{ "generation": "<assigned generation>", "scope": "assigned", "op": "done", "id": "1.2" }
```

Assigned scope only allows `task_get` and the `start`, `done`, `block` and `unblock` operations on that task. Anything else returns `TASK_SCOPE`. Without `scope`, IDs always refer to the subagent's private list.

## Tasks browser

`/tasks [group ID]` opens the browser, titled `Tasks ▸ List`. It shows all tasks by default.

| Key | Action |
| --- | --- |
| `g` | Cycle the group filter. |
| `s` | Cycle the state filter: All, Unfinished, Running, Blocked, Completed. |
| `/` | Filter by ID, title, description, blocked reason or state. |
| Tab | Move between the list and the details. |
| Enter | Return to the conversation with the task's group selected in the Dock. |
| Esc | Leave search or details, clear the filter, then close. |

The browser is read-only; tasks are changed only through the model's tools. Without a TUI, `/tasks` prints the list as text.

## Dock display

The Tasks section title shows done/total for all child tasks. Each group is shown as a tree with its own count, using ☐ todo (accent color), ⟳ doing (green), ⚠ blocked (yellow, with `(Blocked)`), and ☑ done (dim, struck through). When space is short, the current group and its doing and blocked tasks are kept, and the rest is collapsed. Completed groups fold into a `☑ N completed groups` line. When the whole list finishes, the section shows the result for 5 seconds and then disappears.

## Reminders

With `tasks.reminders` on (default), if the model has not used a task tool for 4 turns (2 turns while a task is `doing`), a reminder listing up to 10 unfinished tasks and the current generation is attached to the model's next request. The reminder does not trigger a request on its own and does not change any task.

## Storage and sessions

Saved sessions keep their list in `<cwd>/.pi/tasks/tasks-<sessionId>.json`; unsaved sessions keep it in memory. Forking a saved session copies its list into an independent file. Forking an in-memory session starts an empty list and shows a warning.
