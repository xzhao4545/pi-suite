# 跨扩展 RPC

其他扩展通过同进程 `pi.events` 调用子代理服务。通道与协议版本来自 @tintinweb/pi-subagents 0.23.0；注册、归属、执行和结果消费接入本包公共会话绑定、AgentManager 与 Notifications。

## 注册与回复

服务在首次绑定 session_start 注册并发出 `subagents:ready`，其载荷为 `{}`。所有扩展工厂此时已执行；没有收到会话绑定的扩展不发布服务。重复绑定保持单份监听，session_shutdown 撤销监听；后续绑定重新注册。树导航沿用注册并使用当前会话与分支归属。

请求携带非空、唯一 `requestId`，回复发送至 `<channel>:reply:<requestId>`。成功为 `{ success: true, data?: T }`，失败为 `{ success: false, error: string }`；无返回值时省略 data。

| 通道 | 参数（除 requestId） | 成功回复 data |
| --- | --- | --- |
| subagents:rpc:ping | 无 | `{ version: 2 }` |
| subagents:rpc:spawn | type、prompt、options? | `{ id }` |
| subagents:rpc:stop | agentId | 省略 |
| subagents:rpc:consume | agentId | 省略 |
| subagents:rpc:steer | agentId、非空 message | 省略 |

spawn 的 type 和 prompt 必须非空。即时启动等待 SDK 创建、扩展绑定与工具范围安装：启动失败返回错误信封。排队项立即返回 ID，后续通过生命周期事件报告启动和结果。spawn 始终与调用方分离，结果走公共通知；调用方通过事件与 consume 自行处理结果。

## 启动选项

RPC 保留上游的参数名，区别于 agent_start 的模型工具参数名。

| 选项 | 行为 |
| --- | --- |
| description、name | 任务描述与实例名；name 参与公共 handle/alias 分配 |
| model | 模型字符串或带 provider/id 的 Model 对象；null 表示不提供覆盖；通过父级认证目录解析，显式 provider 不替换 |
| thinkingLevel、maxTurns | thinking 与运行轮数；thinking 由 SDK 按实际模型能力处理 |
| isolated、inheritContext | 隔离能力与父级文本上下文，按公共类型 frontmatter 优先规则执行 |
| isBackground | 默认 false；true 计入后台池并排队，false 的分离运行不占前台槽位；类型 run_in_background 优先 |
| bypassQueue | 绕过饱和队列；后台槽位仍计入实际数量 |
| cwd | 已存在目录的绝对路径；null 表示使用父级目录 |
| signal | 同进程 AbortSignal；取消排队或活动运行，结算后移除监听 |
| structuredOutput | `{ schema, check(value) }` 编译后的对象 schema，验证函数返回 true 或可读错误 |
| onSpawned、onQueued、onCompaction | 分别接收 id、id/同池前方数量、reason/tokensBefore/compactionCount；函数只适用于同进程 |

未知与内部选项明确拒绝，包括 parentAgentId、workflowId、depth、configCwd、rootSessionId、resumeSessionFile、reclaim 与 blocking。isolation/worktree 不支持；invocation 与活动追踪回调由公共记录和 SDK 订阅管理，不能由外部提供。onBeforeWorktreeCleanup 没有注册入口。调用方收到错误时应按信封处理，不推断参数被接受。

指定 cwd 时，文件工具和命令在目标目录执行，类型、设置、扩展、技能、memory 与本包配置从父级项目加载。目标目录与配置目录不同时，child 的 isProjectTrusted 为 false，目标 `.pi` 扩展与 MCP 配置不能借用父级信任；嵌套启动继承配置目录。

## 归属与消费

stop、steer 和 consume 仅接受当前绑定会话、当前分支的顶级 agent ID。嵌套与 workflow 归属的记录明确拒绝。stop 等待公共级联停止与 job 清理；steer 可引导或排队，也可回答父级提问，但拒绝结束或结算中的执行，不能恢复会话。consume 只标记已经结算的运行并撤销其待发公共通知，不读取结果或启动模型。

完成时先同步发出 completed/failed，再允许公共通知排队。外部扩展在监听器的同步部分直接发出 consume，可以避免通知入队；通知尚未送出时，稍后消费也可取消。通知已经进入宿主请求队列后，消费不能撤销该请求。

## 生命周期与结果

顶级记录发出 subagents:created、started、completed、failed、steered 和 compacted。created 在记录准入时发出，started 在 SDK 会话就绪时发出；失败、停止及轮数限制发 failed。公共 state 为 completed/failed/limited 等，事件 status 使用上游 completed/error/aborted 等名称。完成事件包含 id、runId、type、description、result/error、status、toolUses、durationMs 与可用的 tokens。

subagents:usage 按每个 assistant message_end 发出一次，包含 Pi 原生 usage、实际 model/thinking、depth 与存在的 parentAgentId/workflowId，覆盖嵌套执行。subagents:disposed 在绑定关闭与清理等待结束后发出。重绑后的事件订阅只向当前会话与分支报告可见运行。

structuredOutput 通过上游 StructuredOutput 工具采集并验证 JSON。无有效调用时，执行层最多追加一次明确纠正提示；工具验证失败可在运行内修正。最终没有有效 JSON 时记录失败，有效结果写入 structuredJson 和 result；工具外的结束文本不作为结构化结果。工具由公共动态范围准入，结构化结果、错误与会话均使用普通 run 的存储、读取和通知路径。

[返回 agents](index.md)
