# 浏览界面交互重构

## 目标

让 `/subagents` 及其他基于 ui/browser.ts BrowserView 的界面一眼可见当前页面、范围、筛选与选中对象，所有操作都有可见按键，Enter 行为固定可预期。

## 当前状态

- Runs、Schedules、Workflows 页标题都是 `Subagents`；页面切换行没有标签，当前页用 `[Runs]` 标记，与 Scope/State 已选项样式相同，无法区分页面行与筛选行。Workflows 页另有 `Workflows: Runs · Saved` 行，与顶层 Runs 同名。
- 选择器行同时使用 `›`（焦点行）、`[x]`（已生效项）、`>x<`（光标）三种标记；←→ 只移动光标，Enter 才生效。
- Tab 焦点环依次为页面、Scope、State、Filter、List、Details、Actions，最多 7 个位置，当前焦点只在底部提示行显示。
- 操作条始终高亮一个操作，但列表中 Enter 执行页面写死的默认动作（Runs 为 Transcript，Types 为 Model / thinking），与高亮项无关；只有 Tab 到 Actions 后 Enter 才执行高亮项。
- 默认焦点为 Filter，任意字符进入过滤，因此字母键无法作为操作快捷键，目前只有 `x`（停止/清理）和 transcript 视图的 `b`。
- 确认提示为中文（“再按 x 停止”），其余界面文字为英文。

## 方案

在 BrowserView 框架层统一实现，Subagents 各页、Tasks、Jobs 视图共同迁移，不在单个页面另做交互。

示意布局：

```
Subagents ▸ Runs        1 Runs  2 Types  3 Schedules  4 Workflows
Scope (w): This session    State (s): Active 2 · queued 0 · finished 5
──────────────────────────────┬──────────────────────────────
› reviewer · running · 12.3s  │ agent_1a2b3c4d / run_…
  explorer · running · 3.1s   │ model: …
──────────────────────────────┴──────────────────────────────
Runs · This session · Active · 2/7 · reviewer (agent_1a2b3c4d)
Enter 打开 · m 消息 · j Jobs · c 模型/思考 · b 后台 · x 停止 · / 过滤 · Esc
```

1. 页面：标题为 `<命令> ▸ <页名>`；页面行使用标签栏样式，数字键 1–4 或 `[`/`]` 直接切换，不进入 Tab 焦点环。
2. 筛选：BrowseControl 增加 key，按键立即生效并循环选项，去掉光标与已生效的双重状态；Runs 的 Scope 为 `w`，State 为 `s`；Workflows 页的 Runs/Saved 作为本页筛选，同样使用 `s`。
3. 焦点：只保留列表（默认）、详情（Tab 进入、Esc 返回）和过滤（`/` 进入，Esc 清空并退出）。
4. 操作：去掉可选中的操作条，所有 DetailAction 必须声明 key，底部显示按键说明；Enter 固定为“打开”。二次确认保留，确认提示与界面文字统一语言。
5. 状态行：显示当前页、范围、状态筛选、匹配数/总数与选中对象名称和 ID。

### 按键分配

| 位置 | 按键 |
| --- | --- |
| 公共 | 1–4/`[` `]` 切页 · `/` 过滤 · Tab 详情 · Esc 返回 |
| Runs | Enter transcript（queued 为任务详情）· m 消息 · j Jobs · c 模型/思考强度 · b 后台 · x 停止子树/取消排队/清理 jobs · w 范围 · s 状态 |
| Transcript 视图 | m 消息 · o 工具块 · h 思考块 · j Jobs · c 模型/思考强度 · b 后台 · x 停止子树 |
| Types | Enter 或 c 模型/思考强度 · d 启用/禁用 · u 使用定义 |
| Schedules | Enter 详情 · x 取消调度 |
| Workflows | Enter 打开运行详情/查看脚本 · p 暂停/恢复 · x 停止 · r 重放 journal · n 启动保存的 workflow · s Runs/Saved |

### 模型与思考强度的修改位置

两个层级分别对应不同作用范围，统一使用 `c`：

- 类型默认值：Types 页（`/subagents types` 或按 2）选中类型后 Enter 或 `c`，写入类型配置，对之后新建的执行生效。
- 单个 run：Runs 页选中记录或在其 transcript 视图按 `c`，修改该 run 的覆盖值，从它的下一次请求生效；Read only 记录不提供。

### Types 未配置显示

Types 列表与详情当前按默认启动设置解析，类型配置、frontmatter 与 agents.defaultModel 都未设置时显示父级主会话当前模型（inherited），容易误认为已配置。改为：模型来源为 inherited 时列表与详情显示 `not configured`，详情说明运行时将使用启动时父级会话的当前模型；thinking 来源为 inherited 时同样显示 `not configured`。运行时解析顺序不变。

## 影响范围

- src/ui/browser.ts、src/ui/actions.ts（框架层焦点、按键、状态行）
- src/agents/ui/*、src/agents/viewer.ts、src/agents/schedules/menu.ts、src/agents/workflow/ui/menu.ts
- src/tasks/viewer.ts、src/jobs/viewer.ts、src/agents/viewer.ts 中的 Jobs 子视图
- 相关 current 文档：[agents 操作](../../../current/agents/operations.md)、[Workflow 操作](../../../current/agents/workflow/operations.md)、[tasks 操作](../../../current/tasks/operations.md)、[jobs](../../../current/jobs/index.md)、[ui](../../../current/ui/index.md)

## 约束

- 选择身份（runId 等）、各记录的详情滚动与搜索状态、刷新订阅保持现有行为。
- 页面内按键不得与 Pi 宿主全局按键冲突；窄终端（<80 列）下状态行与按键说明可截断，但当前页与选中对象必须可见。
- 过滤改为 `/` 进入后，直接输入字符不再过滤，Tasks、Jobs 视图同步改变，需在操作文档中说明。

## 验收

- 进入 `/subagents` 无需 Tab 即可从标题和状态行判断当前页、范围、筛选和选中对象。
- 每个页面底部列出的按键与实际行为一致，列表 Enter 只执行“打开”。
- 切页、切范围、切状态各一次按键完成，返回时保留各页选中项。
- Tasks、Jobs 视图使用同一交互规则。

## 任务

- [x] BrowserView：页面标签栏、控件按键、三态焦点、`/` 过滤、状态行与按键说明
- [x] ActionBar 改为按键驱动，DetailAction.key 必填，统一确认提示语言
- [x] 迁移 Subagents 的 Runs、Types、Schedules、Workflows 页与 transcript 视图
- [x] 迁移 Tasks、Jobs 视图与 run 所属 Jobs 子视图
- [x] Types 未配置模型/thinking 显示 not configured，不显示主会话继承值
- [x] 更新 agents/workflow/tasks/jobs/ui 当前文档中的操作说明


## 验收结论

Linux（Node 24）`pnpm typecheck` 通过，全量 `pnpm test` 181/181 通过，约 45 秒。界面渲染通过组件脚本在 40/120 列核对；实际 Pi CLI 交互未在本专项中单独验收。
