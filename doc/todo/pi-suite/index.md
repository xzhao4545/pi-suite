# Windows 剩余验收

本文件是 Pi Suite 活跃待办的唯一清单；这里只跟踪 Windows。手机 SSH 专项已取消；Linux 由用户后续在其他设备验收，不在本轮执行，也不阻塞 Windows 收尾。既有跨平台实现与 Linux 验收证据保留，不删除 Linux 代码或伪造其通过结论。

完整设计和按文件导入处置保存在 [设计与实施记录](../../finished/pi-suite/design/index.md)，不再以整篇设计文档充当待办。归档表示设计和实施记录移出活跃清单，不表示下列未验收内容已完成。当前实现见 [doc/current](../../current/index.md)。

## 已有 Windows 证据

[Windows 阶段](../../finished/pi-suite/jobs/windows-runtime.md) 已记录类型检查、158 项完整检查，以及实际 Pi CLI 的缩放/接管/退出、类型模型写回、RPC 五通道、单次调度、workflow shell gate、日志查看/停止/历史删除；[后续 CLI/footer 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md) 补充实际 Codex/Claude 文本 PTY、Pi reload/new 与 footer 三尺寸验收。实际 Codex/Claude pipe 工具执行、文件字节与长工具清理也通过。重复覆盖部分不再另设平台待办；这些证据不替代尚缺的预设参数、原生操作或外部服务组合。

## 执行、输出与实际 CLI

- [ ] Windows 上游原问题复现记录：按 [基线](../../finished/pi-suite/design/upstream-baseline.md) 区分静态源码结论与真实运行结论；与下列场景共用证据，不另跑重复验收。
- [ ] Windows 终端监督组合：monitor 三种策略、阈值/冷却/生命周期、hands-free 增量预算、dispatch 宽限期/静默完成、launchPolicy 授权/拒绝/取消，以及终端接管后拒绝模型写入、交还后恢复。现有组件与受控进程检查已通过，剩余为实际 CLI 组合。见 [监督设计](../../finished/pi-suite/design/jobs/monitors.md)。
- [ ] Windows 输出与终端边界综合复核：大日志/单长行、UTF-8 分页、search/context 与原始 offset、预算/续读提示、密码隐藏/横向重绘/全屏线性片段与当前/最后屏幕；不要求 reader 还原二维历史。核对停止竞争/重复停止、已结束/foreign 历史只读及清理未确认入口。见 [输出设计](../../finished/pi-suite/design/jobs/output.md) 与 [历史控制](../../finished/pi-suite/design/jobs/history-control.md)。
- [ ] Cursor 实际 CLI 预设与工具/PTY 验收：当前缺少对应 agent 命令，用户选择保留环境待办，不在本轮安装。具备该环境后验证默认参数、字面正文、输入接管、自然退出与停止清理；不得以其他 CLI 替代通过。

## 维护规则

每完成一项，将证据与适用版本写入对应 finished 记录，稳定规则同步 current，再从本清单移除。未验证内容不得因完整检查通过或设计归档而勾选完成。不恢复手机 SSH 待办；Linux 后续验收由用户在目标设备单独安排。

[返回待办总索引](../index.md)
