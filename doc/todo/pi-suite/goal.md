# 目标状态与续跑

目标：避免 retry、compact 和会话切换误中断 goal。

当前状态：目标生命周期与摘要基础阶段已实现并通过 Windows/Linux 离线验收，记录见 [已完成阶段](../../finished/pi-suite/goal-core.md)。真实 jobs/agents 完成通知与完整外部 footer 布局仍需综合验收。

影响范围：goal 状态、运行调度、预算、宿主事件、通知协调及状态栏摘要。

约束：目标状态与运行状态分开；宿主恢复期间不叠加自己的重试。

相关当前文档：[目标管理](../../current/goal/index.md)。

## 任务列表

- [x] 拆分持久目标与调度状态
- [x] 按宿主最终结算判断错误或继续
- [x] 处理 compact/reload/会话绑定与目标恢复
- [ ] 统一 goal/job/agent 的继续请求和去重：公共协调器与合并契约已实现，待 jobs/agents 接入后验收实际通知
- [x] 保留显式暂停、Esc、完成和预算的控制语义
- [ ] 从目标与调度状态派生单条状态栏摘要，兼容 Pi 原生 footer 与 pi-starship：摘要、原生 footer 与 Starship 状态模块已验证，完整布局见关联专项

## 验收方式

核对正常结束、重试成功/耗尽、手动/自动 compact、Esc、reload 的状态和继续次数；状态栏同步展示运行、等待、暂停与终态，不把宿主恢复误显示为暂停或失败。

## 关联计划

- [执行任务生命周期](jobs/session-lifecycle.md)
- [等待用户](ask/interaction.md)
- [子代理](agents.md)
- [goal 状态栏联动](goal-status.md)

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

goal 的常驻摘要默认通过 Pi 的 setStatus 发布，由原生 footer 或 pi-starship 渲染；目标与调度状态仍由本模块统一维护。dock 不重复显示同一摘要，完整目标、预算和错误信息按需查看。接口、状态映射和窄屏边界见 [goal 状态栏联动](goal-status.md)。
