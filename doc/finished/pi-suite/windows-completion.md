# Windows 验收收尾

本文件保存 Pi Suite Windows 验收收尾记录。手机 SSH 专项已取消；Linux 由用户后续在其他设备验收，不在本轮执行，也不阻塞 Windows 收尾。既有跨平台实现与 Linux 验收证据保留，不删除 Linux 代码或伪造其通过结论。

完整设计和按文件导入处置保存在 [设计与实施记录](design/index.md)，设计细节保留。当前实现见 [doc/current](../../current/index.md)，新增需求维护在 [待办索引](../../todo/index.md)。

Windows 本机可执行组合已验收并归档；实际 RPC 业务 consumer 为 pi-tasks 0.9.1，实际 MCP 为 Context7 4.5.0。2026-11-06，用户取消本轮 Cursor CLI 验收并移除该待办；Cursor 实际 CLI 未经本轮验证，不计为通过项。

## 已有 Windows 证据

[Windows 阶段](../../finished/pi-suite/jobs/windows-runtime.md) 已记录类型检查、158 项完整检查，以及实际 Pi CLI 的缩放/接管/退出、类型模型写回、RPC 五通道、单次调度、workflow shell gate、日志查看/停止/历史删除；[后续 CLI/footer 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md) 补充实际 Codex/Claude 文本 PTY、Pi reload/new 与 footer 三尺寸验收。实际 Codex/Claude pipe 工具执行、文件字节与长工具清理也通过。原生询问/任务/模型/调度/workflow/历史、Pi 预设、实际业务 RPC 与 Context7、监督与输出的补充证据统一见 [完成索引](../../finished/index.md)，上游静态结论与运行层次见 [Windows 问题追踪](../../finished/pi-suite/windows-baseline.md)。

## 维护规则

完成项的证据与适用版本写入对应 finished 记录，稳定规则同步 current。未验证内容不得因完整检查通过或设计归档而计为通过。不恢复手机 SSH 待办；Linux 后续验收由用户在目标设备单独安排。

[返回完成索引](../index.md)
