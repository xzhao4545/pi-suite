# 实际 Pi CLI 调度与退出组合阶段

Linux 使用 Pi 1.5.0 的实际发布 CLI、JobManager PTY、隔离资源与 faux provider，显式加载本包；不依赖付费模型。实际父模型调用 agent_start 登记相对单次、固定周期和六字段 cron，三种调度均启动真实 child 并保存成功结果。

真实键盘输入进入 `/agents schedules`，核对 ID、类型、时间规则、下次/上次时间、次数、最近 agent 和 prompt。Esc 保留调度，确认删除周期与 cron 后不再触发。`/reload` 重绑后 cron 继续；`/new` 的调度文件与列表为空，原会话单次任务不在后台触发；通过原生 `/resume` 恢复后，已过期单次任务明确保存错误且不回放。

另一个单次调度 child 通过实际 job_start 启动受管 sleep 进程。`/quit` 中断 child，确认该进程消失，调度停止结果写回，实际 CLI 自然退出码为 0。验收复用本包启动、原生选择、会话生命周期与停止清理路径，未新增源码或永久测试。

本阶段覆盖上述版本的 Linux CLI 操作和实际进程清理；日历与跨时区规则见 [时区阶段](schedule-timezone.md)，Windows 与真实手机 SSH 仍由 [扩展待办](../../../todo/pi-suite/agents/extensions.md) 管理。稳定行为与操作见 [定时调度](../../../current/agents/schedules.md)。

[返回完成索引](../../index.md)
