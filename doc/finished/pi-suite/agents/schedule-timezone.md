# 调度期限与本地时区组合阶段

cron、interval、once 共用持久 nextRun 的 UTC 绝对期限和分段计时器，Croner 只计算后续日历时间。恢复保留尚未到期的已提交期限；后续 cron 使用当前 Pi 本地时区。恢复与运行期 claim 共用 interval 的期限推进公式，跳过错过的整周期并保持原相位；文件并发与执行仍通过既有 ScheduleStore 和 AgentManager。

新增 1 项 Linux 真实 Pi SDK/虚拟时钟聚合：纽约 09:00 保存为 UTC 14:00，切换 UTC 后 reload 不在新的本地 09:00 提前执行，也不会撤销未来调度；14:00 准入恰好一次，下一期限为当前时区的次日 09:00。同时核对日历 cron 跨夏令时的 23/25 小时间隔、固定 `1d` 周期的 24 小时，以及带时区 ISO 单次时间的 UTC 规范化。错过 12:00 的每小时周期在 14:30 恢复后定于 15:00，触发后的下一期限为 16:00，不补发遗漏执行。该范围无需等待真实小时流逝。

稳定时间与恢复规则见 [定时调度](../../../current/agents/schedules.md)，Linux 发布 CLI 的真实触发、原生操作与退出清理见 [CLI 调度阶段](schedules-cli.md)，Windows 与真实手机组合见 [扩展待办](../../../todo/pi-suite/agents/extensions.md)。

[返回完成索引](../../index.md)
