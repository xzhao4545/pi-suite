# 定时调度

agents.scheduling 默认 true。顶级 agent_start 的 schedule 登记未来任务并立即返回 schedule ID、类型与下一次时间；参数与 background:false、inheritContext（包括 false）互斥。创建时校验类型与时间格式，保留显式模型、thinking、maxTurns、isolated、taskId 和 name，触发时重新解析类型与模型配置。

## 时间规则

- cron 使用六字段：秒、分、时、日、月、星期，例如 `0 0 9 * * 1`；由 croner 10.0.1 按 Pi 进程本地时区计算。
- `5m`、`1h`、`2d` 为周期，支持 s/m/h/d 的正整数；下一次期限按原有期限推进，跳过错过的周期。
- `+10m` 为相对单次时间，ISO timestamp 为绝对单次时间；写入后使用规范化 ISO 时间，拒绝创建已过期的时间。

nextRun 持久化为 UTC ISO 时间，三种调度均由这一绝对期限驱动同一分段计时器；Croner 只计算 cron 的下一期限。reload/resume 保留尚未到期的已提交期限，包括 Pi 进程本地时区变化后的恢复；该次结算后新 cron 期限按当前本地时区计算。每日 cron 按日历日推进，夏令时切换时可能相隔 23 或 25 小时；`1d` 周期始终为 24 小时的经过时间。已错过的 interval 在恢复与运行期 claim 时均从已提交期限跳过整周期，保持原相位，不重放遗漏的模型工作。

Node 超过 2147483647 ms 的延时按绝对期限分段重设，保持远期时间。计时器不阻止宿主退出。会话不活动期间不触发；恢复时跳过错过的周期，已过期单次任务禁用并报告错误。单次触发在启动前禁用，周期任务允许运行重叠。

## 记录与执行

每个主会话文件位于 `<agentDir>/pi-suite/agents/schedules/<sessionId>.json`，版本为 1。记录包含 schedule ID、name、时间规则、启动 request、enabled、createdAt、nextRun、lastRun、lastStatus、lastError、lastAgentId/lastRunId 和 runCount。runCount 是已结算的触发次数，包含启动失败；重叠运行的旧结果增加次数，但不覆盖较新触发的状态。

ScheduleStore 与 TaskStore 共用 [公共 JSON 存储](../runtime/index.md) 的串行写入、异步 pid:uuid 锁、锁内重读、复制后修改、唯一临时文件与原子重命名。未知版本、损坏 JSON 与无效数据返回 SCHEDULE_STORE_INVALID，保留有效缓存和原文件；锁超时返回 SCHEDULE_LOCK_TIMEOUT。没有调度写入时不创建文件。触发通过锁内核对 nextRun 并提前提交下一期限，同一期限被两个宿主观察时只准入一次；进程在提交后退出不会自动重放该次模型工作。

触发走公共 AgentManager.start，生成普通 agent/run，记录 scheduleId。调度来源强制后台、关闭父级文本上下文；其余 frontmatter 与模型优先级使用普通规则。调度绕过并发池排队，但仍占用对应后台池计数，普通排队任务等到池有容量才启动。任务清单、父级提问、job 归属、查看和停止与普通 child 相同，完成使用统一 Agent result 通知。不可用模型明确报错，不替换成默认模型。

## 会话与操作

new/fork 使用独立会话文件，resume/reload 恢复当前会话的期限与统计；树导航按同一主会话恢复。绑定撤销会清除计时器并取消未准入的异步触发，已启动的 child 保持原归属；结算继续更新捕获的原文件。quit 停止 child 后等待调度落盘。

`/agents` 的 Scheduled agents 和 `/agents schedules` 列出当前会话调度。选择一项可查看时间、启动类型、完整 prompt、状态、次数与最近 agent，确认后删除调度；取消已触发的调度只撤销后续触发，已启动的 child 使用 agent_stop 操作。共享原生选择器把 schedule ID 与显示文本分离，长名称和窄终端不会影响取消对象。

关闭 agents.scheduling 后使用 /reload；绑定时撤销计时器，agent_start 的 schedule 参数和菜单入口隐藏，原文件保留。嵌套 child 的 agent_start 不注册 schedule 参数。外部消费者可以监听 subagents:scheduler_ready 与 subagents:scheduled 的 added/removed/fired/error 事件。

[返回 agents](index.md)
