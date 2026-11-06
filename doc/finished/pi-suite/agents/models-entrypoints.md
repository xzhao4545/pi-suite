# 类型模型配置与启动入口组合阶段

Linux Pi 1.5.0 使用多个认证 faux 模型，经实际 `/agents types` 命令与 40/120 列原生选择组件写入 model/thinking，不调用 reload；调度、workflow、mention 均通过真实 SDK child 请求核对实际模型、reasoning 参数及 record 来源。

- 调度：登记后修改类型配置，触发请求采用新模型/high，来源为 type；显式 schedule 启动参数采用另一模型/low，来源为 parameter。已准入请求未中断且保留原模型；撤销认证后触发明确报告 MODEL_UNAVAILABLE，无新 run 或替代模型，父会话可见错误。
- workflow：真实 Worker/Host 内新 child 读取当前类型配置，显式 model/effort 覆盖类型。运行中再次修改类型后，固定 resume 保留原 agent ID、模型/high、类型引用与 StructuredOutput schema；后续新 child 采用新模型/off。workflow 返回值与结构化恢复结果通过，父模型保持原值，结束后无活动 gate/job。
- mention：实际 interactive 输入 `@类型` 经父模型 clone 调用唯一 agent_start，child 采用类型模型/high；之后类型修改不影响运行中的请求。`@handle` 对结束记录恢复时采用新类型模型/off；原生 individual 编辑不改写历史实际模型，消费通知与 sweep 回收后从原 sessionFile 恢复采用 individual/medium。实际 agent_start 的显式模型/low 覆盖类型，父模型与 Pi 默认值保持原状。

本阶段复用现有共享配置、resolveSettings、普通 AgentManager 和原生 SDK，不新增源码或永久测试。验收使用本机受控 provider，不代表 Windows 原生操作完成。稳定行为见 [模型配置](../../../current/agents/models.md)，平台范围见 [模型待办](../../../todo/pi-suite/index.md)。

[返回完成索引](../../index.md)
