# 配置

[文档索引](index.md)

Pi Suite 不需要配置文件即可使用，下面的内容都是可选的。

## 文件与优先级

设置从三层读取，后一层按字段覆盖前一层，因此项目文件只需写要修改的字段。

1. 内置默认值。
2. 用户文件：`<agentDir>/pi-suite.json`（默认 `~/.pi/agent/pi-suite.json`；Pi 的 `PI_CODING_AGENT_DIR` 会改变 `<agentDir>`）。
3. 项目文件：会话工作目录下的 `.pi/pi-suite.json`。不向上级目录或 Git 根目录查找。

文件不存在表示没有覆盖。无效 JSON、未知字段、超出范围的值和读取错误都会报告，本套件不会覆盖这样的文件。

大多数设置在 `/reload` 后生效。从 `/subagents types` 编辑的 agent 类型设置（`agents.types`）对新运行立即生效。

## 用 `/suite` 编辑

`/suite` 打开设置列表，逐项显示有效值、默认值、用户值、项目值和来源。

- 输入文字搜索，↑/↓ 选择，Enter 编辑，Esc 返回。
- 每个字段都可以编辑用户层或项目层，也可以删除某一层的值，让该字段重新继承。
- 布尔和枚举使用选择器；数字、文本和按键使用输入框；包名单、CLI 预设和 agent 类型覆盖以 JSON 编辑。
- 保存时只改写被编辑的字段，使用与本套件其他部分相同的锁和原子写入。

没有 TUI 时，`/suite` 输出有效配置。

## 带默认值的完整示例

```json
{
  "commands": { "exit": true },
  "modules": { "ask": true, "tasks": true, "jobs": true, "goal": true, "agents": true },
  "runtime": { "openAIResponsesAutoRecovery": false },
  "ui": { "maxRows": 12, "highlightBuiltinCommands": true },
  "ask": { "timeout": 600000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "tasks": { "reminders": true },
  "agents": {
    "display": "status",
    "maxConcurrent": 10,
    "maxConcurrentForeground": 0,
    "maxDepth": 3,
    "persistSessions": true,
    "mentions": true,
    "scheduling": true,
    "workflows": true,
    "types": {}
  },
  "jobs": {
    "display": "status",
    "detachKey": "ctrl+]",
    "returnKey": "ctrl+g",
    "transferKey": "ctrl+t",
    "agents": {}
  }
}
```

## 字段

### commands 与 modules

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `commands.exit` | `true` | 注册 `/exit`。它先取消正在进行的轮次，再通过 Pi 的正常关闭流程退出，使 job 和 agent 得到清理。Pi 自带的 `/quit` 始终可用。 |
| `modules.ask` | `true` | 启用 `ask_user`。 |
| `modules.tasks` | `true` | 启用任务工具和 `/tasks`。 |
| `modules.jobs` | `true` | 启用 job 工具和 `/jobs`。关闭时，子代理创建的 job 仍可从 `/subagents` 查看。 |
| `modules.goal` | `true` | 启用 `/goal` 和目标工具。 |
| `modules.agents` | `true` | 启用子代理、定时调度、workflow 和 `/subagents`。 |

### runtime

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `runtime.openAIResponsesAutoRecovery` | `false` | 自动从两类 OpenAI Responses 历史错误中恢复，见 [下文](#openai-responses-恢复)。 |

### ui

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ui.maxRows` | `12` | 空闲 Dock 的最大行数，1–30。不限制 `ask_user`。 |
| `ui.highlightBuiltinCommands` | `true` | 对 Pi 内置 `bash` 和 `powershell` 工具调用中的命令做语法高亮。`false` 保留 Pi 原有的调用显示。job 命令始终高亮。 |

### ask、goal 与 tasks

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ask.timeout` | `600000` | `ask_user` 的默认空闲超时，单位毫秒，0–2147483647。`0` 表示一直等待。 |
| `ask.historyKey` | `ctrl+h` | 显示问题时打开对话历史的按键。 |
| `goal.display` | `status` | 目标摘要的显示位置：`status`（footer 状态）、`dock` 或 `hidden`。 |
| `tasks.reminders` | `true` | 连续若干轮未使用任务工具后，在模型的下一次请求中附加简短的任务提醒。 |

### agents

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `agents.display` | `status` | 活动子代理数量的显示位置：`status`、`dock` 或 `hidden`。 |
| `agents.maxConcurrent` | `10` | 后台子代理的最大并发数，超出的运行进入队列等待。 |
| `agents.maxConcurrentForeground` | `0` | 前台子代理的最大并发数，`0` 表示不限。 |
| `agents.maxDepth` | `3` | 包含主会话在内的最大会话层数，`3` 允许两层嵌套。 |
| `agents.persistSessions` | `true` | 默认把顶级子代理会话保存到磁盘。 |
| `agents.defaultModel` | 未设置 | 子代理的默认模型，格式为 `provider/modelId`。 |
| `agents.types` | `{}` | 按类型覆盖 `enabled`、`model` 和 `thinking`，见 [Agent 类型](modules/agents/types-and-models.md#配置覆盖)。 |
| `agents.packageAgents` | 全部 | 加载已安装 Pi 包声明的 agent 类型。`false` 或 `[]` 关闭；包名或来源数组用于选择包。 |
| `agents.mentions` | `true` | 启用编辑器中的 `@handle` 提及和补全。 |
| `agents.scheduling` | `true` | 启用 `agent_start` 的 `schedule` 参数和 Schedules 页面。 |
| `agents.workflows` | `true` | 启用 `agent_workflow` 和 Workflows 页面。 |
| `agents.packageWorkflows` | 全部 | 加载已安装 Pi 包声明的 workflow，取值同 `packageAgents`。 |

### jobs

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `jobs.display` | `status` | 活动 job 数量的显示位置：`status`、`dock` 或 `hidden`。 |
| `jobs.detachKey` | `ctrl+]` | 离开终端视图，job 继续运行。默认值避开 tmux 的 `Ctrl+B` 前缀。 |
| `jobs.returnKey` | `ctrl+g` | 留在终端视图中，把输入交还模型。 |
| `jobs.transferKey` | `ctrl+t` | 离开视图，并把当前屏幕发送给模型。 |
| `jobs.agents` | 内置预设 | `job_start` 的 `agent` 请求使用的 CLI 预设，见 [CLI 预设](modules/jobs/cli-and-hands-free.md#cli-预设)。 |

按键字段使用 Pi 的按键标识，例如 `ctrl+h`、`alt+x` 或 `shift+tab`。

## OpenAI Responses 恢复

当请求历史是在其他资源或账号下产生的（例如网关在多个上游账号之间切换），OpenAI Responses 端点可能拒绝该请求。将 `runtime.openAIResponsesAutoRecovery` 设为 `true` 后，本套件处理两种情况：

- **来自其他资源的 item ID**：最终请求因明确的资源、所有权或依赖缺失错误而失败，仅有 HTTP 400 不够。本套件移除失败请求所带历史项的上游 `id`，并让模型继续。正文、加密 reasoning、调用 ID 和工具输出保持不变。
- **无法解密的加密 reasoning**：最终请求因 reasoning 密文无法验证或解密而失败。如果错误中带有截断的密文片段，它必须与失败请求中的 reasoning 匹配。本套件在重放的历史中移除这些 reasoning 项，移除其余历史项的上游 `id`，并让模型继续。消息、调用 ID 和工具输出保持不变。之后新产生的 reasoning 照常重放。
- 只针对 `openai-responses` 模型。
- 只在失败请求的历史可以独立重放时处理。依赖服务端状态的请求（例如带 `previous_response_id`、`item_reference` 项或服务端压缩）不处理。
- 如果失败的响应已经产生内容或工具调用，则不重试，避免重复副作用。限流、认证错误、额度错误、上下文超限和普通 schema 错误不处理。
- 被隔离的 ID 和被移除密文的哈希记录在 `pi-suite:responses-isolation` 会话条目中，另保存 provider、API、模型和 base URL 的哈希，不保存提示文本、密文原文或凭据。原始历史仍保留在磁盘上。

修复之后的重试使用 Pi 自身的重试预算。在请求成功之前，每种修复最多执行一次，因此 ID 修复后紧接着出现的解密错误仍能恢复。

## 用 `/exit` 退出

Pi 忙碌时，`/exit` 先中止当前轮次并等待空闲，再请求 Pi 关闭。Pi 的退出流程会恢复终端，本套件在退出前停止 job、PTY、子代理和 workflow。job 共用 10 秒的停止期限，届时仍无法确认的清理记为 `unconfirmed`，Pi 照常退出。将 `commands.exit` 设为 `false` 并 `/reload` 可移除该命令。
