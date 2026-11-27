# 跨扩展 RPC

[Agents](index.md) · [文档索引](../../index.md)

同一 Pi 进程中的其他扩展可以通过 `pi.events` 启动和控制子代理。通道与协议版本 2 遵循 `@tintinweb/pi-subagents` 0.23.0。Pi Suite 实现下文列出的子集，并拒绝未知或内部选项，因此为该包编写的调用方只有在这一子集内才能使用。

## 就绪与回复

服务在首次绑定的 `session_start` 时注册，并发出载荷为 `{}` 的 `subagents:ready`。`session_shutdown` 时注销，下次绑定时重新注册。

每个请求携带唯一且非空的 `requestId`。回复在 `<channel>:reply:<requestId>` 上发出，格式为 `{ success: true, data? }` 或 `{ success: false, error }`。

| 通道 | 除 `requestId` 外的请求字段 | 回复 `data` |
| --- | --- | --- |
| `subagents:rpc:ping` | 无 | `{ version: 2 }` |
| `subagents:rpc:spawn` | `type`、`prompt`、`options?` | `{ id }` |
| `subagents:rpc:stop` | `agentId` | 无 |
| `subagents:rpc:consume` | `agentId` | 无；agent 不存在或仍在运行时返回错误 |
| `subagents:rpc:steer` | `agentId`、`message` | 无 |

```ts
const requestId = crypto.randomUUID();
pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, reply => {
  if (!reply.success) throw new Error(reply.error);
  console.log("started", reply.data.id);
});
pi.events.emit("subagents:rpc:spawn", { requestId, type: "Explore", prompt: "Map the auth module" });
```

## spawn 选项

| 选项 | 含义 |
| --- | --- |
| `description`、`name` | 任务描述和实例名。`name` 同时作为提及别名。 |
| `model` | 模型字符串或 `{ provider, id }` 对象；`null` 表示不覆盖。 |
| `thinkingLevel`、`maxTurns` | thinking 等级和轮数上限。 |
| `isolated`、`inheritContext` | 与 `agent_start` 的同名参数相同；类型 frontmatter 优先。 |
| `isBackground` | 默认 `false`。`true` 使用后台池和队列。 |
| `bypassQueue` | 池已满时也立即启动，但仍计入池。 |
| `cwd` | 已存在的绝对目录，供文件工具和命令使用；`null` 使用父级目录。类型、设置和扩展仍从父级项目加载，目标目录不被信任。 |
| `signal` | 取消排队中或运行中子代理的 `AbortSignal`。 |
| `structuredOutput` | `{ schema, check(value) }`。子代理必须返回经过校验的 JSON，保存为 `structuredJson`。 |
| `onSpawned`、`onQueued`、`onCompaction` | 同进程回调。 |

未知选项和内部选项会被拒绝，包括 `parentAgentId`、`workflowId`、`depth`、`isolation` 以及 worktree 相关选项。

spawn 出的运行始终与调用方分离：结果通过本套件的普通通知送达。想自己处理结果时，监听生命周期事件并调用 `consume`。

## 归属与 consume

`stop`、`steer` 和 `consume` 只接受当前绑定会话、当前分支的顶级 agent。`steer` 也可以回答待处理的父级问题，但不能恢复已结束的 agent。`consume` 把已结算的运行标记为已处理，并撤销其待投递的通知。在 `subagents:completed` 或 `subagents:failed` 监听器中同步调用它，可以保证该通知不会入队。

## 事件

| 事件 | 时机 |
| --- | --- |
| `subagents:created` | 运行被接纳。 |
| `subagents:started` | SDK 会话就绪。 |
| `subagents:completed` / `subagents:failed` | 运行结算。载荷：`id`、`runId`、`type`、`description`、`result` 或 `error`、`status`、`toolUses`、`durationMs`、`tokens`。failed 包括错误、停止和轮数限制。 |
| `subagents:steered`、`subagents:compacted` | 消息已送达，或子代理完成了压缩。 |
| `subagents:usage` | 每条助手消息一次，包括嵌套子代理：Pi 用量、模型、thinking、层级，以及 `parentAgentId` 或 `workflowId`。 |
| `subagents:disposed` | 绑定关闭且清理完成。 |
