# Workflows

[Agents](index.md) · [Documentation index](../../index.md)

A workflow is a JavaScript script that orchestrates many subagents: fan out over a work list, run stages in a pipeline, verify results, and return a combined answer. Switch: `agents.workflows` (default `true`).

The model should only start a workflow when you ask for multi-agent orchestration, a skill tells it to, or you name a saved workflow. The full authoring guide is the [`pi-suite-workflow` skill](../../../../skills/pi-suite-workflow/SKILL.md), which the model reads before writing a script.

## `agent_workflow`

| Parameter | Meaning |
| --- | --- |
| `script` | Inline script source. |
| `scriptPath` | Path to a script file, relative to the working directory. |
| `name` | A saved workflow (see below). |
| `args` | Any JSON value, passed to the script as `args`. |
| `resumeFromRunId` | A finished `wf_` run of this session that is visible on the current branch. Its unchanged, successful `agent()` calls are reused. |

Give exactly one of `script`, `scriptPath` or `name`. The tool always starts in the background and returns a `wf_` ID and a `resultPath`. Use `wait` with the `wf_` ID, or wait for the notification, then read `resultPath` for the full output.

## Script shape

```js
export const meta = {
  name: 'review-diff',
  description: 'Review a diff from several angles and verify each finding',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const angles = ['correctness', 'security', 'tests']
const findings = await pipeline(angles,
  angle => agent(`Review the current diff for ${angle} issues`, { phase: 'Find', label: angle }),
  (report, angle) => agent(`Check whether these ${angle} findings are real:\n${report}`, { phase: 'Verify' }),
)
return findings.filter(Boolean).join('\n\n')
```

- `meta` must be a pure literal with `name` and `description`; `whenToUse` and `phases` are optional.
- `agent(prompt, opts?)` starts a subagent and returns its final text, or a validated object when `opts.schema` is given. It returns `null` if the agent fails or is skipped. Options: `label`, `phase`, `schema`, `model`, `effort`, `agentType`, `gate` (a shell command that must pass after the agent, default timeout 10 minutes), `resume` (continue the child with that label).
- `pipeline(items, ...stages)` moves each item through the stages independently; `parallel(thunks)` waits for all thunks.
- `phase(title)`, `log(message)`, `args`, `budget.spent()`, and `workflow(nameOrRef, args?)` for one level of nesting.
- Scripts are plain JavaScript in a separate worker without filesystem or Node.js APIs. The worker keeps scripts deterministic and catches mistakes; it is not a security sandbox, and `gate` runs shell commands. Only run scripts you trust. `Date.now()`, `Math.random()` and argument-less `new Date()` throw, because they would break resume; pass times in `args`.

Limits: script size 512 KiB, 1000 agents per run, 4096 entries per `parallel`/`pipeline`, 256 nested calls. Concurrency is `max(1, min(16, CPUs − 2))`. Workflow children do not use the normal subagent pool.

## Saved workflows

A `.js` file with `export const meta` can be run by `name`. Lookup order:

1. `<project>/.pi/workflows/`
2. `<project>/.agents/workflows/`
3. `<agentDir>/workflows/`
4. Workflows declared by installed Pi packages (`agents.packageWorkflows`).

Project directories require a trusted project. Names use letters, digits, `.`, `-` and `_`, start with a letter or digit, and have at most 128 characters.

Each run is saved in `<agentDir>/pi-suite/agents/workflows/<sessionId>/<wfId>/` as `script.js`, `journal.jsonl`, `run.json` and `result.txt`.

## Resume and replay

The journal records every `agent()` call. Resuming reuses the leading calls whose prompt and options are unchanged and that succeeded; everything after the first change or failure runs again. A journal that contains `agent({resume})` calls is run again in full.

## Workflows page

`/subagents workflows` lists the session's workflow runs and saved workflows; `s` switches between them.

| Key | Action |
| --- | --- |
| Enter | Open run details, or a saved workflow's source. |
| `p` | Pause or resume new agent starts. Agents already running continue. |
| `x` twice | Stop the workflow, its children and their jobs. |
| `r` | Replay a finished run with the same script and args, reusing the unchanged prefix. |
| `n` | Start a saved workflow with JSON args. |

Run details list phases, agents, models, attempts, usage, logs and the result. From **Children / gates** you can open a child transcript, read gate stdout and stderr, **Skip** a call (the script receives `null`), or **Retry** a running call.

A workflow child's `ask_user` question reaches the main session and can be answered with `agent_send`. Steering and resuming workflow children is left to the workflow.

## Conflicts

If another extension already provides a workflow tool (`agent_workflow`, `SubagentWorkflow`, `Workflow` or `workflow`), the suite turns its workflows off for the session and reports the conflict. Setting `"agents": { "workflows": true }` explicitly keeps both when the other tool has a different name. If the other tool is also named `agent_workflow`, Pi keeps whichever registered first, so disable one of the two extensions.
