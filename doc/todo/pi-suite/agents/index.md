# 子代理待办

目标：以上游 pi-subagents 为基础导入改造 subagent 执行、记录、查看、主从交互与扩展能力，接入统一工具、界面和通知。

当前状态：实施中；同进程执行、两池队列、核心类型、run 记录、恢复、工具/查看器、父级提问、任务共享与 job 级联停止已接入，Linux 8 项契约验收通过，见 [基础阶段](../../../finished/pi-suite/agents/core.md)；类型模型写回与单 agent 实时配置见 [模型基础阶段](../../../finished/pi-suite/agents/models-core.md)，扩展、技能、包资源与 memory 见 [资源基础阶段](../../../finished/pi-suite/agents/resources-core.md)。@handle 输入与克隆启动见 [提及基础阶段](../../../finished/pi-suite/agents/mentions-core.md)。定时调度见 [调度基础阶段](../../../finished/pi-suite/agents/schedules-core.md)。RPC 五通道见 [RPC 基础阶段](../../../finished/pi-suite/agents/rpc-core.md)。workflow 编排核心见 [核心阶段](../../../finished/pi-suite/agents/workflow-core.md)，宿主/工具/原生控制见 [宿主接入阶段](../../../finished/pi-suite/agents/workflow-host.md)。类型开关菜单与 Execution 回收见 [类型与回收阶段](../../../finished/pi-suite/agents/types-retention.md)，平台、workspace 全量历史发现与复杂竞争待验收。保留范围与按文件处置见 [上游导入](../upstream-import.md)。

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

默认后台运行：agent_start 立即返回 ID，结算后统一通知；background:false 时等待结算，期间父执行被 Esc 中断会停止该前台 child，后台 child 不受父执行 Esc 影响。每 60 秒回收结束超过 10 分钟且没有通知/reader/workflow 保留引用的 Execution，完整记录与结果移入既有 histories；持久会话仍可读取与恢复，非持久 transcript 释放后不可恢复，见 [当前回收规则](../../../current/agents/runtime.md#执行引用回收)。

配置并入共享配置 agents 节：display、maxConcurrent、maxConcurrentForeground、maxDepth、persistSessions、scheduling、workflows、defaultModel、types（按规范类型名的 enabled、model、thinking，由 TUI 写入，见 [模型与 thinking 配置](models.md)）等，按用户级默认与项目级覆盖合并。

[返回扩展包待办索引](../index.md)
