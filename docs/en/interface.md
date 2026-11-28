# Interface

[Documentation index](index.md)

## The Dock

The Dock is the suite's only persistent widget. It sits above the editor and shows up to five sections in a fixed order: Goal, Tasks, Agents, Jobs and Workflows. Empty sections are hidden.

- **Tasks** shows task groups in ID order with their done/total count: ☐ todo, ⟳ doing, ⚠ blocked, ☑ done. Only the focus group is expanded: the group you selected in the Dock, otherwise the one with work in progress, then a blocked one, then the most recently updated. It shows the most recently completed child and up to 5 unfinished children; the rest are counted as `… N more items`. Up to 4 other unfinished groups show their title only, the rest as `… N more groups`. Finished groups are counted in the last line.
- **Agents** shows one row per subagent: its name with the model in parentheses, state, run time, input and output tokens, and tool count. Times are shown as `45s`, `12m05s`, `3h07m` or `2d04h`; token counts as `999`, `1.2k`, `3.4M` or `1B`, rounded down. A subagent waiting for an answer shows `waiting(parent)`; one waiting to recover automatically from a network error shows `queued · retry N/M`. Several runs of the same subagent share its row, which follows the latest run.
- **Jobs** shows active jobs by name and state.
- **Workflows** shows active workflow runs.

When rows do not fit, the Dock collapses them and shows markers such as `↓ … 3 more items`. The idle height is limited to half the terminal minus the editor and footer, and to `ui.maxRows` (default 12). Below 18 terminal rows, each section shrinks to a one-line summary. While `ask_user` is shown, the Dock is hidden.

### Keyboard selection

With an empty editor, press **←** to enter the Dock.

| Key | Action |
| --- | --- |
| ↑ / ↓ | Select a task, agent, workflow or job row. Selecting a task group or one of its children expands that group. |
| `[` / `]` | Switch to the previous or next section. |
| Enter | Open the selection: task details (read-only), the agent transcript, the workflow run, or the job's command and output. |
| Esc or → | Return to the editor. |

Any other key leaves the Dock and goes to the editor. ← is not intercepted when the editor has text, a completion menu is open, or another view has focus.

## Commands

| Command | Opens |
| --- | --- |
| `/goal …` | Goal control and details; see [Goal](modules/goal.md). |
| `/tasks [group ID]` | The task browser; see [Tasks](modules/tasks.md#tasks-browser). |
| `/jobs [finished\|all] [workspace]` | The job browser; see [Jobs](modules/jobs/index.md#jobs-browser). |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | The subagent browser; see [Agents](modules/agents/index.md#subagents-browser). |
| `/suite` | Settings; see [Configuration](configuration.md#editing-with-suite). |
| `/exit` | Quit Pi with cleanup; see [Configuration](configuration.md#shutdown-with-exit). |

## Browsers and reading views

`/tasks`, `/jobs` and `/subagents` share one browser layout: a list, a detail pane (beside the list on wide terminals, below it on narrow ones), a status line, and fixed navigation and action rows at the bottom.

| Key | Action |
| --- | --- |
| ↑ / ↓, PageUp / PageDown | Move in the list, or scroll the detail pane when it has focus. |
| `/` | Start filtering the list. Typing without `/` does not filter. |
| Tab | Move focus between the list and the details. |
| Enter | Open the selected item. |
| Esc | Leave search or details, clear the filter, then close. |
| ← ← (within 300 ms) | In `/jobs` and `/subagents`, close the whole browser chain. |

Detail and log views use the same reading keys:

| Key | Action |
| --- | --- |
| ↑ / ↓, PageUp / PageDown, Home / End | Scroll. Scrolling up stops following new output; End resumes it. |
| `/`, Enter, `n` / `N` | Search, then jump to the next or previous match. |
| Esc | Leave search, or close the view. Closing a view never stops the job or agent. |

Detail panes color their content: object names as headings, labels muted, IDs in the accent color, states in their state colors, sources, paths and times dimmed, and errors in the error color.

These overlays are keyboard-driven. Clicking or scrolling with the mouse inside nested tool blocks, and dragging a scrollbar, are not supported in them. In the main conversation, Pi's own mouse expansion and `Ctrl+O` (expand all tools) keep working.

## Tool display

Every suite tool renders as one collapsed line in the conversation, for example `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`. Expanding the tool (mouse click or Pi's `Ctrl+O`) shows that tool's details as labeled fields; `agent_read` and `job_read` also show the page of output they read, as literal text. Input sent with `sensitive` stays hidden when expanded. A failed tool shows the first line of its error when collapsed and the full error when expanded. `wait` shows how long it has been waiting at the end of its line.

In expanded task results, `task_get` shows task details and `task_edit` shows changed fields. Expanded agent results show schedule fields, each pending question with its options, and each run affected by a stop, where applicable.

Suite notifications (agent results and questions, job results, updates and monitor events, workflow results, schedule failures) show one line per event when collapsed and the event's text when expanded. Screens sent from a job terminal show as a `Job screen` line that expands to the screen's rows. Subagents are labeled by name; their IDs appear only in expanded or dimmed text.

State icons: ⟳ running, ⧗ queued, ? waiting, ✔ completed, ✘ failed, ⊘ stopped, ⏱ timed out or limited.

## Footer status

The suite publishes two status entries through Pi's extension status API:

- `goal`: the goal state and active time, for example `🎯 goal 03:27`. See [Goal](modules/goal.md#status-display).
- `pi-suite:runtime`: active subagents and jobs as `🤖N · ⚙M`. Zero counts are hidden.

`goal.display`, `agents.display` and `jobs.display` move these summaries into the Dock (`dock`) or hide them (`hidden`).

Pi's built-in footer shows both entries. With `@narumitw/pi-starship` 0.65.2, they appear through its `extension_status` module. If your Starship `format` has no `$extension_status`, or `max_statuses` drops them, they are not visible; switch `goal.display` to `dock` in that case. This setting keeps the goal state icon and hides the default plug icon on the runtime entry:

```toml
[extension_status]
icons = { "pi-suite:runtime" = "", fallback = "" }
```

## Theme

The package ships a dark theme named `oh-my-pi`, based on the Titanium palette from Oh My Pi. After installing the package, run `/reload` and choose it in `/settings` → **Theme**. For a single run from a checkout:

```sh
pnpm exec pi -e . --use-theme oh-my-pi
```

To use the theme without the suite, copy `themes/oh-my-pi.json` to `~/.pi/agent/themes/oh-my-pi.json` and choose it in `/settings`. Keep only one copy of a theme with this name loaded, either the package or the copied file.

`pi -e ./src/index.ts` loads only the extension, not the theme. The theme only sets Pi's color roles. For a fully matching look, set the terminal background to `#151820` and foreground to `#e8ecf4`.

## Command highlighting

Commands shown by the suite are highlighted by structure: program, options, variables, strings, operators and redirections each use a Pi `syntax*` theme role. Bash and PowerShell are supported. The highlighter only scans the text; it never runs the command or looks up programs or paths.

| Where | Highlighting |
| --- | --- |
| Model calls to Pi's built-in `bash` / `powershell` tools | On by default; controlled by `ui.highlightBuiltinCommands`. |
| Job commands in `/jobs`, the Dock viewer and expanded suite tools | Always on. |
| Your own `!` / `!!` shell commands | Pi's original display. |
| Logs and other output | Plain text. |

## Copying in tmux

Pi copies text through OSC 52. When Pi runs inside tmux and the tmux client reports clipboard support, the suite sets the tmux server's `set-clipboard` option to `on` so tmux forwards these requests to your local terminal. To keep this after tmux restarts, add `set -s set-clipboard on` to `~/.tmux.conf`. Pi's `Copied!` message only means the request was sent; paste somewhere to confirm.
