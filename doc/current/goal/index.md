# 目标管理

goal 模块为每个主会话维护一份当前持久目标，同一会话的历史分支共用；生命周期为 active / paused / completed；界面统一派生进行中、等待中、已暂停、已完成。模型的一次运行与目标生命周期分别管理。modules.goal 决定是否加载；goal.display 接受 status、dock、hidden，默认 status。

- [单一当前状态存储](./storage.md) — 会话作用域、原子更新、分支共享、一次性导入与错误。
- [状态与宿主生命周期](./lifecycle.md) — 归属、用量、重试、压缩、会话恢复和通知。
- [请求上下文与自动续跑](./context.md) — 稳定目标说明、稀疏控制、统一通知与自动停跑。
- [接口与操作](./operations.md) — /goal、目标工具、预算与详情。

源码位于 src/goal，状态发布、会话绑定和继续请求复用公共 ui/runtime。来源契约为 @narumitw/pi-goal 0.54.15，许可证及重构范围见 [上游登记](../../../third-party/UPSTREAM.md)。

[返回当前文档](../index.md)
