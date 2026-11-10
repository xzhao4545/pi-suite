# UX-2：Dock 未选择时优先展开 Tasks

## 需求与实施前根因（历史）

输入框上方的 Tasks、Agents、Jobs 列表未处于活动选择状态时，应优先展开可见 Tasks，Agents/Jobs 保留必要摘要。进入选择后，仍优先保证真实选中分区和对象可见。

当前 Dock 把活动选择与各分区最高行 priority 共同用于入场和额外行预算，未选择时额外空间归最高 priority 的分区。领域行的紧急程度因此同时决定默认展开对象，Tasks 没有独立的默认展开策略。

## 实施契约

- 无活动选择且 Tasks 有可见行时，优先为 Tasks 分配额外正文空间；窄屏/单行预算下也优先保持 Tasks 的有效摘要，不强行绘制完整树。
- 未选择指 `active` 为 false；仅保留上次 Agents/Jobs 的 selection 身份不应阻止默认恢复 Tasks 展开。
- 活动选择时所选分区与真实对象优先；↑↓、`[`/`]`、Enter、Esc/→ 和重新进入选择继续保留既有稳定身份与可达性。
- Tasks 不存在或按既有规则隐藏时，沿用其余分区的有效分配，不复活已完成任务反馈、不制造空 Tasks 区。
- 保留 Tasks 内部 doing/blocked/焦点组与子项的排序和裁剪规则，不修改任务数据、领域 priority 或完成判定来抬高整个分区。
- 保持分区显示顺序、总高度预算、选中等宽缩进及 Agents/Jobs 的必要状态；Ask/详情打开时仍按原有生命周期收起 Dock。

## 任务与验收

- [x] 在共享 Dock 中统一表达默认展开策略，与行优先级及活动选择分离。
- [x] 合并覆盖三分区并存、Tasks 缺失、窄预算、激活 Agents/Jobs 后退出与再次进入，确保真实选中项不被默认策略裁掉。
- [x] 核查动态任务/运行状态更新不会抢走活动选择；完成反馈结束后不额外显示 Tasks。
- [x] 同步 [任务操作](../../../../current/tasks/operations.md)、[agents 操作](../../../../current/agents/operations.md)及[统一界面](../../../../current/ui/index.md)。

[返回专项索引](index.md)
