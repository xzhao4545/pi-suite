# 子代理共享任务清单与执行恢复集成

多个真实 Pi SDK child 捕获父级同一个 TaskStore，task_list 读取同清单，task_edit 经已有串行入口和锁提交；并发写入保留各自 status、description、owner 与父级派生进度，不按 child sessionId 创建另一任务文件。

持久主会话 reload/fork 期间，存活 child 继续原 owner 的 TaskStore；fork 以快照播种独立清单，原执行的后续写入不改变副本。Execution 回收后回到原 owner，原生 agent_send 恢复沿用稳定 agent ID、taskId 和原 TaskStore；新 runId 承载该次执行。完成或停止 child 不自动把任务改为 done，实际进度由 task_edit 维护。

两项 Linux 真实 SDK 聚合检查通过、耗时 1.79 秒，覆盖并发工具读写与原清单归属，以及 reload/fork、回收后恢复和停止时的任务状态。实现复用已有 TaskStore 注册表、会话绑定、存储和执行记录，没有增加重新关联子系统；Windows 与真实手机的界面及并发组合仍由 [任务待办](../../../todo/pi-suite/tasks.md) 管理。

Linux（Node 24.22.2）142 项全量检查通过、无跳过项，耗时 13.49 秒，类型检查通过。

稳定事实维护在 [任务管理](../../../current/tasks/index.md) 和 [存储与会话](../../../current/tasks/storage.md)。

[返回已完成专项](../../index.md)
