# Subagent 快捷进入与全屏查看

## 目标

恢复上游 @tintinweb/pi-subagents 0.23.0 中从主会话直接选择并查看 subagent 的键盘入口，并让会话查看器替换整个显示窗口、自行处理翻页。

## 当前状态

- 上游 src/ui/fleet-list.ts 在空提示符下按 ↓ 或 ← 激活 main + workflow + agent 列表，↑↓ 选择、Enter 打开 conversation overlay、Esc 或在首行按 ↑ 返回提示符；按键通过 `ctx.ui.onTerminalInput` 在编辑器之前处理，仅在编辑器拥有焦点且内容为空时生效。导入时 fleet-list.ts 与 agent-widget.ts 被丢弃（见 [上游导入](../design/upstream-import.md)），计数交给 StatusPublisher、行与 ← 键盘进入交给 Dock。
- src/agents/viewer.ts 的 showAgent 使用不带 overlay 的 `ctx.ui.custom`，组件替换编辑器位置；fullscreen 模式下主会话 transcript 仍占据上半部分，查看器高度按终端 80% 计算。上游通过 getConversationOverlayOptions 在 fullscreen 下以 `{ anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 }` 打开 overlay，inline 模式为居中 90%。
- Pi 1.5 fullscreen（用户配置 `tuiMode: "fullscreen"`）的 TuiAltScreen 在分发按键前处理 `tui.altScreen.pageUp/pageDown` 等视口按键，只有焦点组件声明 `capturesViewportInput` 或 overlay 拥有焦点时才交给组件（shouldDeferViewportInput）。HEAD 中 DetailsView 与 BrowserView 均未声明，PgUp/PgDn 滚动的是主会话 transcript，而不是 subagent 记录。

## 方案

### 全屏查看器

- 在 src/ui 提供共用的阅读视图打开方式：fullscreen 模式以 overlay 覆盖整个窗口（top-left、100% 宽高、无边距），inline 模式居中 90% 宽、按终端高度限制；高度由 overlay 实际可用行数决定，不再按 80% 估算。
- Subagent transcript（showAgent）、job 日志查看与 showDetails 等 DetailsView 阅读视图使用该方式；/subagents、/tasks、/jobs 浏览列表保持在编辑器位置。
- DetailsView 与 BrowserView 声明 `capturesViewportInput`，PgUp/PgDn、Home/End 与 ↑↓ 由组件内 ScrollView 处理；Esc 关闭 overlay 并回到打开它的列表或提示符。

### Dock 键盘进入

- DockSource 增加可选的 `open(rowId)`；提供 open 的分区行可被选择。agents（含 workflow 行）与 jobs 分区提供 open，tasks 不提供。
- 通过 `ctx.ui.onTerminalInput` 在编辑器拥有焦点且内容为空时处理：← 激活 Dock 选择（无可选行时不消费按键），↑↓ 移动，Enter 打开所选对象（agent 打开全屏 transcript，workflow 打开运行详情，job 打开 job 详情/日志），Esc 或 → 返回提示符；其他按键退出选择并交给编辑器。只处理 key press，忽略 key release；询问、详情或其他组件拥有焦点时不处理并退出选择。
- 选中行使用高亮标记，Dock 标题行显示 `← select · Enter open · Esc back` 类提示，仅在激活时显示按键说明；选择身份按 row id 保持，行刷新时选中项消失则移动到相邻行。

## 影响范围

- src/ui/dock.ts、src/ui/details.ts、src/ui/browser.ts，新增的共用 overlay 打开函数
- src/agents/index.ts（Dock 分区与 open）、src/agents/viewer.ts、src/agents/workflow（Dock 行打开详情）、src/jobs（Dock 分区与 open、日志查看）
- 相关 current 文档：[ui](../../../current/ui/index.md)、[agents 操作](../../../current/agents/operations.md)、[jobs](../../../current/jobs/index.md)

## 约束

- 非空编辑器、补全菜单、询问、其他扩展的 custom UI 拥有焦点时不拦截 ←。
- overlay 关闭后恢复主会话视口位置，不改变主会话滚动。
- 不导入上游 fleet-list 渲染实现，Dock 继续作为唯一的底部状态区。

## 验收

- fullscreen 模式下打开 subagent transcript 占满窗口，PgUp/PgDn 翻页的是 subagent 记录；Esc 返回原处。
- 空提示符按 ← 进入 Dock 选择，↑↓ 选择 agent/job，Enter 打开，Esc 返回；输入文字后 ← 仍为光标左移。
- inline 模式下查看器以居中 overlay 打开，翻页同样作用于查看器。

## 任务

- [x] 共用全屏阅读 overlay，DetailsView/BrowserView 声明 capturesViewportInput
- [x] showAgent、job 日志、showDetails 迁移到全屏阅读 overlay
- [x] DockSource.open 与 ← 键盘进入，agents/workflow/jobs 分区接入
- [x] 更新 ui/agents/jobs 当前文档


## 验收结论

Linux（Node 24）`pnpm typecheck` 通过，全量 `pnpm test` 181/181 通过，约 45 秒。界面渲染通过组件脚本在 40/120 列核对；实际 Pi CLI 交互未在本专项中单独验收。
