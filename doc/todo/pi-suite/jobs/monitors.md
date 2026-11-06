# job 监视、hands-free 与 dispatch

目标：保留 pi-interactive-shell 的输出 monitor 与 hands-free/dispatch，使模型可以监视输出模式、委派 CLI agent 并在需要时被唤醒，用户随时接管。

当前状态：实施中；stream、poll-diff、file-watch 三种 monitor（trigger、阈值、冷却、去重、detector）、events 通道与唤醒已实现并在 Linux 通过检查，见 [执行任务](../../../current/jobs/index.md)；hands-free 的增量更新与预算、dispatch 的静默终止与宽限期、用户接管时暂停监督，以及 wait/goal_wait 联动与 reload 保活已实现并通过 Linux 离线检查，见 [基础阶段记录](../../../finished/pi-suite/jobs/hands-free-core.md) 与 [当前监督契约](../../../current/jobs/hands-free.md)。CLI 预设与用户级 launchPolicy 已实现并通过 Linux 离线检查，见 [预设阶段记录](../../../finished/pi-suite/jobs/cli-launch-core.md)。Windows 监督与预设验收待实施；保留范围由用户确认，不保留 Jev 语义监督与语义输出裁剪。导入文件见 [上游导入](../upstream-import.md)。

影响范围：JobManager、PTY 会话、monitor 编译、hands-free 状态机、统一通知、PTY 终端视图与配置 jobs 节。

约束：唤醒走统一 Notifications 并按请求 ID 去重；静默结束和超时只表示本包结束监督并请求终止，不等于命令成功；用户接管期间不向程序发送模型输入。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 实现 stream、poll-diff、file-watch 三种 monitor 及 trigger 匹配、阈值、冷却与去重
- [x] 记录 monitor 事件历史，job_read 增加 events 通道
- [x] 实现 hands-free 的静默或定时更新与总字符预算
- [x] 实现 dispatch 的宽限期、静默结束与超时结算
- [x] 实现 CLI agent 预设与 launchPolicy
- [x] 实现 PTY 视图中的用户接管与交还，同步操作说明
- [ ] 在 Windows 验证 monitor、hands-free、dispatch、CLI 预设、launchPolicy 与终端用户接管
- [ ] 核对各实际 CLI 版本的默认参数、选项结束标记、Pi fork 和 PTY 启动/接管，使用离线 provider 或受控流程避免付费模型依赖
- [x] Linux 实际 Pi 1.5.0 发布 CLI 使用离线 provider 验证 fork、复杂字面 prompt 与共享 PTY 接管/交还/离开，见 [实际 CLI 阶段](../../../finished/pi-suite/jobs/pi-cli.md)
- [x] Pi 原样前导 `@` 经原生 flag/input 桥接，Linux 验证默认 pipe、print/JSON、附件、fork 与 PTY reload/new 不重放及自然 quit，见 [原文初始任务阶段](../../../finished/pi-suite/jobs/literal-prompt.md)
- [x] Linux 实际 Codex 0.166.0/Claude Code 2.1.153 使用本地服务验证复杂字面 prompt、用户接管/交还、主对话输入与回复及确认停止，见 [文本 PTY 阶段](../../../finished/pi-suite/jobs/cli-pty.md)
- [x] Linux Codex exec_command 与 Claude Bash/Read 的实际工具结果、文件字节、自然退出及 Codex 独立工具进程组停止，见 [工具执行阶段](../../../finished/pi-suite/jobs/cli-tools.md)
- [ ] Windows/真实手机 CLI 工具执行与综合验收；Cursor 对应的 agent 命令尚缺环境

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
| agent | preset（pi、codex、claude、cursor 或配置中的自定义键）、prompt、fork?（pi 的持久会话），代替 command |

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

实现接口为 jobs.agents 的 `{command,args?}` 字段与 launchPolicy 的 `{command,decision}` 数组；即使省略策略也默认询问。匹配最终原始/CLI/monitor 命令，detector 命令单独授权；未确认不分配 ID、不启动进程。当前字段、默认参数、错误和操作见 [CLI 预设与启动授权](../../../current/jobs/launch.md)。

Pi 1.5.0 的真实发布 CLI 已在 Linux 使用隔离资源和 faux provider 验证：fork 保持源会话原文，复杂中文、引号、美元符号、反引号、换行与以 `--` 开头的 prompt 保持字面数据；新的真实 PTY 复用 attachJob 操作。前导 `@` 由原生 flag/input transform 桥接为初始正文，默认 pipe 通过 EOF 执行任务，附件、JSON 事件、fork 新身份、PTY 后续输入与 reload/new 不重放及自然 quit 通过 [原文初始任务阶段](../../../finished/pi-suite/jobs/literal-prompt.md)。Codex 0.166.0 与 Claude Code 2.1.153 已通过 Linux 隔离文本 PTY 验收：现有预设/JobManager 启动后，复杂初始 prompt、用户输入和交还后的模型输入逐字进入真实 CLI 主对话请求，SSE 回复在 CLI 显示，USER_CONTROL 与 managed_scope_confirmed 停止证据通过；任务标题和会话辅助请求与主对话区分，见 [文本 PTY 阶段](../../../finished/pi-suite/jobs/cli-pty.md)。Linux Codex exec_command 与 Claude Bash/Read 的受控真实工具执行和停止通过 [工具执行阶段](../../../finished/pi-suite/jobs/cli-tools.md)；Windows/真实手机组合尚未验收，Cursor 的 agent 命令缺失，各实际 CLI 的完整大项保持待办。

## 用户接管

PTY 终端视图中用户输入任意按键即接管：程序只接收用户输入，job_write 返回 USER_CONTROL 错误，hands-free 更新暂停。接管 hands-free 或 dispatch 会话后按 Ctrl+G 交还模型；Ctrl+B 退出视图转后台；Ctrl+T 把当前屏幕文本发送给模型。关闭视图不停止 job。快捷键可配置并写入操作说明。

[返回执行任务待办](index.md)
