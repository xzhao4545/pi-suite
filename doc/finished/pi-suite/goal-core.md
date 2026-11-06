# 目标生命周期与状态摘要基础阶段

状态：已完成。

范围：分离持久目标与运行调度，接入真实 Pi 1.5.0 的最终结算、重试、压缩和会话操作；统一继续请求，保留用户控制与预算，联动 ask 非回答结果和状态发布。

完成内容：

- 稳定目标 ID、修订号、用量与进度持久化；当前分支恢复及旧绑定撤销。
- 正常结束单次继续，宿主重试成功/耗尽、手动/自动压缩及压缩取消的状态处理。
- Esc、暂停、恢复、清除、完成与显式预算；询问取消等待用户，过期工具和期限不改变新目标。
- reload、新建、恢复、fork 与树切换保持分支归属；通知批次合并并尊重宿主待处理工作。
- 单条 goal 摘要、原生 footer 行数与可见宽度；Starship 实际 extension_status 模块的读取、数量上限和空状态。

验收：Windows Node 24.22.2 与 Linux 现有 nvm Node 24.14.0 的类型检查和 27 项离线测试通过。模型生命周期使用真实 SDK 与 SDK 自带 faux provider，压缩摘要通过公开 hook 提供；原生 footer 核对 40、60、120 列。Starship 实际状态模块在 Windows 检查。日常检查在 5 分钟内。

完整 Starship footer 布局、真实手机 SSH 和后续 jobs/agents 的实际完成通知综合场景继续由 [状态栏计划](design/goal-status.md) 与 [实施计划](design/implementation.md) 管理，本阶段不把这些范围计为已验收。

稳定实现与操作见 [目标管理](../../current/goal/index.md)，许可证见 [上游登记](../../../third-party/UPSTREAM.md)。
