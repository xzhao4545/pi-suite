# 状态与生命周期

## 目标字段

| 字段 | 含义 |
| --- | --- |
| `id`、`revision` | 稳定 ID；目标文本每次修改 `revision` 加 1 |
| `text` | 目标正文，最长 4000 字符 |
| `status` | `active`、`paused` 或 `completed` |
| `automatic` | 是否自动续跑；`active` 时为 true，其余为 false |
| `reason` | 仅 `paused` 有：`kind` 为暂停原因；`previous` 为退出或启动前的原因；`automaticStop` 为自动停跑诊断；`wait` 为暂停时撤销的等待 |
| `waiting`、`resumeAt`、`waitFor` | `goal_wait` 的等待类型（`user` 或 `jobs`）、期限与等待的 ID |
| `budget`、`usedTokens`、`turns` | 可选 token 上限、累计用量、响应次数 |
| `elapsedMs` | 累计有效运行时间 |
| `progress`、`error`、`completedAt` | 完成或阻塞证据、最近一次真实错误、完成时间 |

状态矛盾的记录在读取时报错：`active` 必须自动且没有 `reason`，`paused` 必须有 `reason` 且不自动，`completed` 不自动。存储与导入见 [存储](storage.md)。

## 生命周期与界面状态

持久生命周期只有 `active`、`paused`、`completed`。`GoalManager` 另有不持久化的调度状态：`running`、`waiting_user`、`waiting_jobs`、`waiting_host`、`idle`、`detached`（未绑定会话）。

界面只显示四种用户状态：

| 用户状态 | 来源 |
| --- | --- |
| 进行中 | `active`，正在运行或已安排下一轮 |
| 等待中 | `active`，等待用户、外部工作（`goal_wait`）或宿主（重试、压缩） |
| 已暂停 | `paused` |
| 已完成 | `completed` |

## 暂停原因与恢复

暂停只停止自动续跑。用户发来的消息总是正常处理，见 [本轮权限](#本轮权限)。暂停原因决定用户的新消息是否同时恢复自动续跑：

| 原因（`reason.kind`） | 何时产生 | 用户新消息后 |
| --- | --- | --- |
| `manual` | `/goal pause` | 保持暂停，需要 `/goal resume` |
| `budget` | `usedTokens` 达到 `budget` | 保持暂停；先调高预算再 `/goal resume` |
| `shutdown` | 退出 Pi 时目标未完成 | 保持暂停，需要 `/goal resume` |
| `startup` | Pi 冷启动时目标未完成 | 保持暂停，需要 `/goal resume` |
| `historical_stop`、`permission` | 从旧版本记录导入 | 保持暂停，需要 `/goal resume` |
| `blocked` | `goal_blocked` | 恢复自动续跑 |
| `request_failed` | 宿主重试耗尽后最终请求失败 | 恢复自动续跑 |
| `no_tools`、`repeated_tools` | [自动停跑](context.md#自动停跑) | 恢复自动续跑，停跑计数清零 |
| `cancelled` | 输入框 Esc，或 `ask_user` 被系统取消 | 恢复自动续跑 |
| `compaction_failed` | 压缩被取消或失败 | 恢复自动续跑 |

需要显式恢复的原因集合定义在 `src/goal/state.ts` 的 `requiresExplicitResume`。`/goal resume` 对任何原因都有效（预算耗尽除外），并清除原因、错误和等待，重置停跑计数。后台通知、`/reload`、树切换和压缩都不会恢复暂停的目标。

## 本轮权限

每次宿主开始运行（`before_agent_start`）时，`GoalManager` 记录本轮的目标 ID、`revision`、会话绑定和请求的 AbortSignal，并决定本轮的 `access`：

| `access` | 条件 | 可用的目标工具 |
| --- | --- | --- |
| `execute` | 目标 `active` | `goal_complete`、`goal_blocked`、`goal_wait` |
| `complete` | 目标 `paused` 或 `completed`，且本轮由用户消息发起 | `goal_complete` |
| `none` | 没有目标；或目标不是 `active`，且本轮不是用户发起（通知唤醒、其他扩展发起的运行） | 无 |

`access` 只约束目标工具，不限制普通工具。子代理会话不继承父会话的目标。`complete` 轮里模型照常处理用户消息，结束后不自动续跑。

目标工具调用时重新核对：目标 ID 与 `revision` 未变、会话绑定未撤销、请求未取消、目标控制没有被更新的 pause/resume/edit/clear 取代。任一不符返回 `STALE_BINDING`。`/goal resume` 递增内部控制计数，旧运行迟到的 aborted 结算因此不能把刚恢复的目标再次暂停。

## 宿主事件

| 事件 | 处理 |
| --- | --- |
| 一轮正常结束，目标未完成 | 安排下一轮继续 |
| `agent_end` 后宿主重试 | 进入 `waiting_host`，等最终结算，不另外安排继续 |
| 重试耗尽，最终请求失败 | 在 `agent_settled` 时暂停为 `request_failed`，保存最终错误；`agent_before_settle` 只进入 `waiting_host` |
| 手动或自动压缩成功 | `active` 目标继续：原本在等待的保持等待，否则安排下一轮（`willRetry` 时由宿主重试）；暂停的目标保持暂停 |
| 压缩取消或失败 | 暂停为 `compaction_failed`，保留错误 |
| 输入框 Esc | 暂停为 `cancelled` |
| `ask_user` 返回 `skipped` | 目标保持 `active`，本轮继续；已有答案不代表同意 |
| `ask_user` 返回 `timed_out` | 目标保持 `active`，自动答案作为推荐方案继续，不代表授权 |
| `ask_user` 返回 `cancelled` | 暂停为 `cancelled`，`reason.wait` 记录等待用户 |
| `goal_wait` | `waiting_jobs`，外部事件或期限到达后继续 |
| `/goal pause`、`goal_complete`、预算耗尽 | 暂停或完成；取消待交付的继续请求与等待期限 |
| 退出 Pi（quit） | 未完成目标暂停为 `shutdown`，`previous` 保留原暂停原因；保留错误、进度、用量与耗时 |
| Pi 冷启动 | 未完成目标暂停为 `startup`，不发请求、不安装期限 |
| `/reload`、`/resume`、树切换 | 撤销旧绑定，重新读取同一会话的当前状态；目标不随所选历史回滚 |
| `/new`、`/fork` | 新会话没有目标 |

## 用量、耗时与定时器

- 预算只在设置后生效。`message_end` 把宿主报告的 `totalTokens`（含输入、输出与缓存）计入 `usedTokens`，完成审计轮也计入。修改目标文本后，原修订仍在途的响应继续计入，但不能覆盖暂停等已提交的状态。
- `elapsedMs` 用 `performance.now` 累计处于 `running` 的时间。等待、暂停与 Pi 未运行的时间不计入。TUI 中每秒刷新一次显示，刷新不写文件、不发请求。
- 对已在运行的目标执行 resume 不会排队新请求。宿主正忙（其他响应、取消结算、压缩、重试）时，resume 记下意图，在宿主空闲后安排一次继续。
- 自动继续请求使用固定请求 ID `goal:<ID>`，与其他通知合并；宿主已有的继续和待处理消息优先。
- 期限与完成反馈定时器在撤销绑定时取消；回调核对绑定和目标 ID。修改目标文本会取消原目标的 job 等待。完成反馈 5 秒后从状态行清除，目标与证据仍保留。

[返回目标管理](./index.md)
