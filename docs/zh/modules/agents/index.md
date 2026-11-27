# Agents

[文档索引](../../index.md) · [类型与模型](types-and-models.md) · [定时调度](schedules.md) · [Workflow](workflows.md) · [RPC](rpc.md)

agents 模块运行子代理：同一进程中的 Pi 子会话，各自拥有提示词、模型、工具和对话记录。开关：`modules.agents`。显示：`agents.display`。

内置类型：

| 类型 | 用途 |
| --- | --- |
| `general-purpose` | 拥有完整工具，适合任意任务。 |
| `Explore` | 调查，工具为 `read`、`bash`、`grep`、`find` 和 `ls`。提示词要求它不做修改，也没有编辑工具，但这不是沙箱：`bash` 仍可修改文件。 |
| `Plan` | 规划，工具与限制同 `Explore`。 |

你可以添加自己的类型，见 [类型与模型](types-and-models.md)。

## 运行与生命周期

每个子代理有稳定的 `agent_` ID。每次执行（包括每次恢复）都有自己的 `run_` ID。启动子代理、在它结束后发送消息、回答它的问题，都使用同一个 agent ID。

- **后台**（默认）：`agent_start` 立即返回 ID，结果以通知送达，或通过 `wait` 获取。
- **前台**（`background: false`）：`agent_start` 等待结果；任一直接子代理提问时提前返回。在父级按 Esc 会取消前台调用及其子代理，后台子代理继续运行。
- **并发**：后台最多 `agents.maxConcurrent`（10）个运行，前台默认不限。超出的运行在 FIFO 队列中等待。嵌套子代理和 workflow 子代理不占这些槽位。
- **嵌套**：只有类型的 `allowed_subagents` 允许时，子代理才能启动自己的子代理，最多 `agents.maxDepth`（3）层会话。
- **状态**：`queued`、`starting`、`running`、`waiting`、`stopping`、`completed`、`failed`、`stopped`，以及达到 `maxTurns` 时的 `limited`。
- **停止**一个运行也会停止其嵌套子代理和它们创建的所有 job，并报告真实的清理结果。
- **自动恢复**：运行因网络或上游错误（超时、连接错误、过载、429、5xx）失败，且 Pi 的 retry 设置开启时，同一个子代理以新的运行恢复，从中断处继续。额度、计费和授权错误不触发。workflow 子代理不走这一流程。等待期间运行为 `queued` 并显示 `retry N/M`；延迟每次翻倍，不超过 Pi 的上限；次数达到 Pi 的 `retry.maxRetries` 后不再恢复，错误末尾附 `gave up after N automatic resumes`。只有最后一次运行送达结果。停止排队中的重试即取消它。

顶级会话默认保存到磁盘（`agents.persistSessions`）。结束超过 10 分钟的运行，在你关闭其查看器后，内存中的对话记录可能被释放；记录、结果和已保存的会话仍然可用。

`/reload` 会替换空闲的子代理和 workflow 运行时。如果 Pi 提示运行时来自先前加载，你仍可引导或停止现有运行、回答子代理的问题。待运行结束且结果送达后，再执行一次 `/reload`，即可启动或恢复子代理、启动 workflow。若提示要求重启 Pi，重启一次即可。替换运行时可能释放未保存的子代理对话记录。

## 工具

| 工具 | 参数 |
| --- | --- |
| `agent_start` | `prompt`、`type?`、`name?`、`background?`、`model?`、`thinking?`、`maxTurns?`、`taskId?` 与 `taskGeneration?`、`inheritContext?`、`isolated?`、`schedule?`。 |
| `agent_list` | `state?`（默认 `active`，可选 `queued`、`finished`、`all`）、`scope?`（默认 `session`，可选 `workspace`）、`agentId?`、`cursor?`、`limit?`（默认 10，最大 100）。 |
| `agent_get` | `id`、`runId?`、`detail?`。显示状态、活动、模型、thinking、任务和待回答的问题。`detail: true` 增加来源、上下文占用、token 用量和活动 job。 |
| `agent_read` | `id`、`runId?`、`stream?`（活动时默认 `transcript`，结束后默认 `result`），以及 [共享读取参数](../../concepts.md#读取输出)。 |
| `agent_send` | `id`、`message`。返回 `answered`、`steered`、`queued` 或 `resumed`。只有直接父级可以发送。 |
| `agent_stop` | `id`、`runId?`。停止该运行子树及其 job。 |
| `agent_workflow` | 见 [Workflow](workflows.md)。 |

- `inheritContext: true` 把父级的用户与助手文本和压缩摘要交给子代理，不含工具结果。
- `isolated: true` 为子代理关闭外部扩展、技能和嵌套。
- `schedule` 登记未来的运行而不是立即启动，见 [定时调度](schedules.md)。
- 类型 frontmatter 中的 `max_turns`、`inherit_context`、`run_in_background` 和 `isolated` 优先于这些参数。

## 父级提问

子代理调用 `ask_user` 时，问题交给它的直接父级，运行显示 `waiting(parent)`。顶级子代理的父级是主会话，主会话以通知形式收到问题。父级用 `agent_send` 回答：

- 与选项 ID 或标题完全一致的消息会选中该选项，其他内容作为自由文字回答。
- 多选时发送字符串的 JSON 数组；批量问题发送 JSON 数组，每个元素对应一题。

回答带有 `source: parent`，因此子代理不能把它当作用户本人的批准。问题使用 `ask.timeout`，除非它自己设置了超时；超时或取消会停止子代理。

## 提及

在 TUI 编辑器中，`@名称 消息` 可以直接与子代理对话：

- `@explore …` 或 `@agent-explore …` 发给 Explore 实例。实例 handle 由类型名生成，重名时加 `-2`、`-3`。传给 `agent_start` 的 `name` 也可以作为别名。
- 子代理运行中时，消息用于引导；排队中时，消息暂存；等待回答时，消息即回答；已结束时，消息使其恢复执行。
- 某个类型还没有实例时，主会话的一个临时副本会把你的消息整理为一次 `agent_start` 任务。
- `@main 消息` 把消息交给主会话。
- `@` 之后的补全列出活动实例、已结束实例和已启用的类型，同时保留 Pi 的文件补全。

将 `agents.mentions` 设为 `false` 可关闭此功能。

## 子代理浏览器

`/subagents [queued|finished|all|types|schedules|workflows]` 打开 `Subagents ▸ <页名>`。`/subagents workspace [queued|finished|all]` 以 workspace 范围打开 Runs。页面有 Runs、Types，以及启用时的 Schedules 和 Workflows。

| 按键 | 操作 |
| --- | --- |
| `1`–`4`、`[` / `]`、← / → | 切换页面。在 Runs 页，300 ms 内按两次 ← 关闭浏览器。 |
| `w` | Runs：切换范围（This session / Workspace）。 |
| `s` | Runs：循环切换状态（All / Queued / Finished）。 |
| `/`、Tab、Esc | 筛选、详情、返回。 |
| Enter | 打开该运行的对话记录（排队中的运行打开任务详情）。 |
| `m` | 向该运行发送消息，或回答它的问题。子代理已结束时使其恢复。 |
| `r` | 子代理有多次运行时：列出它的全部运行，新的在前。 |
| `j` | 该运行创建的 job。 |
| `c` | 修改该运行下一次请求使用的模型和 thinking。 |
| `b` | 把运行中的前台运行转为后台。 |
| 按两次 `x` | 停止运行子树，或取消排队中的运行。已结束但仍有残留 job 的运行，则清理这些 job。 |

Runs 每个子代理占一行，取其最新的运行；运行过多次的子代理标出 `N runs`。消息提示为 `Message <名称>`、`Resume <名称>` 或 `Answer parent question`。只有子代理的最新运行接收消息。

Workspace 范围中来自其他会话或其他分支的记录标为 **Read only**，可以阅读，但不能发送消息、停止或修改配置。

对话记录使用 Pi 自带的消息和工具组件。其中的额外按键：

| 按键 | 操作 |
| --- | --- |
| `o` | 展开或收起全部工具调用。 |
| `h` | 显示或隐藏 thinking。 |
| `d` | 详情：ID、cwd、来源、权限、用量和错误。 |
| `m`、`j`、`c`、`b`、`x` | 同列表。 |

停留在底部时，对话记录会跟随新输出；向上滚动暂停跟随，End 恢复。消息编辑器是 Pi 的多行编辑器：Enter 发送，Shift+Enter 或 Ctrl+J 换行，Esc 取消编辑但不停止运行。

Types 页列出全部类型，包括已禁用的类型（● 启用，○ 禁用），并显示模型和 thinking。Enter 或 `c` 设置该类型的默认模型和 thinking；`d` 启用或禁用该类型；`u`（Use definition）删除启用状态的覆盖。见 [类型与模型](types-and-models.md)。

## 错误

除 [通用错误码](../../tools.md#错误码) 外：配置的模型没有凭据时返回 `MODEL_UNAVAILABLE`；父级模型运行时无法共享时返回 `MODEL_RUNTIME_UNAVAILABLE`；任务关联相关的 `TASK_STALE` 和 `TASK_SCOPE`。
