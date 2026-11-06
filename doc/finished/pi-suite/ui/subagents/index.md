# Subagents 统一浏览布局

目标：`/subagents` 直接进入 Active 记录；页面导航、状态和范围放在顶部，记录列表不混入 Show queued 等菜单行。复用共享 BrowserView 与详情动作/确认能力，保留归属、只读与通知阻塞边界。

- [x] Runs、Types、Schedules、Workflows 页面保持统一导航；状态与范围独立切换。
- [x] 宽屏左右、窄屏上下展示，筛选、稳定记录身份与阅读位置在往返时保留，空结果仍能切换顶部控件。
- [x] Enter 直接打开会话/详情，底部动作按状态和权限变化，停止保留二次确认。
- [x] Types 显示启用状态、应用模型/思考强度与详细配置来源；配置动作移到底部。
- [x] 完成共享框架及实际命令的针对性验证，同步 [操作文档](../../../../current/agents/operations.md) 与 [界面文档](../../../../current/ui/index.md)，归档后提交。

实现复用 Pi SelectList 的 layout/truncatePrimary，保留运行状态/时长及类型模型/思考强度；共享 ActionBar 负责动态动作、选中反馈与确认。Runs 的状态/范围切换保留搜索和选中身份，Workspace 每次重新进入时发现外部历史；Types 保留无效模型的具体错误与修正入口；Workflows 的运行和保存资源各自保留阅读状态。菜单模块按命令懒加载，浏览与筛选不发起模型请求。

验证结论：类型检查与 38 项相关检查通过。Linux Pi 1.5.0 SDK 的实际命令覆盖 Active/Queued/Finished、当前会话/Workspace、Types 往返、Workflow Runs/Saved 往返、空结果导航和 40/60/120 列布局；取消排队只终止所选 run，运行中的另一个 child 保持执行。类型编辑、只读历史、job 日志、会话阅读/搜索、通知阻塞、生命周期与公共详情动作通过既有检查。

[返回已完成专项](../../../index.md)
