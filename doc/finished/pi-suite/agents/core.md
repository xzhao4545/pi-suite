# 子代理执行与交互基础阶段

完成同进程 Pi child 执行、两池共享队列、独立 run ID、持久记录与历史结束叶子、恢复、共享任务清单、真实取消及所属 job 清理。agent_start/list/read/send/stop、共享 wait 和 /agents 接入公共框架；父级提问支持原 schema、非回答状态和直接父级归属。

上游来源与局部处置登记在 [UPSTREAM](../../../../third-party/UPSTREAM.md)，稳定行为维护在 [当前 agents 文档](../../../current/agents/index.md)。内置类型描述和提示词保留上游完整内容；队列、执行生命周期、frontmatter 核心与 custom entry 引用拆分导入改造，工具/通知/查看器使用本包规范。

Linux 离线 Pi 1.5.0 验收覆盖：两池队首阻塞与计数、排队停止、原生前台提问与回答、嵌套免占位、共享任务更新、恢复历史不混入后续消息、认证模型来源、真实 abort、问题超时和已结束 child 遗留 job 的选择性清理。

完整扩展/包资源选择、单个与类型模型配置界面、@handle、调度、workflow、RPC、回收及 Windows综合验收维护在 [agents 待办](../../../todo/pi-suite/index.md)。本阶段不代表该专项全部完成。
