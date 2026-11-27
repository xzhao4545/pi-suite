# 工具与原生操作

## agent_workflow

只有主会话可以调用，child 调用时报错。

| 参数 | 说明 |
| --- | --- |
| `script` / `scriptPath` / `name` | 三选一：内联脚本、脚本文件路径或保存的 workflow 名称 |
| `args?` | 任意 JSON 值，原样传给脚本 |
| `resumeFromRunId?` | `wf_` 加 12 位十六进制，见 [恢复运行](#恢复运行) |

工具总在后台启动运行。初始文件写入后立即返回摘要行（含 workflow ID）、最后一条日志和 `resultPath`；details 包含 `id`、真实`status`、`scriptPath`、`resultPath` 与 `resumedFrom`。运行结束时通过统一通知告知模型。

工具描述（`src/agents/workflow/tool-description.ts`，约 1 KB）只写调用前提、参数、后台返回与完成通知，并要求编写或修改脚本前先读 `pi-suite-workflow` skill。调用前提：用户明确要求 workflow/编排、用户调用的 skill 或命令要求使用该工具，或要求运行保存的 workflow；其余情况使用 agent_start，或先说明方案与大致成本并征求同意。绑定会话时描述末尾填入当前启用的 agent 类型名称，不附类型说明；完整说明见 `/subagents types`。

脚本编写指南位于 [`skills/pi-suite-workflow/SKILL.md`](../../../../skills/pi-suite-workflow/SKILL.md)，内容包括脚本格式、全局函数与选项、限制与非安全沙箱边界、pipeline 与 barrier 的选择、常用模式和 journal 恢复；工具描述不重复这些内容。`package.json` 的 `pi.skills: ["./skills"]` 通过 Pi 的技能发现发布该指南，系统提示只列名称、说明与路径，正文按需读取。

## 工具行与等待

- 折叠、展开与错误显示使用[公共工具行](../operations.md#工具显示)。Workflow 展开项包括脚本或 `scriptPath`、`resultPath`、阶段、child、尝试、日志和完整结果；用量行显示 tokens、tools 和 replayed 计数。
- `wait({"ids":["wf_…"]})` 使用[公共等待规则](../../runtime/tools.md)。运行结束后用 `read` 读取 `resultPath` 获取完整输出。

## /subagents workflows

页面标题为 `Subagents ▸ Workflows`，只列当前会话与分支的内容。数字键、`[`/`]` 或 ←/→ 切换 Subagents 页面，边界行为见 [Subagents 操作](../operations.md#subagents)。

| 视图 | 内容与操作 |
| --- | --- |
| Runs | 按开始时间倒序，右侧预览进度；Enter 打开运行详情 |
| Saved | 保存的 workflow；`/` 按名称筛选，右侧预览源码；Enter 查看源码，`n Start` 输入 JSON args 后启动（留空表示不传 args） |

- 顶部 `s View` 在 Runs 与 Saved 之间切换。两个视图分别保留筛选、选择与阅读位置，往返其他页面时保持当前视图。
- 列表默认焦点在列表上：`/` 进入筛选，Tab 进入详情，Esc 返回列表；页面标签和筛选不在焦点循环内。

### 运行详情

运行详情显示名称、说明、状态、agent 进度、阶段、实际模型/thinking、尝试原因、用量、提示与结果预览、错误、日志和最终结果。metadata 声明的阶段按标题精确匹配；没有阶段的 agent 归入单独的 Agents 分组。

| 动作 | 可用时机 | 行为 |
| --- | --- | --- |
| p Pause / Resume | 运行中 / 已暂停 | [暂停或解除暂停](index.md#控制与预算) |
| x Stop | 运行中或已暂停 | 首次显示 `Press x again to stop`，再按 x 取消 Worker、child 与所属 job 并等待[清理结果](host.md#取消与清理)；按其他键取消确认，Enter 只打开 |
| r Replay journal | 已结束且有 journal | 用保存的脚本副本和原 `args` 新建运行；见[恢复运行](#恢复运行) |
| Enter Open children / gates | 总是 | 选择一个 child 行，再选择下表动作 |

| Children / gates 动作 | 行为 |
| --- | --- |
| Transcript | 用公共 child Transcript 查看会话 |
| Gate stdout / Gate stderr | 用公共 job 查询与日志查看器读取当前或已持久化的 gate 输出 |
| Skip | 排队或运行中的调用，脚本收到 null |
| Retry | 运行中的调用：停止当前尝试并重跑，脚本继续等待原调用 |

- 动作随运行状态实时更新：运行结束后 Pause、Resume、Stop 消失，Replay journal 出现，无需重新打开。
- 在 child Transcript 中，Message 只用于回答当前主会话可见的挂起问题，其他引导与恢复由 workflow 控制；x 两次停止所选 child 及其子树，搜索与输入中的文字按键不触发停止；workflow child 没有 b 转后台。完整阅读键位见 [agents 操作](../operations.md#subagents)。

### 阅读

- 运行详情、child Transcript 与 gate 日志共用同一个阅读 overlay：fullscreen 时满屏，否则居中 90% 宽。从 Subagent 阅读链进入时沿用全终端覆盖并隐藏主 footer，正文与 overlay 共用高度上限。
- ↑↓、PageUp/PageDown、Home/End 滚动；`/` 搜索，n/N 下一项/上一项；动作按显示的键直接执行，Enter 打开 Children / gates，Esc 返回。
- 从 child 会话、gate 日志或控制操作返回后，详情保留原阅读与搜索位置。
- 查看器复用原生 Text、DetailsView、ScrollView、阅读 overlay 和值选择，正文按共享预算切片/补齐，不显示 scrollbar。child Transcript 保留原生消息/工具实例，`o` 展开全部工具，`h` 切换 thinking；该 overlay 不保证单个工具的鼠标命中和 scrollbar 拖动，见 [终端交互边界](../../ui/terminal.md#原生阅读与鼠标)。gate 日志使用独立字节窗口。
- 菜单值使用运行 ID 与 agent index，长名称截断显示不影响选择。浏览期间公共通知阻塞令牌保持阅读不被打断。

## 恢复运行

目标必须已结束、有 journal，且在当前主会话的当前分支可见。以下情况拒绝启动：

| 原因 | 错误 |
| --- | --- |
| 运行 ID 未知、目标仍在运行或暂停、或目标没有 journal | `INVALID_ARGS` |
| 已知目标位于其他会话或分支 | `NOT_OWNER` |
| journal 读取失败或损坏 | 附读取或解析错误；未写完的末行例外，见 [Journal 恢复](index.md#journal-恢复) |

含 child 会话 resume 的 journal 按[编排与 journal](index.md)的完整执行规则处理。

## 开关与冲突

- `agents.workflows` 默认 true，控制 agent_workflow 与菜单入口。初始为 false 时不注册工具，之后绑定时按配置注册。关闭后执行 `/reload`；已有运行的 owner 与运行文件按生命周期保留。
包资源开关见[保存资源](host.md#保存资源)。

绑定会话时检查其他扩展注册的 `agent_workflow`、`SubagentWorkflow`、`Workflow` 或 `workflow` 工具（名称精确匹配，描述与本工具不同）。是否“显式开启”看项目 `.pi/pi-suite.json`（优先）或用户 `<agentDir>/pi-suite.json` 中的 `agents.workflows` 是否为 `true`。

| 情况 | 未显式开启 | 显式开启 |
| --- | --- | --- |
| 另一扩展的工具名不同 | 本扩展 workflow 在本会话停用，工具移出活动工具，警告来源 | 两个工具并存 |
| 另一扩展先注册了 `agent_workflow` | Pi 只保留先注册者；本扩展 workflow 停用并警告来源 | 仅警告来源，提示停用其中一个扩展 |

设置 `true` 不能解决同名冲突。移出活动工具只影响本工具：由本扩展移出的选择在重新启用时恢复，用户手动停用的工具保持不变。

[返回 Workflow](index.md)
