# 执行任务与保活待办

目标：统一交互和非交互任务管理，使后台执行与会话/UI 生命周期分离。

当前状态：实施中；执行工具、长期 manager、pipe/PTY 后端、记录、通知、同进程保活、monitor、hands-free/dispatch、CLI 预设与有界实时日志查看已实现。基础后端通过 Windows/Linux 离线检查，监督、预设与日志查看通过 Linux 离线检查；各专项仍保留尚未完成的平台与综合验收。实现以上游 pi-background-jobs 与 pi-interactive-shell 源码导入改造，按文件处置见 [上游导入](../upstream-import.md)。

输出密码回显隐藏、横向重绘、全屏提示与有限完成预览、实际 Pi CLI、Codex/Claude 文本 PTY 和包技能已通过 Linux 分阶段验收，见 [输出组合](../../../finished/pi-suite/jobs/output-core.md)、[实际 Pi CLI](../../../finished/pi-suite/jobs/pi-cli.md)、[Codex/Claude 文本 PTY](../../../finished/pi-suite/jobs/cli-pty.md) 与 [技能发布](../../../finished/pi-suite/jobs/skill.md)。[超长单行](../../../finished/pi-suite/jobs/long-line.md) 与 [屏幕支持范围](../../../finished/pi-suite/jobs/screen-range.md) 已明确完整正则和屏幕读取的资源/呈现边界；Pi leading @ 原样支持、CLI 工具执行、Cursor 环境及平台组合继续保留在对应专项。

影响范围：jobs、Windows/Linux 后端、日志、会话绑定和通知协调。

约束：pipe 与 PTY 分别处理；第一阶段只承诺同一 Pi 进程内保活，独立 supervisor 属于后续可选专项；工具按 [统一工具设计](../../../finished/pi-suite/tool-design.md)。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [ ] [统一执行任务管理](execution.md)
- [ ] [运行与历史记录、输入输出及手动停止](history-control.md)
- [ ] [输出读取、搜索与截断](output.md)
- [ ] [监视、hands-free 与 dispatch](monitors.md)
- [ ] [同一 Pi 进程内保活](session-lifecycle.md)
- [ ] [可选跨 Pi 进程保活](persistent-runtime.md)

## 验收方式

Windows 和 Linux 分别核对执行、输入、日志、耗时、已结束历史、手动停止和同进程会话操作；跨进程恢复只在确认实施后按其支持范围验收。

[返回扩展包待办索引](../index.md)
