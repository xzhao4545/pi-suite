# 进度与结果通知

进度从当前 run 记录、child 会话事件和 jobs 运行时的创建归属查询读取。读取不启动模型，不消费结果，不改变 job 归属。

## agent_get 与执行历史

`agent_get` 查看当前 run 或指定 run；默认不查询 jobs。完整输入、输出和工具参数用 `agent_read` 读取。`agent_list` 传 `agentId` 和 `state:"all"` 时分页列出该 agent 的历史 run。`agents` 数组保留各次的 runId 和状态；用 `nextCursor` 续页时沿用原范围和筛选。

| 输出 | 默认 | `detail:true` 追加 |
| --- | --- | --- |
| 正文 | 摘要行（ID、状态、名称、runId、一位小数秒）；模型、thinking、轮数、工具次数、任务引用；activity；错误；完整待答问题与选项 | 模型与 thinking 来源；usage；context（tokens/窗口/百分比）；lastUpdateAt；所属活动 job 列表 |
| `agent` | [记录](runtime.md#id-与记录)摘要，含活动、用量、最近更新时间和模型来源。输入、结果分别为 `promptSummary`（至多 200 字节）、`resultSummary`（至多 500 字节） | 同左 |
| `question`、`waitingFor` | 有待答问题时为 ask 参数和 `parent` | 同左 |
| `jobs`、`jobsUnavailable` | `jobs` 为空数组；无 `jobsUnavailable` | 见 [所属活动 jobs](#所属活动-jobs) |

activity：

- 生成回复时为 `Generating response`。
- 工具执行时为 `tool <名称> <紧凑 JSON 参数>`，参数超过 180 字符时截断。并发工具按调用 ID（`toolCallId`）分别记录，用 ` · ` 连接；一个调用结束不影响其他调用。
- run 退出时清空。

`usage` 取 child 会话 `getSessionStats()`（会话统计）相对本次 run 开始时的差值，含 input、output、cacheRead、cacheWrite、total token 和美元 cost。工具开始、回合结束、写入用量或带用量的压缩记录时更新；结算保存最终差值。耗时规则见 [执行与记录](runtime.md#id-与记录)。

## 所属活动 jobs

`detail:true` 时按 runId 查询 jobs 运行时的 `createdBy`（返回由这些 run 或其后代创建的 job）：

| 调用 | 查询的 runId |
| --- | --- |
| 未指定 runId | 该 agent 在本进程的全部 run |
| 指定 runId | 只有这个 run |

- 结果包含已结算、已回收的 child 留下的 job；不受 cwd、owner、分支或分页限制，也不按任务引用转移归属。保存的历史 PID 不用于重建 job。
- 使用 jobs 的[活动筛选](../jobs/index.md#结算与停止)。终态但仍待清理的 job 会列出，不能当作已完成。
- 正文列出 ID、状态和清理状态（有清理错误时附错误）；`jobs` 返回完整 job 摘要，包括名称。
- 创建归属查询返回 `RUNTIME_UNAVAILABLE` 时，`jobsUnavailable` 给出原因；此时空 `jobs` 不代表没有活动 job。其他字段照常返回。
- `modules.jobs=false` 时不注册 job 工具；agents 用一个未绑定的 `JobsModule` 查询同一运行时，不清空 reload 前创建的 job，不订阅 job 通知。

Runs 和 Transcript 的 Jobs 入口按所选 runId 查询，界面见 [工具与操作](operations.md)。

## 结果通知

后台 run、分离启动的 run（RPC、@handle 克隆），以及因提问、超时或转后台提前返回的前台 run，在结算后各投递一次结果。一直等待到结算的 `agent_start` 直接返回结果，不发通知。

通知正文以 `Agent result: ` 开头：

1. 摘要行：agent ID、状态、名称、runId、耗时。
2. 有错误时：usage（五类 token 与 cost）和 `error: <错误>`。成功 run 的用量用 `agent_get(detail:true)` 查看。
3. 结果预览，最多 2048 字节，超出时按 UTF-8 截断并以 `... [truncated]` 结尾。
4. 超出时附全文入口 `agent_read({"id":…,"runId":…,"stream":"result","offset":0})`。

前台 wait 返回同样的摘要。通知请求 ID 为 `agent:<agentId>:<runId>:result`；agent_read 或 wait 消费结果只撤销该 run 未投递的通知，恢复产生的新 run 单独通知。提问规则见 [父级回答](operations.md#父级回答)。

[返回 agents](index.md)
