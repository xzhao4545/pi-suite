# 浏览界面可发现性与配色

## 目标

打开 `/subagents`、`/jobs`、`/tasks` 后无需试按键即可看出：当前在哪一页、哪些位置可以切换、当前选中了什么、按什么键做什么。

## 当前状态

真实 Pi 1.5（120×40、fullscreen）在没有运行中 subagent 时打开 `/subagents` 的第一屏：

```
Subagents ▸ Runs    [1 Runs]  2 Types  3 Schedules  4 Workflows
Scope (w): [This session] · Workspace    State (s): [Active 0] · Queued 0 · Finished 0 · All 0
No matching records                                  │
Runs · This session · Active · 0/0
/ filter · Esc close
```

- 底部按键说明只列选中记录的动作；无记录时只剩 `/ filter · Esc close`，切页（1–9、`[` `]`）、Scope（w）、State（s）从不出现在说明中。
- 默认 State 为 Active，没有运行中的 run 时列表为空，不提示已结束记录。
- 标题区、列表、状态行、按键说明之间没有分隔线。
- 当前页签与筛选当前值都用 `[ ]` 加 accent，无法区分页面行与筛选行；其他文字几乎同色。

## 方案（用户已确认）

### 语言

界面提示统一英文。

### State 筛选与排序

- Runs 页去掉 Active 筛选，State 为 `All · Queued · Finished`，默认且每次打开都为 All；`/subagents` 命令参数同步去掉 active（保留 queued/finished/all），workspace 默认 all。
- 列表按最近活动排序：活动中的 run（starting/running/waiting/stopping/queued）排在最前，其内部按最近更新时间；其余按 endedAt（无则最近更新或创建时间）倒序。因此正在运行的 run 始终在顶部。
- /jobs 列表采用相同规则：默认 All，去掉 Active 筛选，活动 job 排在最前，其余按结束时间倒序。模型工具 agent_list/job_list 的 state 参数不变。
- /tasks 的 State 语义不同（Unfinished/Running/Blocked/Completed/All），保持现状。

### 布局

- 标题区（标题与页签、筛选行）与列表之间、列表与底部（状态行与按键说明）之间各一条分隔线（borderMuted）。
- 底部固定两行，有无记录都显示：
  1. 导航行：`1-4 / [ ] page · w scope · s state · / filter · Tab details · Esc close`（只列当前页实际存在的控件与页面）。
  2. 动作行：有选中记录时 `Enter open · m message · …`；无记录时显示空状态的下一步，例如 `No queued runs · press s for All (10)`。
- 列表为空时列表区显示同一空状态提示，不再只显示 `No matching records`。
- 窄终端（<80 列）两行各自截断，导航行优先保留页面与筛选键。

### 配色角色

使用 Pi 主题 token，颜色随主题变化；在 browser-chrome 统一定义角色，不在各页面自行着色。

| 角色 | 位置 | 样式 |
| --- | --- | --- |
| 标题 | `Subagents ▸ Runs` | accent + bold |
| 当前页签 | 选中的页面标签 | selectedBg 背景 + bold，无方括号 |
| 可切换项 | 未选中页签、筛选的其他选项 | muted |
| 筛选当前值 | Scope/State 当前值 | accent + bold（下划线或无括号，与页签样式明显不同） |
| 按键 | 所有按键提示中的键（`w`、`s`、`1-4`、`Enter`、`m`…）及标签内的 `(w)` | warning + bold |
| 按键说明文字 | 键后的动作名 | dim |
| 选中行 | 列表当前记录 | selectedBg 背景，行首标记 accent |
| 记录状态 | 行内状态词 | running/starting success，waiting/stopping/queued warning，failed/limited error，completed/stopped dim |
| 危险动作 | `x` 停止/取消及其确认提示 | error |
| 状态行 | 页面·范围·筛选·计数·选中对象 | 页面与选中对象名称 text，其余 muted |
| 分隔线 | 区块之间 | borderMuted |

## 影响范围

- src/ui/browser.ts、src/ui/browser-chrome.ts、src/ui/actions.ts、src/ui/details.ts（按键颜色复用）
- src/agents/ui/index.ts、src/agents/ui/runs.ts、src/jobs/viewer.ts（State 与排序）及其他 BrowserView 使用者（只接入公共角色）
- 相关 current 文档：[agents 操作](../current/agents/operations.md)、[jobs](../current/jobs/index.md)、[ui](../current/ui/index.md)

## 验收

- 真实 Pi 1.5 在 40×24 与 120×40、fullscreen 模式下截图：无记录、有活动与已结束记录、只读记录三种状态，第一屏可见全部导航键与动作键。
- 默认 All，运行中的 run/job 位于列表顶部。
- 各角色颜色在默认主题下可区分（通过 ANSI 序列核对 token）。

## 任务

- [x] Runs/Jobs 去掉 Active 筛选、默认 All、最近活动排序，命令参数同步
- [x] BrowserView 分隔线、固定导航行与动作行、空状态提示
- [x] browser-chrome 配色角色并接入所有 BrowserView 使用者与 DetailsView 按键提示
- [x] 更新受影响测试与 agents/jobs/ui 当前文档
- [x] 真实 Pi 40×24、120×40 截图验收
