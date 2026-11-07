# Subagent 名称显示与 Dock Agents 分区

## 目标

界面统一以主 agent 为 subagent 设置的名称（agent_start.name，未设置时为类型 displayName/name）标识 subagent；Dock 的 Agents 分区显示名称与运行指标，标题行右侧显示数量。模型可见的工具正文与通知文本继续保留 agent_/run_ ID，供模型后续调用。

## 当前状态

- 普通 subagent 工具按名称显示；仅 ID 的调用只查询已有进程级 Manager 内存，未找到时显示 ID。wait 在渲染层替换逐项主标识与 pending，模型正文与通知保留 ID。pi-suite:notification 无专用消息 renderer，Pi 默认标题为 `[pi-suite:notification]`，不把 agent ID 当标题。
- Dock Agents 行（src/agents/index.ts rows）为 `agent <ID 后 8 位> <名称>`，右侧只有状态；没有运行时间、token 输入/输出与工具次数。分区标题只有 `Agents`，没有数量。
- AgentRecord 已有 name、elapsedMs、usage.tokens.input/output、toolUses、turns，可直接使用，不新增记录字段。

## 方案

### 名称优先

- UI 渲染（工具调用/折叠/展开行、wait 渲染、/subagents 列表与 transcript 标题、Dock、通知的显示渲染）以名称为主标识；ID 只在详情或 dim meta 中出现，便于与模型正文对照。
- 调用阶段只有 args.id 时，通过进程级 AgentManager 记录按 ID 查找名称；找不到（例如另一进程的历史）时显示 ID。查找只读内存记录，不读取磁盘。
- 模型正文（content、通知文本）保持现有 ID 格式，不改变工具契约。

### Dock Agents 分区

- 行格式：`<名称>`，右侧依次为 `<状态> · <运行时间> · ↑<输入 token> ↓<输出 token> · <工具次数> tools`；窄宽度先截断名称，再依次省略 token 与工具次数，状态始终可见。等待父级回答时状态为 `waiting(parent)`。
- 标题行右侧显示数量，例如 `Agents                       2 running · 1 queued`；只有一种状态时只显示该项。DockSource 增加右对齐标题字段（如 `count`/`aside`），Tasks、Jobs 等分区可复用。
- 运行时间与 token 随现有刷新订阅与 1 秒 ticking 更新，不额外写会话记录。

## 影响范围

- src/agents/render.ts、src/runtime/wait-render.ts、src/runtime/notifications.ts 的显示渲染（若有）、src/agents/index.ts（Dock 行）、src/ui/dock.ts（右对齐标题）、src/ui/status.ts
- 相关 current 文档：[agents 操作](../../../current/agents/operations.md)、[ui](../../../current/ui/index.md)、[模型工具契约](../../../current/runtime/tools.md) 的公共工具显示

## 验收

- 启动带 name 的 subagent 后，工具行、wait、Dock、/subagents 均显示名称；模型收到的正文仍含 agent_ ID。
- Dock Agents 行显示名称、状态、运行时间、输入/输出 token 和工具次数；标题行右侧显示数量；40 列下状态可见。

## 任务

- [x] 工具与 wait 渲染名称优先，按 ID 查找名称
- [x] Dock Agents 行显示名称与运行指标
- [x] DockSource 右对齐标题字段，Agents 显示数量
- [x] 更新 agents/ui/tools 当前文档（Dock 与工具显示部分已更新）


## 验收结论

Linux（Node 24）`pnpm typecheck` 通过，全量 `pnpm test` 181/181 通过，约 45 秒。界面渲染通过组件脚本在 40/120 列核对；实际 Pi CLI 交互未在本专项中单独验收。
