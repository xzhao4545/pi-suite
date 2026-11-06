# 子代理待办

目标：以上游 pi-subagents 为基础导入改造 subagent 执行、记录、查看、主从交互与扩展能力，接入统一工具、界面和通知。

归档范围：保留已实施设计及原验收证据，不表示所有平台已通过。剩余 Windows 验收统一维护在 [Windows 待办](../../../../todo/pi-suite/index.md)；Linux 后续由用户在其他设备处理，不阻塞 Windows；手机 SSH 专项已取消。

当前状态：实施中；同进程执行、两池队列、核心类型、run 记录、恢复、工具/查看器、父级提问、任务共享与 job 级联停止已接入，Linux 8 项契约验收通过，见 [基础阶段](../../agents/core.md)；类型模型写回与单 agent 实时配置见 [模型基础阶段](../../agents/models-core.md)，扩展、技能、包资源与 memory 见 [资源基础阶段](../../agents/resources-core.md)。@handle 输入与克隆启动见 [提及基础阶段](../../agents/mentions-core.md)。定时调度见 [调度基础阶段](../../agents/schedules-core.md)。RPC 五通道见 [RPC 基础阶段](../../agents/rpc-core.md)。workflow 编排核心见 [核心阶段](../../agents/workflow-core.md)，宿主/工具/原生控制见 [宿主接入阶段](../../agents/workflow-host.md)。类型开关菜单与 Execution 回收见 [类型与回收阶段](../../agents/types-retention.md)；workspace 持久历史发现与只读查询见 [历史发…

影响范围：AgentManager、child 会话、agent_* 工具、/agents 命令、统一 dock、状态栏与通知。

约束：child 运行于同一 Pi 进程；查看不切换主会话；停止级联到嵌套 child 与所属 job；不保留 git worktree 隔离。

相关当前文档：[项目当前状态](../../../../current/index.md)。

模型配置在调度、workflow 与 @handle 的 Linux 实际请求、来源与恢复组合通过 [入口组合阶段](../../agents/models-entrypoints.md)，Windows 组合仍由 [模型专项](models.md) 管理。

## 任务列表

- [x] [原生会话查看与快捷控制](../../agents/viewer-controls.md)
- [x] [运行记录与手动控制](../../agents/runs.md)
- [x] [主从交互](../../agents/interaction.md)
- [扩展能力](extensions.md)
- [模型与 thinking 配置](models.md)

## 验收方式

按各专项核对启动、排队、后台与前台执行、恢复、嵌套、查看、提问转交、等待、停止级联、调度与 workflow；离线 faux provider 驱动，不依赖付费模型。

## 执行与并发

沿用上游的两个并发池与一个共享队列：后台池上限默认 10，前台池默认不限；队列按各自池的空位取最早项，避免前台饱和阻塞后台。槽位在启动时记录所属池，运行中修改上限不导致计数错乱；离开队列必须释放等待者。嵌套与 workflow 的 child 不占用池，避免父执行等待自己的 child 时死锁；调度触发绕过队列但计入运行数量。

默认后台运行：agent_start 立即返回 ID，结算后统一通知；background:false 时等待结算，期间父执行被 Esc 中断会停止该前台 child，后台 child 不受父执行 Esc 影响。每 60 秒回收结束超过 10 分钟且没有通知/reader/workflow 保留引用的 Execution，完整记录与结果移入既有 histories；持久会话仍可读取与恢复，非持久 transcript 释放后不可恢复，见 [当前回收规则](../../../../current/agents/runtime.md#执行引用回收)。

原生查看与快捷控制通过 Linux 离线验收，消息输入、两次停止、真实前台调用转后台、流式工具配对和组件缓存见 [查看器阶段](../../agents/viewer-controls.md)；Windows 组合留在 [扩展专项](extensions.md)。

配置并入共享配置 agents 节：display、maxConcurrent、maxConcurrentForeground、maxDepth、persistSessions、scheduling、workflows、defaultModel、types（按规范类型名的 enabled、model、thinking，由 TUI 写入，见 [模型与 thinking 配置](models.md)）等，按用户级默认与项目级覆盖合并。

[返回扩展包待办索引](../index.md)
