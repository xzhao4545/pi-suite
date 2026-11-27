# 定时调度

[Agents](index.md) · [文档索引](../../index.md)

带 `schedule` 的 `agent_start` 登记一个未来的后台运行，而不是立即启动。开关：`agents.scheduling`（默认 `true`）。只有主会话的 `agent_start` 有此参数。

```json
{ "type": "Explore", "prompt": "汇总问题跟踪器中的新问题", "schedule": "0 0 9 * * 1" }
```

调用返回调度 ID、类型和下一次运行时间。`schedule` 不能与 `background: false` 或 `inheritContext` 同时使用。

## 时间格式

| 格式 | 示例 | 含义 |
| --- | --- | --- |
| 六字段 cron | `0 0 9 * * 1` | 秒、分、时、日、月、星期，按 Pi 所在的本地时区计算。每周一 09:00。 |
| 周期 | `5m`、`1h`、`2d` | 每隔一个周期重复。单位为 `s`、`m`、`h`、`d`。 |
| 相对单次 | `+10m` | 十分钟后执行一次。 |
| 绝对单次 | `2026-12-01T09:00:00+08:00` | 在 ISO 时间执行一次。拒绝已过去的时间。 |

错过的周期会跳过，从不补跑。只有所属会话在运行中的 Pi 里打开时，调度才会触发。会话关闭期间错过的单次任务会被禁用并报告。周期运行可以重叠。

## 行为

每次触发都会启动一个普通的后台子代理，并记录其 `scheduleId`。运行使用登记时保存的显式参数（`model`、`thinking`、`maxTurns`、`isolated`、`taskId`、`name`），并在触发时读取当前的类型配置。定时运行不排队，但仍计入后台池。

调度属于主会话，保存在 `<agentDir>/pi-suite/agents/schedules/<sessionId>.json`。`/resume` 和 `/reload` 会恢复调度；`/new` 和 `/fork` 不带调度。

## 管理调度

`/subagents schedules` 列出当前会话的调度，包括规则、下次运行时间、最近状态、运行次数和最近的 agent。Enter 打开详情，**x Cancel schedule** 经确认后删除调度。取消只阻止之后的触发；已启动的运行用 `agent_stop` 停止。

扩展可以监听 `subagents:scheduler_ready` 和 `subagents:scheduled` 事件（`added`、`removed`、`fired`、`error`）。
