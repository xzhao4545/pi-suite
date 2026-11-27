# 接口与操作

## 命令

| 命令 | 行为 |
| --- | --- |
| `/goal <目标>` | 建立目标并开始执行；已有未完成目标时先确认替换 |
| `/goal --tokens 100k <目标>` | 建立带 token 上限的目标，数量支持 `k`、`m` 单位 |
| `/goal` 或 `/goal status` | 查看完整正文、用户状态、暂停原因、ID、用量、响应次数、耗时、进度与错误 |
| `/goal edit <文本>` | 修改正文并递增 `revision`；中止属于旧修订的在途运行，目标 active 时重新安排继续 |
| `/goal edit --tokens 200k` | 修改预算；已达上限时立即暂停，调高后用 resume 恢复 |
| `/goal pause` | 暂停（`manual`）：停止自动续跑，取消待交付的继续与等待，中止本目标的在途运行；保留目标、证据、错误、用量与耗时 |
| `/goal resume` | 恢复未完成的目标，预算已耗尽时拒绝。结果为 `Goal resumed`；已在运行时为 `Goal already running`；宿主正忙时为 `Goal resumed · waiting`，不会并行启动第二个主模型请求 |
| `/goal clear` | 删除目标并中止其在途运行；保留一个空状态，防止再次从旧会话条目导入 |

- 目标正文最长 4000 字符，更长的要求可以写在文件里再引用。预算为正整数，省略时不限。
- `/goal stop` 作为未知子命令被拒绝，不会被当成目标正文。
- 哪些暂停会被用户的新消息恢复，见 [暂停原因与恢复](lifecycle.md#暂停原因与恢复)。恢复自动续跑与授权危险操作是两回事：`ask_user` 的取消、跳过或超时都不代表同意。
- 树切换共用当前目标，不恢复旧目标、用量或权限；`/reload` 读取当前状态；`/new`、`/fork` 的新会话没有目标。

## 状态显示

状态行（或 Dock）保留 `goal` 标签，用图标区分用户状态：

| 显示 | 用户状态 |
| --- | --- |
| `🎯 goal 03:27` | 进行中 |
| `⏳ goal 03:27` | 等待用户、外部工作或宿主 |
| `⏸ goal 03:27` | 已暂停 |
| `✅ goal 03:27` | 已完成，显示 5 秒后隐藏 |

时间为累计有效运行时间，`mm:ss`，超过一小时为 `h:mm:ss`，不在 24 小时归零；暂停与等待期间不走。clear 后立即隐藏。等待对象、期限、预算、暂停原因与错误在 `/goal` 详情中查看。

详情在共用阅读视图中以 Markdown 显示：↑/↓、PageUp/PageDown、Home/End 滚动，`/` 搜索，`n`/`N` 跳到下一个/上一个匹配，Esc 关闭并恢复 Dock。详情组件在第一次打开时才加载，加载后重新核对会话绑定和取消信号；会话已切换时不显示。打开期间通知暂缓，关闭后送达。

`/goal resume` 的结果条目只有一行；宿主的展开键只影响这一行的显示。

## 模型工具

三个工具都要求传入最新目标说明中的 `goalId`，并按 [本轮权限](lifecycle.md#本轮权限) 校验。

| 工具 | 参数 | 何时可用 | 结果 |
| --- | --- | --- | --- |
| `goal_complete` | `goalId`、`summary`（逐项列出要求及其验证证据，最长 4000 字符） | `execute` 或 `complete` | 目标完成，结束本轮。对已完成的目标重复调用会保留第一次的证据、时间与反馈 |
| `goal_blocked` | `goalId`、`reason`、`evidence`、`repeatedTurns`（至少 3） | `execute` | 暂停为 `blocked`，结束本轮 |
| `goal_wait` | `goalId`、`reason`、`waitFor?`、`resumeAfterMs?`（1–2147483647 毫秒） | `execute` | 进入 `waiting_jobs`，结束本轮 |

`goal_wait` 只用于等待已经安排好的外部工作。目标在以下任一情况恢复：

- 用户发来消息，或任一直接子代理提问（`agent:<id>:<runId>:ask`），或 `resumeAfterMs` 到期。
- 给了 `waitFor`（1–50 个 `job_`、`agent_`、`wf_` ID）时：所列对象全部结算，或其中某个 job 产生 monitor 事件（`job:<id>:monitor`）或 hands-free 更新（`job:<id>:update`）。其他通知排队，恢复时一起送达。
- 没给 `waitFor` 时：任何通知都会恢复。

调用时已结算的 ID 列在结果里；全部已结算时直接返回，不进入等待。不存在的 ID 报错；Pi 重启后只剩历史记录的 ID 不再阻挡恢复。

普通的未完成工作不能用 `goal_blocked` 或 `goal_wait` 代替推进。`goal_complete` 的事实验收由模型逐项完成，工具只校验参数和权限。

三个工具使用公共单行渲染：结果到达后隐藏调用，分别显示 summary、reason 或等待结论；展开后显示完整 summary、`evidence`/`repeatedTurns`，或 `waitFor`/`resumeAfterMs`/已结算对象。

### 错误

| 错误码 | 原因 |
| --- | --- |
| `INVALID_ARGS` | 必填文本参数为空白 |
| `NOT_FOUND` | `goalId` 缺失或不是当前目标 |
| `NOT_RUNNING` | 目标不在自动续跑，或本轮只有 `complete` 权限时调用了 `goal_wait`/`goal_blocked`；这是错误码，不是目标状态 |
| `STALE_BINDING` | 调用属于旧修订、旧请求、已被新控制取代的运行、已撤销的绑定或其他会话 |
| `GOAL_STALE` | 状态文件中的目标已被并发修改 |
| `GOAL_STORE_INVALID` | 状态文件损坏 |

`goal_complete` 同样严格校验 ID、`revision`、绑定、会话与本轮请求。错误正文说明下一步，`objectId` 为调用中的 `goalId`。读取、锁与保存失败直接报告，并撤销自动续跑，不回退到历史状态。命令和存储解析使用各自的错误文本。

[返回目标管理](./index.md)
