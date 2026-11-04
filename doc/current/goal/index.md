# 目标管理

goal 模块维护一个主会话分支的持久目标，模型的一次运行与目标状态分别管理。modules.goal 决定是否加载；goal.display 接受 status、dock、hidden，默认 status。

- [状态与宿主生命周期](./lifecycle.md) — 归属、用量、重试、压缩、会话恢复和通知。
- [接口与操作](./operations.md) — /goal、目标工具、预算与详情。

源码位于 src/goal，状态发布、会话绑定和继续请求复用公共 ui/runtime。来源契约为 @narumitw/pi-goal 0.54.15，许可证及重构范围见 [上游登记](../../../third-party/UPSTREAM.md)。

[返回当前文档](../index.md)
