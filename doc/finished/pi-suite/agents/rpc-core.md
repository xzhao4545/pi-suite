# 子代理 RPC 基础阶段

按上游 @tintinweb/pi-subagents 0.23.0 的 cross-extension-rpc.ts 导入改造请求处理，并从 index.ts 接入会话注册与生命周期。五个 subagents:rpc:* 通道、版本 2、按 requestId 的回复信封和无 data 的控制回复保留。SDK 启动等待、当前会话/分支与顶级归属复用公共 AgentManager，消费先于通知准入，后续消费可撤销公共通知；停止和引导不创建并行执行系统。

workflow/json-schema.ts 与 structured-output.ts 直接导入后局部调整错误报告和参数解析，执行器注入工具并保留一次纠正提示。cwd 配置根/目标目录信任分离、取消信号、绕过排队与分离运行的池归属按上游机制适配；未知与内部参数明确拒绝，活动追踪与 invocation 从公共记录派生，worktree 相关能力按项目范围删除。

4 项 Linux 真实 SDK/faux 与公共事件总线检查覆盖延后注册、重复绑定、reload 撤销/恢复、生命周期与用量事件、同步消费不触发父级请求、待发通知撤销、已结束引导拒绝、启动错误与模型/参数校验；排队即时返回、消息排队、信号取消、绕过满池、成功停止和嵌套/workflow/其他会话的归属拒绝通过。实际目标 cwd 保留父级扩展并禁止目标扩展执行，child 信任为 false；结构化结果的纠正提示、真实工具校验失败后修正和 JSON 结果保存通过。

Windows、实际外部扩展组合及 workflow 宿主接入继续由 [扩展专项](../../../todo/pi-suite/index.md) 验收。稳定协议见 [跨扩展 RPC](../../../current/agents/rpc.md)，来源与改动边界见 [上游登记](../../../../third-party/UPSTREAM.md)。
