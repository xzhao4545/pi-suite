# Subagents 与 jobs 列表、Types 展示

## 命令命名

- [ ] 将用户命令 `/agents` 及其子命令改为 `/subagents`。

现状：`src/agents/viewer.ts` 的 `registerAgentsCommand` 注册 `agents`，支持状态、workspace、types、schedules 与 workflows 入口。工具描述、调度提示和当前操作文档也包含该入口。

方案：统一注册名、补全说明、运行时提示和当前文档中的命令示例，函数名按职责同步调整。目标入口为 `/subagents [active|queued|finished|all]`、`/subagents workspace [状态]`、`/subagents types`、`/subagents schedules`、`/subagents workflows`。不保留 `/agents` 别名；`agent_*` 工具、`modules.agents` / `agents.*` 配置、资源目录与 `subagents:*` 事件保持各自协议含义，不进行全仓字符串替换。`doc/finished` 中的历史记录不改写。

验收：命令菜单、直接输入各子命令和提示中的入口一致；模块关闭时不注册 `/subagents`，已有类型、调度和 workflow 功能可达。

## 列表筛选与右侧详情

- [ ] agents/jobs 列表支持输入筛选，选中项变化时右侧立即显示详情。
- [ ] 运行信息实时更新，退出详情后保留筛选词、选中身份及阅读位置。
- [ ] 同时覆盖 session/workspace 列表与 agent 所属 jobs 列表，保留各自范围和控制权限。

### 已确认的问题

- `src/agents/viewer.ts` 普通列表调用 `ctx.ui.select`；workspace 和所属 jobs 使用 `src/ui/select.ts` 的 `selectValue`。`src/jobs/viewer.ts` 的 `pickJob` 同样使用普通选择菜单，最多取一页 20 条。两条路径均没有输入框或右侧预览，普通路径还以显示文本反查对象。
- Pi 的 `SelectList` 已支持分页与选中变化通知，但 `setFilter` 仅按 `value` 前缀过滤；直接接入不能实现名称、命令、模型等多字段搜索。
- 当前列表显示的是取数时的快照。两种 Manager 已能给出运行耗时，agent 的 `toolUses` 已由 runner 在工具开始执行时累计；缺少的是统一展示和浏览期间的刷新。
- `AgentRecord.usage` 记录本次 run 的累计 token 消耗和费用，不是当前上下文占用。记录尚无独立的上下文统计快照，不能把累计 tokens 当作上下文大小。

### 交互方案

扩展 `src/ui` 公共选择框架，组合 Pi 的 `Input`、`SelectList`、`fuzzyFilter`、可见字符宽度处理与已有 `ScrollView`。公共组件负责输入、选择、左右布局、焦点和滚动；agents/jobs 仅提供稳定 ID、摘要、可搜索字段、详情与动作。详情与日志仍复用 `DetailsView`、`Transcript` 和现有控制入口。

宽终端采用顶部筛选、左侧列表、右侧可滚动详情、底部操作提示；窄终端改为上下布局或显式详情页，保证所有字段可读。输入区默认接收普通文字，方向键选择、PgUp/PgDn 翻页，Tab 切换筛选/列表/详情焦点，Enter 打开已有操作，Esc 逐层返回。输入文字时不得触发停止等动作。空结果明确显示，并可继续修改查询。

筛选字段：agent 的 ID/runId、名称、类型、状态、模型及任务说明；job 的 ID、名称、状态、命令和 cwd。按当前 scope/state 的完整可见集合筛选后分页，不只过滤当前 20 条。jobs 在 `src/jobs/query.ts` 的既有查询路径中扩展筛选，继续复用会话可见集合和历史合并规则；筛选不需要扩张模型工具参数。大型历史仅搜索摘要元数据，不逐项读取完整日志或 transcript。

列表身份使用 agent 的 `runId` 和 job 的 `id`，避免重名、文本截断或状态变化选错对象。刷新与切换详情保留筛选和选中身份；选中项因筛选或状态改变移出列表时，移动到相邻有效项并更新详情。workspace 外部历史保持现有只读边界。

### 详情字段与统计口径

| 对象 | 右侧展示 | 数据来源与口径 |
| --- | --- | --- |
| agent | 名称、类型、ID/runId、状态、任务说明、cwd、开始/结束时间、运行时长 | 既有 `AgentRecord` 与 Manager view；运行时长取本次 run，排队时单独标识等待时长，结束后固定 |
| agent | 实际模型、思考强度及来源 | 当前 run 的 `model`、`thinking` 与来源字段；不拿现时 Types 配置覆盖历史事实 |
| agent | 上下文占用 / 模型窗口、占比 | 活动 child 的 `AgentSession.getContextUsage()`；沿用 SDK 的估算及未知值语义，压缩后未知显示“未知”，不显示成 0 |
| agent | 工具调用次数 | `toolUses`，按本次 run 的 `tool_execution_start` 计数；包含失败调用，不与继承会话的历史调用混算 |
| job | 名称、ID、状态、运行时长、完整命令、cwd、pipe/PTY、退出结果、清理状态、创建者 | 既有 `JobSummary`、Manager view 和 `jobDetail`；命令作为字面量换行/滚动显示，预览不能沿用 2000 字符的摘要截断 |

上下文统计在现有 runner 的合适事件边界与关闭 child 前更新并保存到既有 record，扩展相应类型/schema 和历史读取，不另建数据库。持久历史显示该 run 的最后快照；没有记录的历史明确标记不可用，不为补齐显示重启 child 或从累计 token 猜测。模型切换、压缩和 run 恢复使用同一统计路径。

浏览时订阅既有 Manager 变化，合并高频流事件后刷新；仅在可见活动项需要推进时长时使用低频计时刷新。时钟刷新不扫描会话树、历史目录或日志。上下文统计按相关事件缓存，避免每次 token 流更新重算全部会话。关闭 UI 释放订阅、计时器与 retain，通知占用遵循现有 `Notifications.hold`。

验收：超过一页的记录可按名称/命令检索；运行中切换状态、同名记录、多次 run 和异步刷新不串项；不进入操作页即可读到要求字段。长命令、中文和窄屏不越界；详情返回保留位置。工具计数、压缩后的未知上下文、结束快照与运行时间口径正确，历史读取不取得控制权。

## Types 展示

- [ ] Types 列表显示类型名、启用状态、当前上下文中默认启动会应用的模型与思考强度。
- [ ] 顶层菜单标签改为 `Types`，删除 `· enable / model / thinking`；进入后的设置动作仍保留。

现状：`src/agents/model-editor.ts` 的 `showAgentTypes` 仅拼接类型名和 enabled/disabled。类型和启动设置已有 `agentTypes` / `resolveSettings`，但列表没有调用设置解析。顶层冗长文案来自 `src/agents/viewer.ts` 的硬编码字符串。

方案：无本次调用参数及 individual 覆盖时，复用 `resolveSettings` 展示类型配置 → frontmatter → 默认模型 → 父级继承的有效结果；thinking 按对应优先级解析，再复用 Pi 的模型能力约束得到实际可用级别。示例：`reviewer · enabled · provider/model-id · high`。详情显示模型/thinking 各自来源；继承值标明继承，随父级设置重新解析。不要只展示类型文件或配置文件中的原始 model/thinking。

某个类型配置的模型不可用或有歧义时，该行显示具体配置问题并允许进入修正；不能静默替换模型，也不能让一个错误类型阻止整个列表打开。disabled 类型仍显示，保留重新启用能力。保存模型/thinking 后刷新展示；不得为了预览创建真实 agent 会话。

验收：配置覆盖、frontmatter、默认模型、父级继承、模型限制和不可用模型的展示与新执行解析一致；菜单仅显示 `Types`，配置动作完整保留。

关联当前文档：[agents 操作](../../../current/agents/operations.md)、[模型与类型](../../../current/agents/models.md)、[执行任务](../../../current/jobs/index.md)、[统一界面](../../../current/ui/index.md)、[持久历史](../../../current/agents/history.md)。

[返回需求清单](index.md)
