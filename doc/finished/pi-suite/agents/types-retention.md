# 子代理类型开关与执行引用回收阶段

类型启用状态接入共享 agents.types.<规范类型名>.enabled，逐字段合并项目与用户覆盖，再读取 frontmatter 或默认 true。普通新执行、普通会话恢复、嵌套、调度、workflow 新 child 和 RPC 使用同一 catalog 准入；已准入执行与 workflow 固定 child resume 保留原类型、模型、工具和 schema 契约。

/agents types 的原生列表显示有效资源范围内的全部类型，包括 disabled 项；Enable、Disable、Use definition 和既有 Model / thinking 共用配置写回。enabled 独立于模型/thinking；Use definition 清除用户和项目两层的 enabled，回到定义。保存后刷新 @类型 补全与 workflow 动态类型说明，无需 reload；已有实例 handle、阅读入口和历史记录保留。

AgentManager 适配上游每 60 秒检查、结束 10 分钟回收的机制，将 settled Execution 移入已有 histories，保留完整 record/result/endLeafId/ancestors/handle/alias 与 job 归属。需要通知且未消费的结果、reader retain 引用及活动 workflow host 引用阻止回收；SDK 会话在执行结算时 shutdown/dispose，定期释放会话树、父级上下文、控制器和内存 transcript 的执行引用，不另建 tombstone 或历史存储。持久会话仍可查看与恢复；非持久 transcript 回收后返回 HISTORY_UNAVAILABLE，记录和结果仍可查询。

stop 仅合并正在进行的同范围操作，完成后的请求重新查询遗留 job，不复用已经完成的清理结果；job 清理失败仍等待 child 结算后报告错误，后续请求可重试清理。host.close 等待全部 stop 后汇总错误，失败时保留 AgentRecord 身份供 owner 再次清理，并释放 Execution 保留引用。workflow 嵌套未读结果在父执行仍可接收通知时保留，顶层 child 由 host 消费。类型菜单参考上游 agent-file-toggle 的操作语义，使用本包原生选择与统一配置；回收使用上游 agent-manager 的时间规则，保留约束与历史归属由公共 Manager 负责。具体来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

Linux（Node 24.22.2）新增 5 项聚合检查通过，覆盖配置来源与字段保持、真实 SDK 准入与固定续接、原生菜单及即时补全/说明、回收引用与非持久历史、清理失败后结算与重试。既有 runtime/workflow-host 用例复核持久历史回收后恢复、遗留 job 清理和 host 清理失败释放引用；类型检查与 125 项全量检查通过，全量耗时 12.51 秒。Windows、实际 CLI/手机 SSH 与综合竞争场景仍按对应专项验收。

当前类型配置和操作维护在 [类型、模型与 thinking](../../../current/agents/models.md)，回收与历史边界维护在 [执行与记录](../../../current/agents/runtime.md)。workspace 全量持久历史发现、原生查看器快捷控制、平台与复杂竞争验收继续由 [agents 待办](../../../todo/pi-suite/agents/index.md) 管理。
