# 定时调度

`agents.scheduling` 默认 true。顶级 `agent_start` 带 `schedule` 时只登记调度，返回 ID、类型和下一次时间。

1. 校验类型和时间规则。`schedule` 不能与 `background:false` 或 `inheritContext`（即使为 false）一起使用。
2. 保存解析后的类型名、prompt，以及显式的 `model`、`thinking`、`maxTurns`、`isolated`、`taskId`、`taskGeneration` 和 `name`。触发时重新解析类型与模型配置。
3. 生成 `schedule_` 加 8 位十六进制的 ID。调度名用去除首尾空白的 `name`；为空时用类型名加 prompt 的前 40 个字符（连续空白折为一个空格），截到 80 个字符。会话内调度名唯一；重名返回 `INVALID_ARGS`。

新调用的 `taskId` 必须是子任务 ID（`组.序号`），并提供来源 `taskGeneration`。存储格式也接受纯数字的组 ID；触发时仍按 [任务关联](runtime.md#任务关联) 校验，不把清空前的任务引用绑定到同名新任务。

## 时间规则

| 写法 | 期限 |
| --- | --- |
| `0 0 9 * * 1` | 六字段 cron：秒、分、时、日、月、星期。Croner 10.0.1 按 Pi 进程本地时区计算下一期限。每日 cron 在夏令时切换时可能相隔 23 或 25 小时。 |
| `5m`、`1h`、`2d` | 周期。使用正整数和 `s`、`m`、`h`、`d`；`1d` 固定为 24 小时。 |
| `+10m`、ISO timestamp | 相对或绝对的单次时间，保存为 UTC ISO 时间；创建时必须晚于当前时间。 |

三种调度都用保存的 `nextRun`（UTC ISO 时间）设定计时器。超过 Node 的单段上限 2147483647 ms 时，分段等待同一绝对期限；计时器不阻止进程退出。

- 会话不活动时不触发。reload 或 resume 保留尚未到期的期限，即使本地时区已变化；后续 cron 期限按当前本地时区计算。
- 恢复时和运行中认领触发时，周期从上次保存的期限推进，跳过已错过的整周期，保持原相位，不补跑。cron 从当前时间计算下一期限。
- 单次调度在启动 child 前禁用；会话恢复时若已过期，禁用并报告错误。周期调度允许多次触发的 run 重叠。

## 记录与执行

每个主会话的调度文件是 `<agentDir>/pi-suite/agents/schedules/<sessionId>.json`，版本为 1。

| 字段 | 内容 |
| --- | --- |
| `id`、`name`、`createdAt` | 调度 ID、名称、创建时间 |
| `schedule`、`scheduleType`、`intervalMs` | 时间规则、类型、周期间隔（仅周期调度） |
| `request` | 登记时保存的启动参数 |
| `enabled`、`nextRun` | 是否启用、下一期限 |
| `lastRun`、`lastStatus`、`lastError` | 最近触发时间、状态（`running`、`success`、`error`）、错误 |
| `lastAgentId`、`lastRunId` | 最近启动的 agent 和 run |
| `runCount` | 已结算的触发次数，含启动失败；重叠触发的较早结果只增加次数，不覆盖较新触发的状态 |

调度与任务共用 [JSON 存储](../runtime/index.md#json-存储)。未知版本、损坏 JSON 或无效数据返回 `SCHEDULE_STORE_INVALID`，保留有效缓存和原文件；取锁超时返回 `SCHEDULE_LOCK_TIMEOUT`。无写入时不创建文件。

1. 计时器到期后，在锁内核对 `nextRun`，先保存下一期限，再启动 child。两个进程观察到同一期限时只启动一次；保存后进程退出也不补跑。
2. 通过 `AgentManager.start` 启动普通 run，记录 `scheduleId`。强制后台且不注入父级文本上下文；跳过排队，但仍计入后台池，普通排队任务须等到有空位。模型不可用时报告错误，不换用默认模型。
3. 按普通 run 规则关联任务、处理父级提问和 job；查看与停止见 [工具与操作](operations.md)。结算写入调度文件，结果见 [结果通知](progress.md#结果通知)。

## 会话与操作

new 和 fork 使用各自的调度文件；resume 和 reload 恢复当前会话的期限和统计。树导航重绑同一主会话的文件。

解除绑定会清除计时器，取消尚未启动的触发，并向仍在执行的调度 child 发出停止请求。已启动的 child 保持原归属，结算仍写回原文件。quit 等待 child 停止和调度写入完成。

1. 在 `/subagents` 切换到 Schedules，或直接运行 `/subagents schedules`。按名称、ID、时间规则、类型或 prompt 筛选；右侧显示时间、类型、完整 prompt、状态、次数和最近 agent。
2. 按 Enter 打开详情。返回列表时按 ID 保留选择、筛选和阅读位置；空列表也可切换页面。
3. 按 `x` 选择 **Cancel schedule**，确认后按 ID 删除条目。名称截断或终端宽度不影响删除对象。删除只取消后续触发；停止已经启动的 child 用 `agent_stop`。

设 `agents.scheduling=false` 后 `/reload` 生效：计时器停用，`schedule` 参数和 Schedules 入口隐藏，文件保留。嵌套 child 的 `agent_start` 没有 `schedule` 参数。

## 扩展事件

| 事件 | 载荷 |
| --- | --- |
| `subagents:scheduler_ready` | 绑定并恢复期限后发出，含 `sessionId`、`jobCount` |
| `subagents:scheduled` | `type: added` 带 `job`；`removed` 带 `jobId`；`fired` 带 `jobId`、`agentId`、`name`；`error` 带 `jobId`、`error` |

兼容性验收范围为 Linux 和 Windows（UTC+08:00）上的 Pi 1.5.0 CLI，见 [调度验收](../../finished/pi-suite/agents/windows-schedules.md)。

[返回 agents](index.md)
