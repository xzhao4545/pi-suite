# job 监视、hands-free 与 dispatch

目标：保留 pi-interactive-shell 的输出 monitor 与 hands-free/dispatch，使模型可以监视输出模式、委派 CLI agent 并在需要时被唤醒，用户随时接管。

当前状态：实施中；PTY 终端视图中的用户接管与交还已随 attach 实现（见 [执行任务](../../../current/jobs/index.md)），hands-free 暂停更新待 hands-free 实现时接入。monitor、hands-free、dispatch 与 CLI agent 预设待实施；保留范围由用户确认，不保留 Jev 语义监督与语义输出裁剪。导入文件见 [上游导入](../upstream-import.md)。

影响范围：JobManager、PTY 会话、monitor 编译、hands-free 状态机、统一通知、PTY 终端视图与配置 jobs 节。

约束：唤醒走统一 Notifications 并按请求 ID 去重；静默结束和超时只表示本包结束监督并请求终止，不等于命令成功；用户接管期间不向程序发送模型输入。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [ ] 实现 stream、poll-diff、file-watch 三种 monitor 及 trigger 匹配、阈值、冷却与去重
- [ ] 记录 monitor 事件历史，job_read 增加 events 通道
- [ ] 实现 hands-free 的静默或定时更新与总字符预算
- [ ] 实现 dispatch 的宽限期、静默结束与超时结算
- [ ] 实现 CLI agent 预设与 launchPolicy
- [x] 实现 PTY 视图中的用户接管与交还，同步操作说明

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
| handsFree | updateMode?（onQuiet 默认、interval）、quietMs?（默认 8000）、updateIntervalMs?（默认 60000）、autoExitOnQuiet?（dispatch 默认 true）、graceMs?（默认 15000） |
| agent | CLI 预设键（pi、codex、claude、cursor 或配置中的自定义键）与 prompt，代替 command |

file-watch 自行生成监视命令，不能同时提供 command 或 agent。threshold 对正则捕获组做数值比较（lt、lte、gt、gte、eq）。detector 外部命令从 stdin 接收候选事件 JSON，在 stdout 返回是否通知。

## monitor 唤醒

每个匹配事件生成结构化记录：eventId、时间、strategy、triggerId、匹配文本、所在行或差异、stream。事件以请求 ID `job:<id>:monitor` 进入统一通知，同一边界内的多个事件合并；monitor 停止（流结束、脚本失败、手动停止、超时）时再通知一次生命周期结果。事件历史持久保存，经 job_read 的 events 通道分页读取，不另设查询工具。

## hands-free 与 dispatch

- hands-free：程序在 PTY 中运行，用户可在终端视图观看；输出静默 quietMs 或达到 updateIntervalMs 时向模型发送一次更新，单次与总量受字符预算限制，用尽后只发送状态。模型通过 job_read 与 job_write 继续操作。
- dispatch：委派一次性任务，宽限期后输出静默 quietMs 时结束监督并请求终止，completionReason 记为 quiet；不能把静默结束说成任务成功。结算时发送一次完成通知。
- 两者都可设 timeoutMs；超时结算为 timed_out。

## CLI agent 预设

配置 jobs.agents 定义预设键对应的可执行文件与默认参数，内置 pi、codex、claude、cursor；pi 支持 fork 当前会话。jobs.launchPolicy 为精确命令匹配的 allow、deny、ask 列表，deny 优先，未匹配默认 ask，只能在用户级配置设置，项目级配置出现该字段时报错。不保留 worktree 启动。

## 用户接管

PTY 终端视图中用户输入任意按键即接管：程序只接收用户输入，job_write 返回 USER_CONTROL 错误，hands-free 更新暂停。接管 hands-free 或 dispatch 会话后按 Ctrl+G 交还模型；Ctrl+B 退出视图转后台；Ctrl+T 把当前屏幕文本发送给模型。关闭视图不停止 job。快捷键可配置并写入操作说明。

[返回执行任务待办](index.md)
