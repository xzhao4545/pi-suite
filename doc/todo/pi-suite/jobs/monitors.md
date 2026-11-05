# job 监视、hands-free 与 dispatch

目标：保留 pi-interactive-shell 的输出 monitor 与 hands-free/dispatch，使模型可以监视输出模式、委派 CLI agent 并在需要时被唤醒，用户随时接管。

当前状态：实施中；stream、poll-diff、file-watch 三种 monitor（trigger、阈值、冷却、去重、detector）、events 通道与唤醒已实现并在 Linux 通过检查，见 [执行任务](../../../current/jobs/index.md)；hands-free 的增量更新与预算、dispatch 的静默终止与宽限期、用户接管时暂停监督，以及 wait/goal_wait 联动与 reload 保活已实现并通过 Linux 离线检查，见 [基础阶段记录](../../../finished/pi-suite/jobs/hands-free-core.md) 与 [当前监督契约](../../../current/jobs/hands-free.md)。Windows 监督验收与 CLI agent 预设待实施；保留范围由用户确认，不保留 Jev 语义监督与语义输出裁剪。导入文件见 [上游导入](../upstream-import.md)。

影响范围：JobManager、PTY 会话、monitor 编译、hands-free 状态机、统一通知、PTY 终端视图与配置 jobs 节。

约束：唤醒走统一 Notifications 并按请求 ID 去重；静默结束和超时只表示本包结束监督并请求终止，不等于命令成功；用户接管期间不向程序发送模型输入。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 实现 stream、poll-diff、file-watch 三种 monitor 及 trigger 匹配、阈值、冷却与去重
- [x] 记录 monitor 事件历史，job_read 增加 events 通道
- [x] 实现 hands-free 的静默或定时更新与总字符预算
- [x] 实现 dispatch 的宽限期、静默结束与超时结算
- [ ] 实现 CLI agent 预设与 launchPolicy
- [x] 实现 PTY 视图中的用户接管与交还，同步操作说明
- [ ] 在 Windows 验证 monitor、hands-free、dispatch 与终端用户接管

## 验收方式

stream monitor 在匹配行触发一次唤醒并遵守冷却；poll-diff 在输出变化时触发；file-watch 在指定事件触发；阈值比较正确；monitor 结束发出生命周期通知。hands-free 在静默时发送更新且不超过预算；dispatch 静默结束标注 completionReason，宽限期内不结束。用户在终端视图输入后模型输入被拒绝，交还后恢复。Windows 与 Linux 分别验证。

## 关联计划

- [执行任务管理](execution.md)
- [输出读取](output.md)
- [运行记录与手动控制](history-control.md)

## 参数

job_start 的 monitor 与 handsFree 只用于 PTY 或 pipe 中适用的模式，互相独立：

| 参数 | 字段 |
| --- | --- |
| monitor | strategy?（stream 默认、poll-diff、file-watch）、triggers[]（id、literal 或 regex、threshold?、cooldownMs?）、poll?（intervalMs）、fileWatch?（path、recursive?、events?）、dedupeExactLine?、cooldownMs?、detector?（command、timeoutMs?） |
| handsFree | mode?（hands-free 默认、dispatch）、updateMode?（onQuiet 默认、interval）、quietMs?（默认 8000）、updateIntervalMs?（默认 60000）、autoExitOnQuiet?（dispatch 默认 true）、graceMs?（默认 15000）、updateMaxChars?（默认 1500）、maxTotalChars?（默认 100000） |
| agent | CLI 预设键（pi、codex、claude、cursor 或配置中的自定义键）与 prompt，代替 command |

file-watch 自行生成监视命令，不能同时提供 command 或 agent。trigger 的 regex 与 job_read search 同语法（`/re/flags`，裸模式不区分大小写）。threshold 对正则捕获组做数值比较（lt、lte、gt、gte、eq）。detector 外部命令从 stdin 接收候选事件 JSON，在 stdout 返回是否通知；detector 失败时候选事件附错误照常投递。

## monitor 唤醒

每个匹配事件生成结构化记录：eventId、时间、strategy、triggerId、匹配文本、所在行或差异、stream。事件以请求 ID `job:<id>:monitor` 进入统一通知，同一 job 的未送达事件合并为一条（新事件数与最新 10 条）；monitor 随 job 退出而停止，停止前读完剩余日志，生命周期结果并入 job 结算通知（首行附事件数）。事件历史持久保存，经 job_read 的 events 通道分页读取，不另设查询工具。wait 在 monitor 事件时提前返回，goal_wait 的 waitFor 包含该 job 时也由事件恢复。

## hands-free 与 dispatch

- hands-free：程序在 PTY 中运行，用户可在终端视图观看；输出静默 quietMs 或达到 updateIntervalMs 时向模型发送一次更新，单次与总量受字符预算限制，用尽后只发送状态。模型通过 job_read 与 job_write 继续操作。
- dispatch：委派一次性任务，宽限期后输出静默 quietMs 时结束监督并请求终止，completionReason 记为 quiet；不能把静默结束说成任务成功。结算时发送一次完成通知。
- 两者都可设 timeoutMs；超时结算为 timed_out。
- job_start.mode 仍为 pipe/pty；handsFree.mode 选择监督方式，且 handsFree 仅用于 PTY。更新用 `job:<id>:update` 请求 ID 合并，wait 返回后撤销；goal_wait 的 waitFor 包含该 job 时更新恢复目标。停止或退出撤销排队更新，仅保留结算结果；预算在更新生成时扣除，替换或取消不退回。

## CLI agent 预设

配置 jobs.agents 定义预设键对应的可执行文件与默认参数，内置 pi、codex、claude、cursor；pi 支持 fork 当前会话。jobs.launchPolicy 为精确命令匹配的 allow、deny、ask 列表，deny 优先，未匹配默认 ask，只能在用户级配置设置，项目级配置出现该字段时报错。不保留 worktree 启动。

## 用户接管

PTY 终端视图中用户输入任意按键即接管：程序只接收用户输入，job_write 返回 USER_CONTROL 错误，hands-free 更新暂停。接管 hands-free 或 dispatch 会话后按 Ctrl+G 交还模型；Ctrl+B 退出视图转后台；Ctrl+T 把当前屏幕文本发送给模型。关闭视图不停止 job。快捷键可配置并写入操作说明。

[返回执行任务待办](index.md)
