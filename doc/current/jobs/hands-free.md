# PTY 监督与委派

job_start 的 mode 选择 pipe/PTY 后端，handsFree.mode 选择监督方式，二者分别配置。handsFree 只能与 mode=pty 合用，启动前校验，否则返回 INVALID_ARGS；monitor 可以同时配置，互不影响。监督器（`monitors/hands-free.ts` 的 `HandsFreeSupervisor`）由长期存在的 JobManager 持有，不随会话或界面绑定变化；reload 与 attach/detach 不会重启监督器或清零预算。

## 参数

| handsFree 字段 | 默认值 | 行为 |
| --- | --- | --- |
| mode | hands-free | hands-free：向模型发送进度更新；dispatch：不发进度更新，只发结算通知（monitor 通知照常） |
| updateMode | onQuiet | onQuiet：输出静默后发送新增内容；interval：按固定周期发送内容，没有新输出时只发状态 |
| quietMs | 8000 | 静默阈值。可见的非空白输出和模型输入都会重新开始静默计时 |
| updateIntervalMs | 60000 | interval 的周期；onQuiet 下为输出持续不断时的最长更新间隔 |
| autoExitOnQuiet | hands-free 为 false，dispatch 为 true | 静默且已过启动宽限期时请求终止 |
| graceMs | 15000 | 启动宽限期，从监督器创建（进程启动）开始计时，0 表示没有宽限期；用户接管、交还或重开视图都不重置 |
| updateMaxChars | 1500 | 每次更新的输出字符上限，1–65536 |
| maxTotalChars | 100000 | 全部更新的输出字符预算，0–1000000；0 表示只发状态 |

quietMs 与 updateIntervalMs 为 1–86400000 的整数毫秒，graceMs 为 0–86400000。job_start.timeoutMs 仍控制总运行期限，用户接管期间也有效。

```json
{"command":"交互命令","mode":"pty","handsFree":{"quietMs":8000,"maxTotalChars":10000}}
```

一次性委派用 `handsFree: {"mode":"dispatch"}`。希望程序自行退出时，设 `autoExitOnQuiet:false`，并按需提供 timeoutMs；此时 dispatch 不启动静默计时。

## 更新与预算

- 监督器只在内存中保留一个 updateMaxChars 大小的可见输出尾部；完整日志仍用 job_read 读取。
- 每次更新取走自上次以来的尾部；截掉了更早的输出时标记 truncated。
- 字符按 JavaScript 字符串长度计数，裁剪不拆开 UTF-16 代理对。
- 预算只统计更新中的程序输出；状态文字和模型主动的 job_read 不计入。
- job.json 保存解析后的配置、更新次数、已送达次数和累计输出字符数。
- 尚未送达的更新只保留最新一条。生成更新时即扣除预算，包括之后被替换或取消的更新，所以实际送达的总量不会超出预算。
- 预算用尽后的更新只含状态。onQuiet 没有新输出时不重复通知；interval 照常按周期发送状态。

更新以请求 ID `job:<id>:update` 进入共享 Notifications，投递条件与结果通知相同（当前会话、当前分支、界面未暂缓），见 [通知](index.md#通知)。更新正文包含首行、`#更新编号`、预算用量（用尽或截断时注明）、输出，以及 job_read/job_write 入口。

- wait 可因更新提前返回（reason=event，also 中带更新编号），已返回的更新从通知队列撤销。
- goal_wait 的 waitFor 包含该 job 时，更新也会恢复目标。
- 解绑会话时撤销排队的更新，新的绑定重新排队同一条未送达更新。
- 停止或进程退出时丢弃尚未送达的进度，由结算结果代替。

## 结算与用户控制

completionReason 只记录在带 handsFree 的 job 上：

| 结束方式 | stopReason | 终态 | completionReason |
| --- | --- | --- | --- |
| 静默自动终止 | quiet | stopped | quiet |
| 超过 timeoutMs | timeout | timed_out | timeout |
| 程序自行退出 | 无 | 由退出码与信号决定 | exited |
| 其他停止（user、agent、quit 等） | 对应原因 | 按 [结算与停止](index.md#结算与停止) | stopped |

静默自动终止调用同一个 `JobManager.stop`，观测到真实退出后才结算。静默本身既不是退出证据，也不代表任务成功；结果通知会注明这一点。终止未确认时保持 stopping，或 cleanup 为 pending/unconfirmed。

用户在终端视图中进入接管态（按 `i`，或 attach 打开时）后：

1. 模型的 job_write 返回 USER_CONTROL。
2. 进度更新与静默终止暂停，已排队的更新撤销；接管期间的输出只保存在原始日志中，不进入后续更新。
3. 按 returnKey（默认 Ctrl+G）或离开视图时交还模型：重新开始更新周期和完整的 quietMs 静默窗口，不重置预算、运行期限或启动宽限期。

视图入口与全部按键见 [执行任务的用户操作](index.md#用户操作)。

[返回执行任务](index.md)
