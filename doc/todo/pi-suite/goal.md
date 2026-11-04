# 目标状态与续跑

目标：避免 retry、compact 和会话切换误中断 goal。

当前状态：待实施；项目已有扩展骨架，本专项业务能力尚未实现。

影响范围：goal 状态、运行调度、预算、宿主事件及通知协调。

约束：目标状态与运行状态分开；宿主恢复期间不叠加自己的重试。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [ ] 拆分持久目标与调度状态
- [ ] 按宿主最终结算判断错误或继续
- [ ] 处理 compact/reload/会话绑定与目标恢复
- [ ] 统一 goal/job/agent 的继续请求和去重
- [ ] 保留显式暂停、Esc、完成和预算的控制语义

## 验收方式

核对正常结束、重试成功/耗尽、手动/自动 compact、Esc、reload 的状态和继续次数。

## 关联计划

- [执行任务生命周期](jobs/session-lifecycle.md)
- [等待用户](ask/interaction.md)
- [子代理](agents.md)

## 7. goal：目标状态与一次模型运行分开

goal 是持久的工作目标；一个 turn 被 abort，不等于用户放弃 goal。

分别记录：

- 目标状态：active、paused、failed、completed，以及用户启用的预算限制状态。
- 调度状态：running、waiting_user、waiting_jobs、waiting_host、detached、idle。

建议行为：

| 事件 | 目标状态 | 调度行为 |
| --- | --- | --- |
| 正常回答结束，目标未完成 | active | 宿主结算后安排一次继续 |
| 自动重试或上下文溢出恢复 | active | 等宿主完成其恢复，不叠加自己的重试 |
| 用户执行 retry 类操作 | active | 保留目标，等待重新执行结果 |
| 手动 compact | active | 接受当前 turn 的 abort；压缩结束、宿主可运行后再续跑 |
| reload | 原状态保留 | 持久化、撤销旧绑定、恢复后重新调度 |
| resume/new/fork | 原会话目标保留 | 非当前会话不自动续跑；恢复原会话再绑定 |
| 询问用户、等待 job | active | 对应 waiting，不空转模型 |
| 单纯 Esc 取消当前回复 | active | 停止当前轮的自动续跑，等待新的用户输入/继续操作，避免立刻夺回控制 |
| 用户明确 `/goal pause` 或取消 goal | paused/取消 | 停止自动续跑 |
| 宿主重试结束后仍是模型请求错误 | failed/对应错误状态 | 停止自动续跑并保存错误 |
| 目标已完成或明确配置的预算耗尽 | completed/预算状态 | 停止自动续跑 |

上表的 Esc 只停止当前运行，不修改目标为 paused。显式暂停、完成和预算属于用户控制或业务终态，与误把 compact/retry 当作中断分开处理。

实现不能在 agent_end 看见 aborted 就改 goal 状态。该事件只适合记录这轮结果和用量；最终判定优先使用新版 `agent_before_settle` 的 outcome 和 `agent_settled`，结合压缩成功/失败事件与当前绑定状态。

特别注意：Pi 的 AgentSession 底层订阅事件与扩展 `pi.on(...)` 的公开事件不是完全相同的接口。当前扩展 AgentEndEvent 类型没有 willRetry，不能照着底层事件文档假定这个字段在扩展事件中可用。

持久化 goal ID、目标、进度、预算和用量，compact 后重新注入必要目标摘要。续跑使用稳定的请求标识/代次去重；一个 goal 在一次结算边界最多请求一个继续，不能由 goal、job 和 subagent 分别发三次 follow-up。
