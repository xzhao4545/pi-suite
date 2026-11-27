# Ask

[Documentation index](../index.md)

`ask_user` lets the model ask you one question or a batch of 2–4 questions in a panel that replaces the editor. Switch: `modules.ask`.

In the main session the tool needs Pi's interactive terminal (TUI); in print or RPC mode it fails. A subagent's `ask_user` question goes to its direct parent instead of to you; see [Agents](agents/index.md).

## Parameters

| Parameter | Meaning |
| --- | --- |
| `question` | The question for a single prompt, or the batch heading when `questions` is used. |
| `questions` | 2–4 entries, each with its own `question`, `options`, defaults and an optional `title` (1–60 characters) used as the tab label. |
| `options` | Strings, or objects `{ id?, title, description?, recommended? }`. IDs default to `option-1`, `option-2` and so on. |
| `allowMultiple` | Multiple choice. Default `false`. |
| `defaultAnswer` | Prefilled custom text. |
| `defaultOptionId` / `defaultOptionIds` | Preselected option for single choice, or options for multiple choice. |
| `allowComment` | Show an optional comment field. |
| `timeoutMs` | Idle timeout in milliseconds. Omit to use `ask.timeout` (default 10 minutes); `0` disables it. |

In a batch, `options`, defaults and `allowMultiple` belong inside each entry of `questions`.

Every question also accepts a typed answer: the list always ends with a custom entry marked ✎. In single choice, the custom answer replaces the selected option. In multiple choice, it is added to the checked options. `recommended` options are highlighted but never preselected. Mismatched defaults or unknown option IDs are rejected before the panel appears.

## Timeout

The timer measures idle time. It starts when the panel first appears, and any key press, paste, or handled click or scroll restarts it. Time spent in the queue behind another question does not count. The remaining time is shown as `idle mm:ss`.

When the timer expires, the panel submits automatically. It uses your current selection or prefilled answer if there is one. Otherwise it picks the first recommended option (all recommended options for multiple choice), or the first option. Unselected draft text is not used. A free-text question without options and without a draft stays unanswered. Every answer submitted this way, including your current selection, is marked `autoSelected: true`.

## Result states

| Status | What happened | Effect |
| --- | --- | --- |
| `answered` | You submitted. | The model and goal continue. |
| `skipped` | Esc on the question list, or the Skip action. Existing selections and drafts are returned; unanswered questions stay unanswered. | The model continues. This is not consent. |
| `timed_out` | The idle timer expired and the panel submitted as described in [Timeout](#timeout). | The model continues with those answers. This is not consent. |
| `cancelled` | The request was aborted, the session changed, or Pi reloaded. | The turn ends. An active goal pauses until your next message or `/goal resume`. |

The tool result text starts with the status and lists each question with its chosen answer. `skipped` and `timed_out` results say `not consent`, so a skipped or timed-out answer cannot authorize a destructive action.

## Keys

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move between options. |
| Space | Select or toggle the option. |
| Enter | Single choice: select and confirm. Multiple choice: confirm the checked set. On the custom entry: start or finish typing. |
| `f` | Type a custom answer. |
| `/` | Search the options. |
| ← / → | Switch between questions in a batch; the last tab is Review. |
| Tab | Move to the action bar. |
| `e` | Expand or collapse long questions and options. |
| `d` | Show the full question and option text. |
| Ctrl+H (`ask.historyKey`) | Show the conversation history above the question. Your draft is kept. |
| Esc | Go back one level; on the question list, skip the whole prompt. |

A batch is submitted from the Review page once every question has an answer. After a skip, focus returns to Pi's editor and the model keeps running; pressing Esc again is Pi's normal interrupt.

The panel height is capped at 70% of the terminal and shrinks to a compact form on small terminals. Mouse clicks select tabs and options, and the wheel moves the selection.

## Questions from subagents

When a subagent calls `ask_user`, the question goes to its direct parent instead of the user; see [Agents](agents/index.md#parent-questions).
