# Windows 模型与 @handle 原生入口组合

Windows Node 24.22.2、Pi 1.5.0 和 ConPTY 使用隔离配置与离线 faux provider 验证原生 `/agents`、`/agents types`、`@类型` 和 `@handle`。模型与 thinking 的实际 SDK 请求参数、run 记录和历史会话共同核对执行结果；受控 provider 用于确定请求边界，不代表远端模型服务的认证或推理质量验收。

`@类型` 使用父模型的内存克隆调用唯一的 agent_start，child 采用与 frontmatter 不同的类型模型/low。输入 `@pr` 同时出现类型与文件补全。已有实例的 `@handle` 引导进入后续 child 请求；120×40 缩为 40×24 后，通过实际原生菜单将运行中单 agent 改为另一模型/high，当前请求没有中断，下一次工具循环请求采用新值，父模型保持原值。

结束记录的 Model / thinking 改为原模型/medium 时，该历史 run 的实际模型保持不变，individual 保存新值。再次 `@handle` 恢复以及消费后回收内存 Execution 的持久恢复均读取 individual；新 run 沿用原 handle、sessionFile 与对话。显式启动参数覆盖类型配置，类型配置覆盖 frontmatter；移除类型覆盖后的执行使用 frontmatter 模型/off，各来源写入 parameter、individual、type 或 frontmatter。类型写回向 RPC、调度和 workflow 的传播复用 [Windows 基础阶段](../jobs/windows-runtime.md) 的已有证据。

`/new` 后补全不列出原会话的结束实例，`/resume` 回到原会话后恢复 handle 补全。撤销隔离 provider 的认证后，启动明确报告类型字段与 MODEL_UNAVAILABLE，不生成新 run、不发模型请求；类型模型选择仅保留 No override，不提供失去认证的模型。Esc 取消后未修改 Pi 全局 defaultModel。本阶段认证结论限于目录不可用的准入与原生选择，不涵盖远端 HTTP 认证失败。

稳定规则见 [模型配置](../../../current/agents/models.md) 与 [提及操作](../../../current/agents/operations.md#handle-提及)。本阶段未增加永久源码或测试。

[返回完成索引](../../index.md)
