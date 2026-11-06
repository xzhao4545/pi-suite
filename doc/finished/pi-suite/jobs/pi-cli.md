# 实际 Pi CLI 与终端接管阶段

Linux 使用实际 Pi 1.5.0 发布 CLI、隔离资源与 faux provider 验证一次真实 fork：源会话保持原文，模型收到原上下文及完整复杂 prompt，包含中文、引号、换行、美元符号、反引号和以 `--` 开头的文本。

新的真实 PTY 复用 attachJob 与已有终端查看器，在 40/60/120 列核对输入接管、USER_CONTROL 拒绝模型写入、Ctrl+G 交还和 Ctrl+B 离开后仍运行，最终清理确认。1 项实际 CLI 聚合验收通过，不使用付费模型。

Pi 1.5.0 将以 `@` 开头的位置 prompt 解析为附件，当前 pi 预设在启动前报告 INVALID_ARGS；原样 `@` 支持保留在 [监督与 CLI 待办](../../../todo/pi-suite/jobs/monitors.md)。Codex/Claude 的 Linux 隔离文本交互见 [实际文本 PTY 阶段](cli-pty.md)；CLI 工具执行、Windows 与真实手机组合仍未验收，Cursor 的 agent 命令缺失。

当前参数与操作见 [CLI 预设](../../../current/jobs/launch.md) 和 [终端操作](../../../current/jobs/index.md#用户操作)。

前导 `@` 原文桥、默认 pipe 与 reload/new 不重放的当前实现和后续验收见 [原文初始任务阶段](literal-prompt.md)。

[返回完成索引](../../index.md)
