# Subagent 查看器内联消息与底部跟随

## 目标

查看 subagent 时，发送消息和阅读实时输出都在查看器内完成：按 m 在查看器底部直接输入，不跳回主会话；阅读位置在底部时随新输出自动跟随。

## 当前状态

- src/agents/viewer.ts 的 m 动作结束整个查看器（done），再由 performAgentAction 调用 `ctx.ui.input`。查看器是全屏 overlay，关闭后用户回到主会话界面，输入框出现在主编辑器位置；发送后需要重新打开 transcript。Runs 列表的 m 同样关闭列表后弹出原生输入。上游 @tintinweb/pi-subagents 0.23.0 conversation-viewer.ts 在查看器内打开 pi-tui Input 作为内联 composer：输入期间 composer 拥有全部按键，Enter 发送，Esc 或空提交返回阅读。
- src/ui/scroll.ts 的 ScrollView 只在 setContent(content, true) 时跟随一次（followOnRender），之后 viewport 只把 offset 限制在范围内。查看器的 refresh 只在 entry 身份变化时调用 setContent，同一条消息流式增长、工具输出增量或展开状态变化时内容行数增加但 offset 不变，阅读位置停在旧的底部之上。上游 ScrollView 使用 `follow: "end"` 的持续跟随状态（isFollowingEnd）。

## 方案

### 底部跟随

- ScrollView 维护持续的 following 状态：渲染时若 following，offset 固定为最后一页；用户向上滚动（↑、PgUp、Home、滚轮向上、搜索跳转）离开底部时取消 following；滚动或 End 回到底部时恢复 following。初始是否跟随由打开时传入（活动 run 默认跟随）。
- 去掉 setContent 的一次性 follow 参数与查看器 refresh 中的 atBottom 判断，统一由 following 状态决定；job 日志查看等其他 ScrollView 使用者同样受益（日志 f 跟随复用该状态）。
- 不跟随且有新内容时，标题位置后显示 `↓ new output · End to follow`（dim/warning），回到底部后消失。

### 内联消息输入

- 在 src/ui 提供公共内联输入（复用 pi-tui Input），DetailsView 与 BrowserView 都可在底部按键说明的位置打开：显示 `Message <名称>: ` 或 `Answer parent question: ` 提示，输入期间拥有全部按键（包括字母和方向键），Enter 提交，Esc 或空提交取消并返回原焦点。
- Transcript 的 m 在查看器内打开输入，提交后调用 manager.send，查看器保持打开并继续跟随；结果（steered/queued/resumed 或错误）在查看器底部显示一行，几秒后或下一次按键后消失，不使用主会话 notify。
- Runs 列表的 m 在列表底部打开同一内联输入，提交后留在列表。
- 提交前再次检查 canMessage，run 已不接受消息时显示错误，不发送给后续 run。

## 影响范围

- src/ui/scroll.ts、src/ui/details.ts、src/ui/browser.ts，新增的公共内联输入
- src/agents/viewer.ts、src/agents/ui/runs.ts、src/jobs/log-viewer.ts（跟随复用）
- 相关 current 文档：[agents 操作](../../../current/agents/operations.md)、[ui](../../../current/ui/index.md)、[jobs](../../../current/jobs/index.md)

## 验收

- 真实 Pi fullscreen 中打开运行中 subagent 的 transcript，停在底部时新输出持续可见；向上滚动后不再跳动并显示新输出提示，End 恢复跟随。
- 按 m 在查看器底部输入并 Enter，查看器不关闭，subagent 收到消息，底部显示结果。
- Runs 列表 m 同样在列表内完成。

## 任务

- [x] ScrollView 持续 following 状态与新输出提示，查看器与日志查看接入
- [x] 公共内联输入，Transcript 与 Runs 列表的 m 接入
- [x] 更新受影响测试与 agents/ui/jobs 当前文档
