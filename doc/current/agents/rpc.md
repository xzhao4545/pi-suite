# 跨扩展 RPC

其他扩展通过同进程 `pi.events` 调用 agents。通道名、参数名和协议版本 2 兼容 @tintinweb/pi-subagents 0.23.0 的一个子集；执行、归属和通知使用本包的 `AgentManager`（child 执行管理器，见 [执行与记录](runtime.md)）与统一通知。

## 注册与回复

首次绑定会话（session_start）时注册监听并发出 `subagents:ready`，载荷为 `{}`。此时所有扩展工厂已执行。没有绑定会话时不注册。树导航沿用监听，查询改用当前会话和分支。session_shutdown 撤销监听，下次绑定时重新注册。

请求必须带非空 `requestId`。调用方为每个请求使用不同的值，以区分 `<channel>:reply:<requestId>` 上的回复。成功为 `{ success: true, data? }`，无返回值时省略 data；失败为 `{ success: false, error }`。

| 通道 | 参数（除 requestId） | 成功回复 data |
| --- | --- | --- |
| subagents:rpc:ping | 无 | `{ version: 2 }` |
| subagents:rpc:spawn | type、prompt、options? | `{ id }` |
| subagents:rpc:stop | agentId | 省略 |
| subagents:rpc:consume | agentId | 省略 |
| subagents:rpc:steer | agentId、message | 省略 |

| 错误（摘要） | 原因 |
| --- | --- |
| `Invalid requestId` | requestId 缺失、为空或不是字符串 |
| `No active session` | spawn 时没有绑定会话 |
| `Invalid agent type`、`Invalid agent prompt` | spawn 的 type 或 prompt 缺失、为空或不是字符串 |
| `Invalid spawn options`、`SpawnOptions` 字段错误 | 选项不合法，见 [启动选项](#启动选项) |
| `Agent not found` | 当前会话和分支没有该 agent |
| `Agent is owned by another agent or workflow` | 目标是嵌套 child 或 workflow child |
| `Agent is not running` | stop 或 steer 的目标未在执行 |
| `Agent has not settled` | consume 的目标尚未结算 |
| `Invalid steer message` | steer 的 message 不是非空字符串 |

启动和执行层的错误原文透传，例如模型解析失败或启动失败。

## spawn

1. 校验 type、prompt 和选项。
2. 创建 run 并发出 `subagents:created`。
3. run 排队时立即回复 `{ id }`；离开队列开始启动时，等待会话建立后回复，启动失败回复错误。

spawn 的 run 始终与调用方分离：结算后经统一通知投递结果（见 [结果通知](progress.md#结果通知)），调用方用生命周期事件和 consume 处理结果。并发池规则见 [队列与并发](runtime.md#队列与并发)。

## 启动选项

选项沿用上游名称，与 `agent_start` 的参数名不同。只接受下表的选项。归属、会话和执行控制字段（如 `parentAgentId`、`workflowId`、`depth`、`configCwd`、`rootSessionId`、`resumeSessionFile`、`reclaim`、`blocking`），以及 `isolation`、`worktree`、`invocation`、活动追踪回调和 `onBeforeWorktreeCleanup` 均被拒绝。

| 选项 | 行为 |
| --- | --- |
| description、name | 任务描述；实例名，参与 @handle/alias 分配 |
| model | 模型字符串，或 `{ provider, id }`；null 表示不覆盖。按父级已认证的模型解析，带 provider 时只匹配该 provider |
| thinkingLevel | thinking 级别，SDK 按实际模型能力处理 |
| maxTurns | 非负整数，0 表示不限 |
| isolated、inheritContext | 隔离与继承父级上下文；类型 frontmatter 优先 |
| isBackground | 默认 false；类型的 run_in_background 优先 |
| bypassQueue | 池满时也立即启动，仍计入池的数量 |
| cwd | 已存在目录的绝对路径；null 表示父级目录 |
| signal | `AbortSignal`；触发时停止排队或执行中的 run，结算后移除监听 |
| structuredOutput | `{ schema, check(value) }`，schema 的 type 必须为 object，check 返回 true 或错误文本 |
| onSpawned(id)、onQueued(id, ahead)、onCompaction(info) | 同进程回调；ahead 为同池前方数量，info 为 reason、tokensBefore、compactionCount。onSpawned 或 onQueued 抛错时停止该 run 并回复错误 |

指定 cwd 时，文件工具和命令在目标目录执行；类型、设置、扩展、技能、memory 和本包配置从父级项目加载。目标目录与配置目录不同时，child 会话的 `isProjectTrusted()` 为 false，目标目录的 `.pi` 扩展和 MCP 配置不沿用父级信任。嵌套启动沿用同一配置目录和信任。

## stop、steer、consume

三者只接受当前会话、当前分支的顶级 agent ID，取该 agent 最新的 run。

| 通道 | 行为 |
| --- | --- |
| stop | 级联停止并等待 job 清理后回复 |
| steer | 有待答问题时作为回答；执行中引导或排队。不恢复已结束的会话 |
| consume | 标记已结算的 run 已读，撤销它未投递的结果通知；不读取结果，不启动模型。成功只返回 `{ success: true }`，没有 data；agent 未知或 run 尚未结算时返回错误。 |

结算时先同步发出 completed/failed 事件，再登记通知。在事件监听器的同步部分调用 consume，通知不会入队；稍后调用只能撤销尚未送入宿主请求队列的通知。

## 生命周期事件

顶级 run 发出以下事件；只报告当前会话、当前分支可见的 run。

| 事件 | 时机 |
| --- | --- |
| subagents:created | run 创建 |
| subagents:started | 会话就绪、开始执行 |
| subagents:completed | 结算为 completed |
| subagents:failed | 结算为 failed、stopped 或 limited；排队中被停止 |
| subagents:steered | steer 或 send 引导、排队消息（附 message） |
| subagents:compacted | 压缩完成（附 reason、tokensBefore、compactionCount） |
| subagents:usage | 每条 assistant message_end（附原生 usage），包括嵌套和 workflow child |

载荷字段：id、runId、type、description（缺省为 name）、status、isBackground、result、error、toolUses、durationMs，以及有用量时的 `tokens: { input, output, total }`（total 为 input+output）。usage 事件另含 model、thinking、depth（祖先数加 1），以及存在时的 parentAgentId、workflowId。

status 使用上游名称：

| 记录 state | status |
| --- | --- |
| completed | completed |
| failed | error |
| limited | aborted |
| stopped | stopped |
| queued | queued |
| 其他 | running |

## 结构化输出

structuredOutput 为 child 注入 `StructuredOutput` 工具，参数 schema 即调用方的 schema。

1. 工具校验失败时把错误作为工具结果返回，模型可在同一 run 内重试；多次调用以最后一次有效值为准。
2. 执行结束仍无有效值时，追加一次提示，说明未调用或上次的校验错误。
3. 仍无有效值时 run 失败，错误为最后一次校验错误，或要求调用 StructuredOutput 的说明。
4. 有效 JSON 写入记录的 structuredJson 和 result；工具外的文本不作为结果。

结构化结果的存储、读取和通知与普通 run 相同。

## 兼容性

兼容性验收范围为 Linux 和 Windows 上的 Pi 1.5.0 CLI；Windows 还覆盖 `@tintinweb/pi-tasks 0.9.1`，见 [RPC 验收](../../finished/pi-suite/agents/windows-rpc.md)。pi-tasks 把停止的任务记为 completed，而本包的 run 为 stopped；业务任务状态与 run 状态应分别读取。

[返回 agents](index.md)
