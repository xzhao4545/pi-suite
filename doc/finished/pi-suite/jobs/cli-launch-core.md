# CLI 预设与启动授权基础阶段

目标：按上游保留范围，把 CLI 预设和用户级启动策略接入统一配置、ask 与 JobManager。

## 完成项

- [x] 从 pi-interactive-shell 0.18.0 提取默认预设、参数拼装与精确匹配规则；删除 worktree 和独立 /spawn，统一为 job_start.agent。
- [x] 支持 pi/codex/claude/cursor 与自定义键，逐键、逐字段合并 command/args，pi 使用当前持久会话的 --fork 参数。
- [x] Bash 字面量转义 prompt 与参数，添加选项结束标记，空白、中文、引号、美元符号、反引号和换行不作为 shell 代码。
- [x] 用户级 launchPolicy 精确匹配最终命令，deny > ask > allow；未命中默认 ask，项目级字段报错。
- [x] 全部 job_start 及 detector 通过共享 ask 队列授权，取消/超时/绑定撤销不启动进程，非交互模式需精确 allow；长期 manager 不保存授权 context。
- [x] Linux 离线验证配置合并与拒绝、实际 Bash argv、受控 CLI 启动和输出、Pi fork 参数、取消后目标停止自动续跑、monitor/detector 命令和 RPC 边界。

适用范围：Pi 1.5.0、Linux Node.js 24 环境；CLI 执行通过本地受控程序验证，不依赖付费模型。Windows 验收与各实际 CLI 版本的综合运行继续由 [监视与委派待办](../../../todo/pi-suite/index.md) 和 [完整实施计划](../design/implementation.md) 管理。

当前接口和操作见 [CLI 预设与启动授权](../../../current/jobs/launch.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

[返回完成索引](../../index.md)
