# 子代理 @handle 基础阶段

按职责导入 @tintinweb/pi-subagents 0.23.0 的 mention.ts、mention-clone.ts、ui/agent-mention.ts 与 index.ts 输入分发。语法、类型 slug、重名后缀、保留 main、agent- 前缀和原生补全包装接入本包 Manager、run 记录、配置与通知。

已有实例通过 agent_send 的回答/暂存/引导/恢复语义投递。首次类型提及保留父级当前分支与模型提示，在内存克隆中生成任务；克隆复用注册的 agent_start，只有一个启动工具且最多一次启动。frontmatter 前台选项保留，结果仍交给真实父级通知。未成功启动时报告错误；绑定生命周期取消克隆，防止切换后启动。每个 activation 只叠加一次补全包装，类型在绑定/发送时发现，实例状态保持动态。

3 项 Linux 真实 SDK/faux 与 Pi 原生补全契约检查通过，覆盖 handle/alias 唯一与持久恢复、会话归属、排队暂存、文件和命令补全并存及 CJK 前缀、重复绑定、克隆上下文与单工具/单启动、普通 run 与前台结果通知、活动引导与结束恢复、取消中的启动拒绝、明确失败、附件/非用户/print 输入边界，以及配置关闭。

Windows 输入组合由 [扩展专项](../../../todo/pi-suite/index.md) 继续验收；调度、workflow/RPC 与类型开关按原计划实施。稳定操作见 [agents 操作](../../../current/agents/operations.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。
