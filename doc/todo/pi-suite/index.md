# Pi 自定义扩展包设计方案

状态：设计建议，尚未 fork 仓库或实现扩展。

目标环境：Windows、Ubuntu；手机通过 SSH 终端使用；以最新 Pi 为目标，实现时锁定实际验证过的版本。

当前状态：项目已建立 pnpm/TypeScript 扩展骨架；以下业务专项均待实施。此目录维护目标、约束、完整设计和验收计划。实现事实见 [doc/current](../../current/index.md)，完成专项记录见 [doc/finished](../../finished/index.md)。

影响范围：扩展入口、公共界面与运行时、ask、tasks、jobs、goal、agents，以及两个目标平台的验证与发布。

约束：复用 Pi 统一框架，保留设计细节；第一阶段完成同进程保活，跨进程保活另行评估；不添加多语言支持。

## 专项任务索引

- [ ] [扩展包架构与发布](architecture.md)
- [ ] [上游基线与参考来源](upstream-baseline.md)
- [ ] [统一面板布局](ui.md)
- [ ] [用户询问](ask/index.md)
- [ ] [两级任务管理与动态调整](tasks.md)
- [ ] [统一执行任务与保活](jobs/index.md)
- [ ] [目标状态与续跑](goal.md)
- [ ] [goal 状态栏联动与 pi-starship 兼容](goal-status.md)
- [ ] [公共状态栏摘要与活动数量](status.md)
- [ ] [子代理原生会话查看](agents.md)
- [ ] [子代理运行记录与手动控制](agent-runs.md)
- [ ] [实施顺序与验收](implementation.md)

## 验收与维护

验收场景和实施依赖见 [实施顺序与验收](implementation.md)。每个专项的任务清单、影响范围、约束和验收方式维护在对应文件。完成后按项目规则归入 finished，并同步 current；此索引不把设计能力描述为已实现能力。

[返回待办总索引](../index.md)
