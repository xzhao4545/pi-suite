# Windows 剩余验收

本文件是 Pi Suite 活跃待办的唯一清单；这里只跟踪 Windows。手机 SSH 专项已取消；Linux 由用户后续在其他设备验收，不在本轮执行，也不阻塞 Windows 收尾。既有跨平台实现与 Linux 验收证据保留，不删除 Linux 代码或伪造其通过结论。

完整设计和按文件导入处置保存在 [设计与实施记录](../../finished/pi-suite/design/index.md)，不再以整篇设计文档充当待办。归档表示设计和实施记录移出活跃清单，不表示下列未验收内容已完成。当前实现见 [doc/current](../../current/index.md)。

Windows 本机可执行组合已验收并归档；实际 RPC 业务 consumer 为 pi-tasks 0.9.1，实际 MCP 为 Context7 4.5.0。当前只保留用户选择延期的 Cursor CLI 环境项，不能据此声明全部 CLI 已验收。

## 已有 Windows 证据

[Windows 阶段](../../finished/pi-suite/jobs/windows-runtime.md) 已记录类型检查、158 项完整检查，以及实际 Pi CLI 的缩放/接管/退出、类型模型写回、RPC 五通道、单次调度、workflow shell gate、日志查看/停止/历史删除；[后续 CLI/footer 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md) 补充实际 Codex/Claude 文本 PTY、Pi reload/new 与 footer 三尺寸验收。实际 Codex/Claude pipe 工具执行、文件字节与长工具清理也通过。原生询问/任务/模型/调度/workflow/历史、Pi 预设、实际业务 RPC 与 Context7、监督与输出的补充证据统一见 [完成索引](../../finished/index.md)，上游静态结论与运行层次见 [Windows 问题追踪](../../finished/pi-suite/windows-baseline.md)。

## 环境待办

- [ ] Cursor 实际 CLI 预设与工具/PTY 验收：当前缺少对应 agent 命令，用户选择保留环境待办，不在本轮安装。具备该环境后验证默认参数、字面正文、输入接管、自然退出与停止清理；不得以其他 CLI 替代通过。

## 维护规则

每完成一项，将证据与适用版本写入对应 finished 记录，稳定规则同步 current，再从本清单移除。未验证内容不得因完整检查通过或设计归档而勾选完成。不恢复手机 SSH 待办；Linux 后续验收由用户在目标设备单独安排。

[返回待办总索引](../index.md)
