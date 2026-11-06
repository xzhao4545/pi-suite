# 子代理停止竞争与主从交互生命周期阶段

同范围 stop 在触发同步取消/订阅回调之前登记共享 promise，重复请求加入原操作。级联停止先统一转换全部目标状态、移除排队后代，再触发 abort 和事件；排队执行不在重入 configure/drain 时启动。等待 child 的 done 与本次 job 清理结论后返回，未确认的清理保留 pending/unconfirmed 摘要；清理失败仍等待 child 的 done，后续请求可重试，停止/清理未返回期间不准入同 agent 的新 run。

父级最终结算等待全部未 settled 的直接嵌套 child；活动 child 真正取消，已经产生自然终态而仍在 SDK 关闭或记录落盘的 child 等待原 done，保留自然终态。执行、取消、结果和通知均按 run 归属，旧运行的回调不能覆盖恢复后的执行。

提问和结果请求分别为 `agent:<agentId>:<runId>:ask`、`agent:<agentId>:<runId>:result`，已读消费和撤销限定该次 run；直接 child 的问题提前结束父级等待，嵌套问题只交给直接父执行。类型、队列、共享 TaskStore、Notifications 与 WaitRegistry 沿用公共框架。

WaitRegistry 的已取消 signal 在入口立即拒绝，取消/超时仅结束等待；同一 agent 的旧未读 run 在等待新 run 时进入 others、reason=other，只消费旧结果，新 run 仍 pending。结果去重按 `(id, runId)`，job/workflow 保持没有 runId 时的 ID 语义，进度消费保持独立。

3 项 Linux 真实 SDK 交互聚合检查通过、耗时约 1.9 秒，覆盖多 run 读取/通知撤销与边界合并去重、旧结果等待隔离与已取消入口、真实双 child any/all/ids 外提问优先及状态/计数/读取/消费，以及嵌套 FG/BG 直接父级问答和主会话 Esc/timeout 后 child 保留 waiting 并可继续回答。

停止竞争的 3 项 Linux 聚合检查通过、耗时约 1.79 秒，覆盖同步 stop 重入和整批排队取消、自然终态及失败时的父/子最终结算、task I/O 后的清理准入、旧 run 停止、新运行与 sweep 后根集合排序，以及真实 job 的回收后代归属和授权期间停止。Linux（Node 24.22.2）142 项全量检查通过、无跳过项，耗时 13.49 秒，类型检查通过；Windows 组合按待办继续验收。

停止与最终结算规则维护在 [执行与记录](../../../current/agents/runtime.md)，提问、等待和用户操作维护在 [agents 操作](../../../current/agents/operations.md)。工具参数摘要与所属 jobs 的进度字段仍由 [主从交互专项](interaction.md) 管理，Windows 组合保留在 [扩展专项](../../../todo/pi-suite/index.md)。

[返回已完成专项](../../index.md)
