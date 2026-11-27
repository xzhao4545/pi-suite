# 工具与通知渲染完善

## 目标

1. `pi-suite:notification` 中可见的事件按来源结构化渲染。折叠时每个事件占一行，展开后显示正文。事件包括 agent 结果与提问、job 更新、监控事件、job 结果、workflow 结果和 schedule 失败。
2. `pi-suite:job-screen` 消息与附着的 `job_start` 结果共用一套屏幕渲染。
3. Ask 历史和 agent Transcript 使用 Pi 的消息渲染器与条目渲染器，并遵循展开状态。
4. `StructuredOutput` 有自己的调用行和结果渲染。
5. 工具错误可以折叠，渲染不依赖模型回执的文本。
6. 各 `browse` 页面右侧（窄屏时在下方）的 Details 面板按内容角色着色。

## 现状

- 通知：`Notifications.take()`（`src/runtime/notifications.ts`）把各事件的文本作为 content blocks 发出，details 只有 `{requestId, source}`。`goalNotificationRenderer`（`src/goal/render.ts`）把文本直接拼接显示，没有折叠，provider 返回的错误 JSON 原样显示。job 的 quiet 发送路径不带 details，走 Pi 默认的 Markdown 渲染。
- 屏幕：`pi-suite:job-screen`（`src/jobs/viewer.ts`）走 Pi 默认的 Markdown 渲染，没有折叠。附着的 `job_start`（`src/jobs/render.ts`）可以折叠，但展开后是原始屏幕回执。两处都没有结构化的屏幕数据。
- Transcript：`src/ui/transcript.ts` 只查工具渲染器。自定义消息没有查找渲染器，自定义条目被跳过。
- `StructuredOutput`（`src/agents/output/tool.ts`）没有渲染槽，details 为空，回放时参数和结果都原样显示。
- 错误：`src/ui/tool-render.ts` 在折叠和展开时都显示完整诊断。`agent_read`、`job_read`、`job_write`、`goal_complete`、`goal_wait` 以及 `agent_start/get/send/stop`、`job_get/stop`、`task_get` 展开时混入了回执文本，`job_write` 靠正则从回执中取字节数。
- workflow：`agent_workflow` 没有缓存时回退为文本；workflow 条目忽略展开状态，agents 模块禁用时也不注册渲染器。
- Details 面板：`BrowseItem.details` 返回一整段纯文本，`BrowserView` 用 `Text` 原样显示。标签、值、状态、ID、时间、路径、prompt 和错误都是同一种颜色。涉及 `agentDetails`（`src/agents/viewer-info.ts`）、`jobDetail`（`src/jobs/query.ts`）、`taskDetails`（`src/tasks/query.ts`）、Types、Schedules、Workflows 的 details。

## 方案

### 1. 通知

- 模型看到的 content 文本不变，只改显示。
- 每个 segment 增加可选的 `view` 字段：`{ title, state?, meta?, body? }`。由产生事件的模块填写：`src/agents/index.ts`（结果）、`src/agents/questions.ts`（提问）、`src/jobs/index.ts`（更新、事件、结果）、`src/agents/schedules/index.ts`（失败）、`src/agents/workflow/index.ts`（结果）。quiet 发送路径同样带 details。
- 渲染器放在 `src/runtime/`，通知队列也在这里；`src/goal/render.ts` 只保留 Goal 自己的渲染。
  - 折叠：每个可见 segment 一行，格式为 `title · state · meta`，state 使用现有的状态色。
  - 展开：每行下面显示 body。
  - agent 失败时，若错误是 provider 的 JSON，body 显示其中的 `error.message`。
  - 没有 `view` 的 segment（旧历史）按现在的方式显示文本。
  - 可见性保持不变：`goal-continuation` 不显示，reminder 的 `display` 仍为 false，含图片的事件仍交给 Pi 的默认渲染。
- title 取值：`Agent result`、`Agent question`、`Job update`、`Job events`、`Job result`、`Workflow result`、`Schedule failed`。

### 2. 屏幕

- `pi-suite:job-screen` 的 details 带上 job ID、状态和 `screenLines`。
- 折叠时显示 `Job screen · <id> · <state>`，展开时逐行原样显示屏幕内容。附着的 `job_start` 使用同一个函数。

### 3. Transcript

- `src/ui/transcript.ts` 像主会话一样，从 Pi 的注册表取消息渲染器和条目渲染器，并传入展开状态。

### 4. StructuredOutput

- 为 live 和回放都注册渲染槽：调用行 `StructuredOutput`；折叠时显示 `accepted` 或 `rejected`；展开时显示 payload 或校验错误。

### 5. 错误折叠与回执

- `toolRenderers` 的错误：折叠时只显示诊断的第一行，展开时显示完整诊断。
- `agent_read`、`job_read`：展开后原样显示 `page.text`，分页和 stderr 信息作为字段单独显示。
- `job_write`：details 增加 `bytesSent` 和 `stdinClosed`，脱敏逻辑不变。
- `goal_complete` 展开后显示 summary；`goal_wait` 不重复回执文本。
- 其他工具展开后只显示 details 中的字段，不附回执文本。
- workflow：持久化快照，回放时不依赖文本；条目渲染器在扩展加载时注册，并遵循展开状态。

### 6. Details 面板着色

- 在 `src/ui/` 增加共用的结构化详情组件：页面只提供数据，配色由组件决定，符合 `browser-chrome.ts` "pages provide data, never ANSI or palette choices" 的约定。
  - 标题（对象名）：`heading`。
  - 字段行：标签 muted，值按角色着色。状态用现有的 `stateTone`；ID 和 run ID 用 accent；时间戳、路径、来源标记（如 `(type)`）用 dim；数字、token 和费用保持 toolOutput。
  - 分组：空行分隔身份、模型、用量、时间、关联等分组。
  - 正文块（prompt、description、command）保持原样、不走 Markdown；错误块用 error 色。
  - 所有值先 `sanitizeText` 再着色。
- `BrowseItem.details` 既可返回字符串，也可返回结构化详情，全部页面改用结构化详情。`/` 搜索在去掉颜色后的文本上匹配，行为不变。
- 模型可见的工具结果不变。`jobDetail`、`taskDetails` 等同时被工具结果使用的函数，由同一份结构化数据分别生成文本和着色视图，不写两份字段列表。
- `showDetails` 打开的全屏 Details（如 Runs 的 `d`、Transcript 的 Details）使用同一组件。

## 分批

| 批 | 范围 | 开始条件 |
| --- | --- | --- |
| A | 方案 1，不含 workflow 结果 | 立即 |
| B | 方案 2、3 | 立即 |
| C | 方案 4、5，以及 workflow 结果通知 | `agent-retry-wait` 结束（同改 `src/ui/tool-render.ts`、`src/agents/runner.ts`），workflow 部分还要等 `src/agents/workflow/` 的文本整理结束 |
| D | 方案 6 | 立即；不改 `src/ui/tool-render.ts`、`src/agents/runner.ts`、`src/agents/viewer.ts` 的 Transcript 部分（C 在改） |

## 约束

- 不改 Pi，不新增配置项，不提交。
- 代码由 GPT subagent 写。可见文本只用本文给出的字符串，其余文本由父会话补写。
- 复用 `toolRenderers`、`ToolLine`、`DisplayField` 和状态色，不另建一套渲染系统。
- 测试只覆盖以下契约：
  - 通知折叠和展开的行；
  - 没有 `view` 的旧通知仍能显示；
  - Transcript 使用注册的消息渲染器；
  - 错误折叠后只剩一行；
  - 结构化详情在去掉颜色后与纯文本内容一致。

## 相关文档

- `doc/current/runtime/index.md`（通知）、`doc/current/ui/index.md`（工具行与 Transcript）
- `doc/current/agents/operations.md`、`doc/current/jobs/index.md`
- `docs/*/interface.md`

## 任务

- [ ] 1 通知结构化渲染
- [ ] 2 屏幕渲染共用
- [ ] 3 Transcript 使用注册的渲染器
- [ ] 4 StructuredOutput 渲染
- [ ] 5 错误折叠与去除回执依赖
- [ ] 6 Details 面板着色
- [ ] 同步 doc/current 与 docs
