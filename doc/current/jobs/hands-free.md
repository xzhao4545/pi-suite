# PTY 监督与委派

job_start 的 mode 决定 pipe/PTY 后端；handsFree.mode 决定监督方式，二者分别配置。handsFree 仅接受 mode=pty，启动前校验，monitor 可独立同时配置。监督器由长期 JobManager 持有，与会话/UI 绑定分离；reload 与 attach/detach 不重启监督器或清零预算。

## 参数

| handsFree 字段 | 默认值与行为 |
| --- | --- |
| mode | hands-free：向模型发送进度更新；dispatch：只发送结算通知，monitor 通知独立 |
| updateMode | onQuiet：输出静默后发送新增内容；interval：按固定周期发送内容或状态 |
| quietMs | 8000；可见非空输出与模型输入重新开始静默计时 |
| updateIntervalMs | 60000；interval 的周期，或 onQuiet 在持续输出时的最大更新间隔 |
| autoExitOnQuiet | hands-free 默认 false，dispatch 默认 true；静默且超过启动宽限期后请求终止 |
| graceMs | 15000；从进程启动计时，0 表示无宽限期；用户接管、交还或重开视图不重置启动时间 |
| updateMaxChars | 1500；每次更新的输出字符上限，1–65536 |
| maxTotalChars | 100000；全部更新的输出字符预算，0–1000000；0 表示仅状态 |

quietMs 与 updateIntervalMs 为 1–86400000 整数毫秒，graceMs 为 0–86400000。job_start.timeoutMs 仍控制总运行期限，用户接管期间也有效。

```json
{"command":"交互命令","mode":"pty","handsFree":{"quietMs":8000,"maxTotalChars":10000}}
```

一次性委派用 `handsFree: {"mode":"dispatch"}`。需要程序自行退出时，可设 `autoExitOnQuiet:false` 并按需提供 timeoutMs。

## 更新与预算

监督器只保留一个 updateMaxChars 大小的输出尾部，完整日志仍由 job_read 读取；每次更新消费增量尾部，超限保留末尾并标记 truncated。输出字符按 JavaScript 字符串长度计数，裁剪不拆开 UTF-16 代理对。预算仅统计更新中的程序输出；状态文字与后续主动 job_read 不计入。

job.json 保存解析后的配置、更新次数、已通知次数和累计输出字符数。尚未送达的更新只保留最新一条，生成时即扣除预算，包括后来被替换或取消的更新，确保实际投递不超预算。用尽后后续更新只有状态；onQuiet 没有新输出不反复通知，interval 可定时发送状态。

更新以请求 ID `job:<id>:update` 进入共享 Notifications，受所有权、启动分支和界面阻塞约束。wait 可因更新提前返回（reason=event、also 中带 update 编号），已返回的更新从通知队列撤销；goal_wait 的 waitFor 包含该 job 时更新恢复目标。旧绑定撤销排队通知，新的合法绑定重新订阅同一更新。停止或实际退出取消尚未送达的进度，由结算结果替代。

## 结算与用户控制

静默自动终止通过同一 JobManager.stop 执行，记录 stopReason=quiet；观测到实际退出后状态为 stopped、completionReason=quiet。静默本身不是退出证据或任务成功。timeoutMs 结算为 timed_out、completionReason=timeout；自行退出记 completionReason=exited，状态仍由退出码与信号决定；其他停止为 completionReason=stopped。终止未确认时保留 stopping 或 cleanup=pending/unconfirmed。

终端视图中用户输入立即接管：拒绝模型写入，暂停更新与静默终止，并撤销排队更新；期间的输出只保存在原始日志。Ctrl+G 或离开视图交还模型，恢复更新周期和完整 quietMs 静默窗口，不重置预算、运行期限或启动宽限期。操作入口与全部按键见 [执行任务操作](index.md#用户操作)。

[返回执行任务](index.md)
