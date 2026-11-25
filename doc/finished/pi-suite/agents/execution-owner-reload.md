# Subagent 与 Workflow 执行 owner 跨加载替换

## 目标与根因

agents 与 workflow 的进程级 owner 按 agentDir 存在 `Symbol.for('pi-suite.agents.runtime.v1')` 和 `Symbol.for('pi-suite.workflows.runtime.v1')` 槽位。此前 `/reload` 会无条件复用未关闭的 owner。AgentManager 的启动回调捕获创建时模块加载的 `loadConfig`，并缓存当时的 `runner.ts`、`child.ts`。Pi 长期运行、多次 reload 后，新工具驱动了先前加载的类与执行闭包。引入 `runtime.openAIResponsesAutoRecovery` 时，主会话已能读取带有该字段的配置，child 却因先前的 schema 拒绝该字段，报 `Invalid pi-suite configuration`。

## 实现

- 公共 `src/runtime/owner.ts` 每次模块加载生成独立 Symbol，槽位保存 `{implementation, owner}`。同一实现复用，空闲的其他实现关闭并替换，忙碌的其他实现保留以便现有工作结算并返回 stale 原因。原槽位格式无法报告是否忙碌，提示重启 Pi 一次。quit 通过 `existingOwner` 关闭当前槽位的 owner，支持对原槽位格式调用 `shutdown()`。
- 实现标识随加载生成，避免用依赖人工提升的协议版本识别 agents/workflow 实现。空闲替换会释放 `persistSessions: false` 的已结束 child 所保留的内存对话，持久记录、结果和会话文件可继续读取。
- Agents 的忙碌判断覆盖活动、排队与结算中的 run、进行中的停止清理、未读父级问题和尚未投递的普通结果。普通结果的消费标记存在内存中，顶层 workflow child 结果由 host 消费，嵌套结果只在其父级仍能接收时保留。
- Workflow 从写入初始快照到完成运行、暂停和结果结算都保留 owner。结算后的结果与通知标记由快照和父级记录恢复。Agents 的忙碌判断同时计入 workflow，Workflow 的 stale 同时继承 agents 的 stale。Workflow 的 owner 始终关联当前绑定选中的 AgentManager。
- AgentsModule 和 WorkflowsModule 绑定时各提示一次 stale 原因。新 `agent_start`、结束 run 的 `agent_send` 恢复、调度触发、RPC spawn、`@` 提及和查看器消息的新运行准入、workflow 启动及重放均受 `RUNTIME_UNAVAILABLE` 限制。活动 run 引导、父级回答、停止和结果投递继续使用既有 owner。Jobs 使用自身协议版本与受限控制桥。

## 验证

- SDK 契约覆盖忙碌实现复用、workflow 依赖保留 agents owner、新建与恢复拒绝、父级问题可回答、空闲替换和持久记录恢复。
- Linux 官方 Pi 1.5.0 CLI 用隔离配置启动，并在同一进程通过 `/reload` 替换空闲 agents/workflow owner。离线 child 使用包含 `runtime.openAIResponsesAutoRecovery` 的新 schema 与修改后的 runner 完成执行，Pi 正常退出。
- Linux 本机 Pi 1.5.2 用隔离配置启动，完成离线 child 与父级工具轮次后以状态 0 退出。类型检查和全量 246 项测试通过。

现行规则见[公共运行时](../../../current/runtime/index.md#会话和通知)、[子代理执行与记录](../../../current/agents/runtime.md)及 [Workflow 宿主](../../../current/agents/workflow/host.md)。
