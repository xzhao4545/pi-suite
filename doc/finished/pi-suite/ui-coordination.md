# 统一 Dock 与任务显示协调阶段

目标：在有限常驻预算中显示必要执行详情、任务进度与询问，并保持统一数据来源和阅读状态。

## 完成项

- [x] StatusPublisher.setActivities 同时接收活动 ID 与必要 Dock 详情；数量和详情分别检测变化，状态或问题变化不受相同数量限制，相同内容不重复重绘。
- [x] agents/jobs 通过既有 owner/branch 可见集提交待答、未确认清理、未消费失败、停止中、选中执行及普通活动行；问题已读但尚未回答时继续显示。查看入口保存选中 run/job，绑定撤销清除选择和详情。
- [x] 共享 Dock 优先分配父级/独立摘要，剩余行展开 child 并保持父子相邻；ANSI/中文安全截断保护完成比例、状态和隐藏数量。
- [x] tasks 显示选中组标记与 blocked 数量，最近更新只调整同类排序；doing/blocked/短暂完成子行按余预算展开，压缩摘要按实际子任务计算完成、doing 与 blocked。
- [x] ui.maxRows 包含本包在原生 footer 中增加的状态行，Dock 可为 0；询问期间最多保留一条必要 Dock 行，询问至少保留一条回答行。maxRows=1 且状态行占满预算时保留最低回答行是明确例外。
- [x] 既有任务界面聚合核对父子预算、阻塞完成与重新打开、选中稳定 ID、三种列宽、5 秒完成反馈及独立阅读快照；询问/详情继续使用公共焦点和通知阻塞机制。

适用范围：Pi 1.5.0、Linux（Node 24.22.2）离线 SDK 与原生组件检查。完整发布 footer 的并存范围见 [footer 联动阶段](footer-integration.md)；Windows 与真实手机 SSH 的滚轮、缩放和全部面板组合由 [统一界面待办](../../todo/pi-suite/ui.md) 验收。

稳定规则见 [统一界面](../../current/ui/index.md) 与 [任务操作](../../current/tasks/operations.md)。

[返回已完成专项](../index.md)
