# Windows 原生 CLI 调度组合阶段

Windows Node 24.22.2、Pi 1.5.0 和 ConPTY 使用隔离 agentDir、实际发布 CLI 与离线 provider 验收。父模型通过真实 agent_start 登记六字段 cron、固定 interval 和相对 once；三种调度均启动真实 child，结果与次数写入会话调度文件。Pi 进程本地时区为 UTC+08:00（运行时标识 Etc/GMT-8），本地晚间 cron 的期限保存为对应 UTC ISO 时间，并在该期限触发。

实际键盘操作 `/agents schedules` 打开原生选择器和确认详情，核对 ID、类型、时间规则、下次/上次时间、状态、次数、最近 agent 与完整 prompt。Esc 取消确认后保留记录；确认删除 interval 后记录消失，经过其后续期限没有再触发。`/reload` 保留原 session ID 和已提交的 cron 期限，cron 继续成功触发。

`/new` 创建独立 session ID，当前调度文件为空；原会话的 once、interval 和 cron 在不活动期间不触发。通过原生 `/resume` 选择恢复原会话后，过期 once 禁用、runCount 保持 0，并保存明确的 inactive 错误；错过的 5 秒 interval 在恢复就绪时 runCount 仍为 0，下一期限从原期限跳过整周期而保持原相位，随后成功触发。周期不回放离线期间的模型工作。

另一个真实 once child 通过 job_start 启动持有中的 Node 进程，使用隔离用户配置中该完整命令的精确允许规则。`/quit` 停止 child、等待调度结算并自然退出，退出码为 0；调度 runCount 为 1、lastStatus 为 error、lastError 为 stopped。受管 job 保存 stopped、stopReason=quit 和 managed_scope_confirmed，独立 CIM 查询确认记录中的 Bash 根进程、子进程及 Node PID 均不存在。

此阶段覆盖上述 Windows 版本、本地固定 UTC+08:00 与原生 CLI 生命周期组合；夏令时和跨时区恢复契约见 [调度时区阶段](schedule-timezone.md)，稳定操作见 [定时调度](../../../current/agents/schedules.md)。未增加源码或永久测试。

[返回完成索引](../../index.md)
