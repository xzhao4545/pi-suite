---
name: pi-suite-workflow
description: Write, run, iterate and resume agent_workflow scripts that orchestrate many Pi suite subagents. Read before writing or editing a workflow script, only after the user has explicitly opted into multi-agent orchestration.
---

# Pi Suite Workflow

A workflow script encodes the structure of a multi-agent task: what fans out, what verifies, and what is combined at the end. Use it when one context cannot cover the work (broad audits, migrations, many files) or when independent checks should confirm a result before you rely on it.

Scout inline first when the work list is unknown (list files, scope the diff), then run a workflow over that list. For large tasks, run several small workflows in sequence and read each result before choosing the next.

## Running a script

- Pass the source inline with `script`. Each run saves its script and returns `scriptPath`; to iterate, edit that file and call again with `scriptPath`.
- A script reused across sessions belongs in `.pi/workflows/<name>.js`, `.agents/workflows/<name>.js` or `<agentDir>/workflows/<name>.js`; run it with `name`.
- `args` is passed to the script verbatim. Pass arrays and objects as JSON values, not as JSON-encoded strings.
- The call returns a `wf_` ID at once. Wait with `wait({ids: ["wf_…"]})` or for the notification, then `read` the returned `resultPath`.

## Script format

Scripts are plain JavaScript (no TypeScript syntax). The body runs in an async context, so use `await` directly, and its `return` value is the workflow result.

```js
export const meta = {
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose fixes',
  phases: [{ title: 'Scan' }, { title: 'Fix' }],
}
phase('Scan')
const flaky = await agent('List tests with retry markers in the CI logs', { schema: FLAKY_SCHEMA })
```

`meta` must be a pure literal: no variables, calls, spreads or template interpolation. `name` and `description` are required; `whenToUse` and `phases` (`{ title, detail?, model? }`) are optional. Phase titles must match `phase()` calls exactly.

## API

| Hook | Behavior |
| --- | --- |
| `agent(prompt, opts?)` | Start a subagent. Returns its final text, or the validated object when `opts.schema` is set. Returns `null` if the agent fails, is skipped by the user, or never produces valid structured output. |
| `pipeline(items, ...stages)` | Each item moves through all stages independently. Stages receive `(previous, item, index)`. A stage that throws turns that item into `null` and skips its later stages. |
| `parallel(thunks)` | Runs `() => Promise` thunks concurrently and waits for all of them. A failing thunk becomes `null`; cap breaches and nested-workflow load errors propagate. |
| `phase(title)` | Group the following `agent()` calls under a progress heading. |
| `log(message)` | Show a progress line to the user. |
| `args` | The `args` value of the tool call, or `undefined`. |
| `budget.spent()` | Output tokens used by this run's agents. `budget.total` is always `null`. |
| `workflow(nameOrRef, args?)` | Run a saved workflow (`name`) or `{scriptPath}` inline and return its result. One level of nesting only; it shares this run's limits and budget. |

`agent()` options (any other option is rejected):

| Option | Use |
| --- | --- |
| `label` | Display label; also the handle that `resume` refers to. |
| `phase` | Progress group for this call. Prefer it over `phase()` inside `pipeline`/`parallel` stages. |
| `schema` | JSON Schema. The child answers through a StructuredOutput tool; filter `null` after every schema stage. |
| `agentType` | A custom subagent type from the enabled type list in the tool description. |
| `model` | Model override. Usually omit it so the child inherits the session model. |
| `effort` | `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Omit to inherit; use `low` for mechanical stages. |
| `gate` | Shell command run in the workflow cwd after the agent finishes (default timeout 10 minutes). A non-zero exit fails the call and its output becomes the error. |
| `resume` | Continue the child that ran under this label, keeping its context. Cannot be combined with `agentType`, `model`, `effort`, `gate` or `schema`. |

Every `agent()` call must be awaited or returned; an unawaited launch fails the run.

## Restrictions and limits

- `Date.now()`, `Math.random()` and `new Date()` without arguments throw, because they would make resume diverge. Pass timestamps in `args`; vary prompts or labels by index instead of random values.
- `eval`, `Function(...)`, filesystem access and Node.js modules are not available to the script.
- The worker is a determinism boundary for cooperative scripts, not a security sandbox. Run only scripts you wrote or the user trusts; `gate` commands run as normal shell commands.
- At most `max(1, min(16, CPUs − 2))` agents run at once; further calls queue. A run may start at most 1000 agents, and one `pipeline`/`parallel` call accepts at most 4096 items.

## Choosing the structure

Use `pipeline` by default. It lets a fast item reach later stages while slow items are still in earlier ones.

Use a barrier (`parallel` between stages) only when a stage needs all results of the previous one: deduplicating across all findings, stopping early when nothing was found, or comparing findings with each other. Flattening, mapping or filtering does not need a barrier; do it inside a pipeline stage.

Review across dimensions, verifying each finding as soon as its review finishes:

```js
const results = await pipeline(DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  review => parallel((review?.findings ?? []).map(f => () =>
    agent(`Try to refute this finding: ${f.title}`, { phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v })))))
return results.flat().filter(f => f?.verdict?.real)
```

Verify by running instead of asking, and keep context across attempts:

```js
let fixed = await agent('Find and fix the failing test.', { label: 'fix', gate: 'npm test' })
if (fixed === null) {
  fixed = await agent('`npm test` still fails. Fix the cause.', { label: 'fix', resume: 'fix' })
  const verified = await agent('Run `npm test` and report. Change nothing.', { gate: 'npm test', effort: 'low' })
  return { passed: verified !== null, summary: fixed }
}
return { passed: true, summary: fixed }
```

Other useful shapes:

- **Independent votes**: ask several agents to refute a claim and keep it only if most fail to.
- **Different lenses**: give each verifier a distinct angle (correctness, security, reproduction) instead of identical prompts.
- **Loop until dry**: for discovery of unknown size, repeat finder rounds until K consecutive rounds find nothing new. Deduplicate against everything seen, not only against confirmed results.
- **Report coverage**: if the script caps coverage (top N, sampling, no retry), `log()` what was skipped.

Match the size to the request: a quick check needs a few agents; a thorough audit warrants more finders and several votes per finding.

## Resume

To continue after a stop, a failure or a script edit, call `agent_workflow({scriptPath, resumeFromRunId})`. The run must be finished and visible on the current session branch; stop a running one first.

- The longest unchanged, successful prefix of `agent()` calls is reused from the journal; the first changed or failed call and everything after it run again.
- A run that contains `agent({resume})` calls runs again in full, because cached text cannot restore a child session.
- When a finished workflow returns an unexpected result, read `journal.jsonl` next to its script. It records each agent's actual return value.
