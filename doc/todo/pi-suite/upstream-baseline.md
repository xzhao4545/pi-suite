# 上游基线与参考来源

目标：将已核对的发布包信息转为可验证的导入基线。

当前状态：待实施；项目已有扩展骨架，本专项业务能力尚未实现。

影响范围：六个扩展来源、Pi 宿主版本和平台复现。

约束：静态源码分析不能代替真实运行验收；来源不明时不得编造仓库。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [ ] 核对实际宿主版本和依赖作用域
- [ ] 记录导入提交或 tarball integrity 与许可证
- [ ] 在 Windows 和 Ubuntu 复现相关问题
- [ ] 确认各模块需要保留的工具契约和现有能力

## 验收方式

来源记录与实际导入代码一致，宿主版本明确，复现结论涵盖两个目标平台。

## 关联计划

- [架构与发布](architecture.md)
- [上游来源登记](../../../third-party/UPSTREAM.md)

## 2. 已核对的上游现状

以下结论来自 npm 当前发布包源码的静态检查，未在用户的 Pi 实例中运行。

| 扩展 | 核对版本 | 现有能力与缺口 |
| --- | --- | --- |
| `pi-ask-user` | 0.17.2 | 已有 `displayMode: inline`、默认 Alt+O 隐藏/恢复 overlay、单次 `timeout`。超时默认不启用；取消和超时均走 null；仍需统一高度和更清晰的超时语义。 |
| `@tintinweb/pi-tasks` | 0.9.1 | 任务无 `parentId`。面板默认最多 10 项，按顶部/底部截取；只处理终端列宽，缺少按终端行数及其他面板占用调整的逻辑。 |
| `pi-interactive-shell` | 0.18.0 | 已通过进程内全局 coordinator 保留 `/reload` 的活动任务；其他 `session_shutdown` 原因仍调用 `killAll()`。已有 PTY、交互输入、后台查看和监控，可选择保留需要的能力。 |
| `@narumitw/pi-goal` | 0.54.15 | 已有 retry/compact 恢复逻辑，但在 `agent_end` 中仍将 assistant 的 `stopReason: aborted` 直接转为 goal paused。 |
| `@tintinweb/pi-subagents` | 0.23.0 | 会话查看器已支持 assistant Markdown，默认开启；工具调用仍主要显示名称、工具结果主要按文本处理，并非主 agent 的完整消息组件。fleet 固定最多 5 个 agent 行，另有提示、main、空白和溢出行。 |
| `pi-background-jobs` | 0.1.3 | 已支持同一 Pi 进程内跨 reload/new/resume/fork 存活；仅 quit 执行退出清理。主要面向 Windows 的非交互任务。运行条仍是每个任务一行。 |

当前 npm 新作用域 Pi 核对版本是 `@earendil-works/pi-coding-agent@1.5.0`。旧 `@mariozechner/*` 和新作用域不能仅凭“latest”视作相同 API；实现时记录实际宿主版本和依赖作用域，先支持一个经验证的基线。

源码依据：

- `pi-ask-user/index.ts`：`buildCustomUIOptions`、`runCustomPrompt`、`timeout` schema；README 的显示模式和隐藏快捷键说明。
- `pi-tasks/src/types.ts`：任务字段；`src/ui/task-widget.ts`：`DEFAULT_MAX_VISIBLE_TASKS = 10`、顶部/底部切片和列宽截断。
- `pi-interactive-shell/index.ts`：全局 coordinator，以及 `session_shutdown` 中只有 reload 绕过 killAll 的分支。
- `pi-goal/dist/index.ts`：`agent_end` 对 aborted 的暂停分支。
- `pi-subagents/src/ui/conversation-viewer.ts`：按角色手工提取文本；`src/ui/fleet-list.ts`：`MAX_AGENT_ROWS = 5`。
- `pi-background-jobs/extensions/index.ts`、`src/runtime.ts`：可撤销通知绑定与进程内 runtime；README 的生命周期限制。
- Pi 的 `core/agent-session`：手动 `compact()` 先执行 `await this.abort()`；扩展类型声明提供 `agent_before_settle`、`agent_settled` 和带 reason 的 `session_shutdown`。

## 11. 参考来源

- [Pi 扩展接口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi 原生消息组件](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/src/modes/interactive/components)
- [pi-ask-user](https://github.com/edlsh/pi-ask-user)
- [pi-tasks](https://github.com/tintinweb/pi-tasks)
- [pi-interactive-shell](https://github.com/nicobailon/pi-interactive-shell)
- [pi-goal](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)
- [pi-subagents](https://github.com/tintinweb/pi-subagents)
- [pi-background-jobs@0.1.3](https://www.npmjs.com/package/pi-background-jobs/v/0.1.3)

GitHub main/master 可能继续变化；本设计的已核对版本见第 2 节，以相应 npm 发布包为准。
