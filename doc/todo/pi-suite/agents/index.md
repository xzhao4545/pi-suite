# 子代理待办

目标：以上游 pi-subagents 为基础导入改造 subagent 执行、记录、查看、主从交互与扩展能力，接入统一工具、界面和通知。

当前状态：实施中；同进程执行、两池队列、核心类型、run 记录、恢复、工具/查看器、父级提问、任务共享与 job 级联停止已接入，Linux 8 项契约验收通过，见 [基础阶段](../../../finished/pi-suite/agents/core.md)。完整资源选择、模型界面、调度/workflow/@handle/RPC 与回收待导入，平台与复杂竞争待验收。保留范围与按文件处置见 [上游导入](../upstream-import.md)。

影响范围：AgentManager、child 会话、agent_* 工具、/agents 命令、统一 dock、状态栏与通知。

约束：child 运行于同一 Pi 进程；查看不切换主会话；停止级联到嵌套 child 与所属 job；不保留 git worktree 隔离。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [ ] [原生会话查看](viewer.md)
- [ ] [运行记录与手动控制](runs.md)
- [ ] [主从交互](interaction.md)
- [ ] [扩展能力](extensions.md)
- [ ] [模型与 thinking 配置](models.md)

## 验收方式

按各专项核对启动、排队、后台与前台执行、恢复、嵌套、查看、提问转交、等待、停止级联、调度与 workflow；离线 faux provider 驱动，不依赖付费模型。

## 执行与并发

沿用上游的两个并发池与一个共享队列：后台池上限默认 10，前台池默认不限；队列按各自池的空位取最早项，避免前台饱和阻塞后台。槽位在启动时记录所属池，运行中修改上限不导致计数错乱；离开队列必须释放等待者。嵌套与 workflow 的 child 不占用池，避免父执行等待自己的 child 时死锁；调度触发绕过队列但计入运行数量。

默认后台运行：agent_start 立即返回 ID，结算后统一通知；background:false 时等待结算，期间父执行被 Esc 中断会停止该前台 child，后台 child 不受父执行 Esc 影响。结算超过 10 分钟的内存记录可以释放，保存的会话与记录仍可读取和恢复。

配置并入共享配置 agents 节：display、maxConcurrent、maxConcurrentForeground、maxDepth、persistSessions、scheduling、workflows、defaultModel、types（按类型的模型与 thinking，由 TUI 写入，见 [模型与 thinking 配置](models.md)）等，按用户级默认与项目级覆盖合并。

[返回扩展包待办索引](../index.md)
