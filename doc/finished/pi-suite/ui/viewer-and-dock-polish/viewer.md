# UX-1：Subagent 全屏与主 footer 隐藏

## 需求与实施前根因（历史）

查看 Subagent 时应覆盖整个终端屏幕，不显示主会话的模型、上下文、token、goal 等 footer 状态信息。子代理自己的必要信息和操作仍放在查看器内，不以主会话 footer 冒充子代理状态。

当前 Subagent 是主会话上的 focused overlay，并不切换主会话绑定；`showAgent` 收起 Dock，StatusPublisher 与宿主原生/第三方 footer 仍属于主会话。公共阅读入口按模式采用 fullscreen 或居中 90%×70% overlay；“正文占满主会话 viewport”不能等同于“覆盖整个终端，包括 footer”。

## 实施契约

- Subagent Transcript 以终端完整列/行为尺寸来源，标题、正文、子代理信息、搜索/Editor 与动作栏统一预算，不保留主 footer 的可见行。
- 主会话为 fullscreen、inline 或普通模式时均核查原生独占全屏能力；不能把部分屏幕 overlay 当作实现。能力不足应扩展统一公共宿主框架，不接管 stdout、不在 Subagent 内另建终端 renderer。
- 优先通过原生全屏 overlay 的覆盖/可见性能力处理主 footer；若需临时隐藏，使用统一可恢复生命周期，保留原生及第三方 footer 的实例和配置，不替换或销毁它们。
- 进入 Details、Jobs、模型选择等子页及返回期间保持一致的 Subagent 阅读链全屏边界，不因嵌套页面恢复主 footer。
- 正常退出、异常关闭、resize、会话重绑均恢复主会话原 footer、焦点与视口；不能恢复错绑定或已销毁的界面。
- 不清除主会话状态数据，不切换执行 owner，不停止 child/job；后台状态仍正常更新，退出后显示最新状态。

## 任务与验收

- [x] 查明真实宿主中 footer 的布局/覆盖顺序，采用公共全屏与恢复机制。
- [x] 通过真实 TUI/xterm ANSI 输出验证 40×24、80×30、120×40 及动态缩放：查看期间无主 footer 残留，子代理正文和输入区可用；不作为实体人工终端验收。
- [x] 核查原生 footer 与第三方 footer、子页往返、正常/异常退出；关闭后恢复最新主状态且无焦点或订阅残留。
- [x] 同步 [agents 操作](../../../../current/agents/operations.md)、[统一界面](../../../../current/ui/index.md)与[终端操作](../../../../current/ui/terminal.md)，只记核实后的稳定行为。

[返回专项索引](index.md)
