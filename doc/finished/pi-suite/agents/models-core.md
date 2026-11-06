# 子代理模型配置基础阶段

完成类型模型/thinking 选择与逐字段配置写回、单 agent 下一请求修改、持久 individual 恢复、认证来源错误，以及选择取消后的 transcript 阅读状态保留。

界面复用 Pi 原生 SelectList 和公共主题，能力列表来自 pi-ai，模型目录来自父级 ModelRegistry；单 agent 使用 Pi SDK setModel/setThinkingLevel，不写全局默认。新增界面与写回属于本项目需求，模型匹配与启动优先级按上游逻辑适配。

Linux 的 5 项契约检查覆盖实际 /agents 命令与 agent_start 工具、新旧执行独立、当前请求不中断/下一请求切换、恢复与历史模型不被改写、认证丢失、40/120 列选择与阅读、取消不写入、逐字段定位、项目删除后用户值生效，以及无效文件不覆盖。

调度/workflow/@handle 的 Linux 综合入口验证见 [入口组合阶段](models-entrypoints.md)，Windows 继续留在 [模型专项](../../../todo/pi-suite/index.md)。当前稳定规则见 [模型配置](../../../current/agents/models.md)。
