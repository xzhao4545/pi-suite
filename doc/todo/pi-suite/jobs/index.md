# 执行任务与保活待办

目标：统一交互和非交互任务管理，使后台执行与会话/UI 生命周期分离。

当前状态：待实施；当前扩展入口尚未注册执行工具或启动长期 manager。

影响范围：jobs、Windows/Linux 后端、日志、会话绑定和通知协调。

约束：pipe 与 PTY 分别处理；第一阶段只承诺同一 Pi 进程内保活，独立 supervisor 属于后续可选专项。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [ ] [统一执行任务管理](execution.md)
- [ ] [运行与历史记录、输入输出及手动停止](history-control.md)
- [ ] [同一 Pi 进程内保活](session-lifecycle.md)
- [ ] [可选跨 Pi 进程保活](persistent-runtime.md)

## 验收方式

Windows 和 Linux 分别核对执行、输入、日志、耗时、已结束历史、手动停止和同进程会话操作；跨进程恢复只在确认实施后按其支持范围验收。

[返回扩展包待办索引](../index.md)
