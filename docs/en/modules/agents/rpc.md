# Cross-extension RPC

[Agents](index.md) · [Documentation index](../../index.md)

Other extensions in the same Pi process can start and control subagents through `pi.events`. The channels and protocol version 2 follow `@tintinweb/pi-subagents` 0.23.0. Pi Suite implements the subset listed below and rejects unknown or internal options, so a consumer written for that package works only if it stays within this subset.

## Readiness and replies

The service registers on the first bound `session_start` and emits `subagents:ready` with payload `{}`. It is unregistered on `session_shutdown` and registered again on the next binding.

Each request carries a unique, non-empty `requestId`. The reply is emitted on `<channel>:reply:<requestId>` as `{ success: true, data? }` or `{ success: false, error }`.

| Channel | Request fields besides `requestId` | Reply `data` |
| --- | --- | --- |
| `subagents:rpc:ping` | none | `{ version: 2 }` |
| `subagents:rpc:spawn` | `type`, `prompt`, `options?` | `{ id }` |
| `subagents:rpc:stop` | `agentId` | none |
| `subagents:rpc:consume` | `agentId` | none; an error if the agent is unknown or still running |
| `subagents:rpc:steer` | `agentId`, `message` | none |

```ts
const requestId = crypto.randomUUID();
pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, reply => {
  if (!reply.success) throw new Error(reply.error);
  console.log("started", reply.data.id);
});
pi.events.emit("subagents:rpc:spawn", { requestId, type: "Explore", prompt: "Map the auth module" });
```

## Spawn options

| Option | Meaning |
| --- | --- |
| `description`, `name` | Task description and instance name. `name` also becomes a mention alias. |
| `model` | Model string or `{ provider, id }` object; `null` for no override. |
| `thinkingLevel`, `maxTurns` | Thinking level and turn limit. |
| `isolated`, `inheritContext` | Same as the `agent_start` parameters; type frontmatter wins. |
| `isBackground` | Default `false`. `true` uses the background pool and queue. |
| `bypassQueue` | Start even when the pool is full. The run still counts toward the pool. |
| `cwd` | An existing absolute directory for file tools and commands; `null` for the parent directory. Types, settings and extensions still come from the parent project, and the target directory is not trusted. |
| `signal` | An `AbortSignal` that cancels the queued or running child. |
| `structuredOutput` | `{ schema, check(value) }`. The child must return validated JSON, stored as `structuredJson`. |
| `onSpawned`, `onQueued`, `onCompaction` | Same-process callbacks. |

Unknown or internal options are rejected, including `parentAgentId`, `workflowId`, `depth`, `isolation` and worktree options.

A spawned run is always detached from the caller: its result goes through the suite's normal notifications. To handle the result yourself, listen for the lifecycle events and call `consume`.

## Ownership and consume

`stop`, `steer` and `consume` accept only top-level agents of the currently bound session and branch. `steer` can also answer a pending parent question, but cannot resume a finished agent. `consume` marks a settled run as handled and withdraws its pending notification. Calling it synchronously inside the `subagents:completed` or `subagents:failed` listener guarantees that the notification is never queued.

## Events

| Event | When |
| --- | --- |
| `subagents:created` | The run is admitted. |
| `subagents:started` | The SDK session is ready. |
| `subagents:completed` / `subagents:failed` | The run settled. Payload: `id`, `runId`, `type`, `description`, `result` or `error`, `status`, `toolUses`, `durationMs`, `tokens`. Failed covers errors, stops and turn limits. |
| `subagents:steered`, `subagents:compacted` | A message was delivered, or the child compacted. |
| `subagents:usage` | Once per assistant message, including nested children: Pi usage, model, thinking, depth, and `parentAgentId` or `workflowId`. |
| `subagents:disposed` | The binding closed and cleanup finished. |
