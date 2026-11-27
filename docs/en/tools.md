# Model tools

[Documentation index](index.md)

The suite registers these tools for the model. Parameters are described on the linked pages. A tool is only registered when its module is enabled.

| Tool | Module | Purpose |
| --- | --- | --- |
| [`ask_user`](modules/ask.md#parameters) | ask | Ask the user one question or a batch of 2–4. |
| [`goal_complete`](modules/goal.md#model-tools) | goal | Complete the current goal with audited evidence. |
| [`goal_blocked`](modules/goal.md#model-tools) | goal | Pause the goal for a repeated external blocker. |
| [`goal_wait`](modules/goal.md#model-tools) | goal | Pause the goal's turn until listed jobs, agents or workflows settle. |
| [`task_list`](modules/tasks.md#tools) | tasks | List tasks and get the current generation. |
| [`task_get`](modules/tasks.md#tools) | tasks | Read one group or child task. |
| [`task_edit`](modules/tasks.md#tools) | tasks | Add, update, delete, start, finish, block or clear tasks, singly or in an atomic batch. |
| [`job_start`](modules/jobs/index.md#tools) | jobs | Start a pipe or PTY job, a CLI preset, a monitor or a supervised terminal. |
| [`job_list`](modules/jobs/index.md#tools) | jobs | List jobs by state and scope. |
| [`job_get`](modules/jobs/index.md#tools) | jobs | Get one job's status and details. |
| [`job_read`](modules/jobs/index.md#tools) | jobs | Read a job's output, input or events. |
| [`job_write`](modules/jobs/index.md#tools) | jobs | Send text, keys or a paste to a running job. |
| [`job_stop`](modules/jobs/index.md#tools) | jobs | Stop a job and report cleanup evidence. |
| [`agent_start`](modules/agents/index.md#tools) | agents | Start or schedule a subagent. |
| [`agent_list`](modules/agents/index.md#tools) | agents | List subagent runs. |
| [`agent_get`](modules/agents/index.md#tools) | agents | Get one run's status, model and pending question. |
| [`agent_read`](modules/agents/index.md#tools) | agents | Read a run's transcript or result. |
| [`agent_send`](modules/agents/index.md#tools) | agents | Steer, answer or resume a subagent. |
| [`agent_stop`](modules/agents/index.md#tools) | agents | Stop a run, its children and their jobs. |
| [`agent_workflow`](modules/agents/workflows.md#agent_workflow) | agents | Run an orchestration script in the background. |
| [`wait`](concepts.md#the-wait-tool) | shared | Wait for `job_`, `agent_` or `wf_` IDs. |

## Conventions

- Lists return at most 10 items by default and page with `cursor`. Each page also stays within about 4 KiB.
- IDs are always the exact strings returned by earlier calls. Subagents are shown by name in the UI, but tools use `agent_` and `run_` IDs.
- Results begin with a one-line summary and add a concrete next step when output was truncated or an action is needed.

## Error codes

Errors start with a code, followed by the reason and a suggested next step. The table lists the common codes; module pages describe codes specific to them.

| Code | Meaning |
| --- | --- |
| `INVALID_ARGS` | A parameter is missing, malformed or conflicts with another. |
| `NOT_FOUND` | No object with this ID. |
| `HISTORY_READ_ONLY` | The object only exists in saved history and cannot be controlled. |
| `NOT_RUNNING` | The operation needs a running object. |
| `USER_CONTROL` | The user has taken over this PTY. |
| `STALE_BINDING` | The session, goal revision or turn that the call belongs to is no longer current. |
| `CLOSING` | Pi is shutting down. |
| `UNSUPPORTED_STREAM` | The stream does not exist for this job mode. |
| `RUNTIME_UNAVAILABLE` | The job runtime in this process cannot perform the operation. |
| `REGEX_RESOURCE_LIMIT` | The search regex exhausted the engine; use offset paging instead. |
| `TASK_STALE` | The task generation is outdated; list tasks again. |
| `TASK_GENERATION_REQUIRED` | A task reference has no source generation; take it from `task_list`. |
| `TASK_SCOPE` | An assigned-scope task call went beyond the assigned task. |
| `MODEL_UNAVAILABLE` | A configured model has no credentials, or its name matches more than one model. |
| `MODEL_RUNTIME_UNAVAILABLE` | The parent model runtime cannot be shared with a subagent. |
| `START_NOT_COMMITTED` | A job start was refused because its creator is being stopped. |
| `WORKSPACE_CAPACITY` | The workspace already holds 1 GiB of job history; delete old jobs first. |
| `JOB_OCCUPIED` | The job is still active or its cleanup is not confirmed, so it cannot be deleted. |
| `NOT_OWNER` | The target belongs to another session or branch. |
| `ALREADY_RUNNING` | The subagent is still running or stopping. |
| `AGENT_DEPTH` | `agents.maxDepth` would be exceeded. |
| `INVALID_ANSWER` | The answer does not fit the question, for example several choices for a single-choice question. |
