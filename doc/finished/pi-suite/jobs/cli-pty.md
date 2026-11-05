# 实际 Codex/Claude 文本 PTY 阶段

Linux 使用实际 Codex 0.166.0 与 Claude Code 2.1.153，经现有 mergePresets、agentCommand 与 JobManager 启动真实 PTY。Codex 采用隔离配置、本地 Responses SSE 服务与 `--no-daemon`；Claude 采用 `--bare`、空 settings/MCP/tools、本地服务和测试密钥，在 PTY 完成首次密钥确认。验收不依赖付费模型，也不执行 CLI 工具。

复杂初始 prompt 包含以 `--` 开头的中文、引号、`$()`、反引号和换行。初始正文、USER_INPUT 与交还后的 MODEL_INPUT 均逐字进入真实 CLI 主对话 HTTP 请求，CLI 显示对应 SSE 回复；后台任务标题和会话辅助请求与主对话区分，不能用辅助请求代替正文验收。用户接管期间模型写入返回 USER_CONTROL，交还后恢复输入；停止返回 managed_scope_confirmed，确认受管范围结束。两种 CLI 的隔离文本 PTY 验收通过。

适用范围仅为上述版本的 Linux 文本交互，不包含 CLI 工具执行、Windows 或真实手机 SSH；Linux 工具执行见 [后续阶段](cli-tools.md)。Cursor 对应的 `agent` 命令缺环境；Pi 1.5.0 前导 `@` 的原文支持仍受公开入口限制，现有 INVALID_ARGS 保持，未完成范围见 [监督与 CLI 待办](../../../todo/pi-suite/jobs/monitors.md)。

当前预设与授权见 [CLI 预设](../../../current/jobs/launch.md)，输入接管与交还见 [终端操作](../../../current/jobs/index.md#用户操作)。

[返回完成索引](../../index.md)
