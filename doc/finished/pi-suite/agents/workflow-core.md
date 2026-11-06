# 子代理 Workflow 编排核心阶段

从 @tintinweb/pi-subagents 0.23.0 导入编排 runtime、worker-source、progress、meta、journal、task、entry 与完整工具描述。上游 1219 行 runtime 按类型、边界辅助函数和运行闭包拆分；781 行 Worker 源码分三段拼接，仍运行于同一个词法作用域；551 行进度模块按类型、派生数据和格式拆分。运行闭包约 640 行，经评估保留控制、Worker 和结算的共享状态，避免为行数另造状态代理；所有文件低于 1000 行。

worktree 字段与 gate 提前执行钩子按确认范围删除，gate 使用宿主 cwd。保留结构化结果、单层嵌套、共用并发与预算、暂停/恢复/跳过/重试、按成功且未改变的 journal 前缀恢复和各项上限。metadata 补充真实的纯字面量语法检查，修正空 VM 仍能接受自包含计算的问题。重试与 gate 异常保留已经发生的用量；journal 读写失败和 Worker 事件回调错误明确结束运行，不静默回退。通知交给公共框架，工具描述保留用户明确要求编排或指定技能/保存 workflow 的使用前提。

6 项 Linux 检查使用真实 Worker，覆盖流水线无阶段屏障、嵌套阶段与并发、结构化结果及 gate、暂停期间排队/跳过/重试和用量累计；journal 成功前缀、变化和失败后的执行、schema 复核、会话 resume 的整段执行、文件损坏与显式 I/O 失败通过。JSON 与 metadata、确定性 globals、未支持选项、agent/item/nested 上限、未等待调用及无限循环 Worker 实际终止通过。完整离线检查和类型检查通过。

本阶段完成内部核心；`agent_workflow` 注册、宿主与保存资源、共享通知/等待、配置开关、原生查看和控制入口继续由 [扩展专项](../../../todo/pi-suite/index.md) 管理。稳定核心事实见 [编排核心](../../../current/agents/workflow/index.md)，来源与局部适配见 [上游登记](../../../../third-party/UPSTREAM.md)。
