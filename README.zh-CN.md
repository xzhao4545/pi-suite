# Pi Suite

[English](README.md) · [文档](docs/zh/index.md)

Pi Suite 是 [Pi](https://github.com/earendil-works/pi)（终端编码 agent）的扩展包，目标是装一个扩展就能满足用 Pi 做日常开发的大部分需要：模型可以向你提问、维护任务清单、运行并监督后台命令、跨轮次朝一个目标持续工作，以及把工作交给子代理。

这些能力原本分散在六个独立扩展里：`pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 和 `@tintinweb/pi-subagents`。Pi Suite 在它们的基础上把这些能力做成同一个扩展的模块，共用一套界面、存储层和通知队列，模块之间互相知道对方的存在，能够联动，而不只是并排安装。

## 模块如何联动

- **任务记录在别处运行的工作。** `job_start` 和 `agent_start` 可以带 `taskId`，job 或子代理的 ID 会记到该任务上。为某个任务启动的子代理可以读取并更新这个任务。
- **目标等待自己发起的工作。** `goal_wait` 让目标停下，直到列出的 job、子代理或 workflow 全部结束；job 监视器触发或子代理提问时会提前恢复。
- **子代理向父级提问。** 子代理调用 `ask_user` 时，问题发给启动它的会话，由该会话用 `agent_send` 回答。向你的提问和后台工作的结果互不打断。
- **一个 `wait` 等待所有对象。** 模型一次调用就能等待任意组合的 job、子代理和 workflow；其中有对象提问或监视器触发时也会返回。
- **一条通知队列。** 各模块的结果每次唤醒合并为一条消息，只投递给拥有该工作的会话。有提问或浏览器打开时会暂缓投递；因你取消提问而暂停的目标也会暂缓，等你发下一条消息时一起送达。
- **一个 Dock。** 目标、任务、子代理、job 和 workflow 共用编辑器上方的一个面板。在空编辑器中按 ← 可选择某一行，并在共用的浏览器中打开：`/tasks`、`/jobs` 和 `/subagents`，用于筛选、阅读对话记录和日志，以及控制运行。
- **Workflow 建立在其他模块之上。** Workflow 脚本批量派出子代理，每个子代理都能像普通子代理一样使用 job、任务和提问。

## 功能

| 模块 | 替代 | 提供的能力 |
| --- | --- | --- |
| [Ask](docs/zh/modules/ask.md) | `pi-ask-user` | `ask_user`：模型向你提出单个问题或 2–4 个批量问题，支持选项、默认值、多选、自由文字回答和空闲超时。 |
| [Goal](docs/zh/modules/goal.md) | `@narumitw/pi-goal` | `/goal <目标>`：模型跨轮次持续工作，直到附证据完成目标、报告阻塞，或由你暂停。可设置 token 预算。 |
| [Tasks](docs/zh/modules/tasks.md) | `@tintinweb/pi-tasks` | 两级任务清单（分组与子任务），由模型维护、在 Dock 中显示，支持依赖和原子批量编辑。 |
| [Jobs](docs/zh/modules/jobs/index.md) | `pi-background-jobs`、`pi-interactive-shell` | pipe 或 PTY 模式的后台命令：有界日志读取、输入、输出监视器、编码 agent CLI 预设、受监督终端；停止时逐一检查已捕获的进程是否退出，无法确认时报告 `unconfirmed`。 |
| [Agents](docs/zh/modules/agents/index.md) | `@tintinweb/pi-subagents` | 在同一进程中以 Pi 子会话运行的子代理：自定义类型、按类型配置模型与 thinking、`@handle` 提及、向父级提问、网络或上游错误后自动恢复、定时调度、脚本化 [Workflow](docs/zh/modules/agents/workflows.md)，以及供其他扩展使用的 [RPC 接口](docs/zh/modules/agents/rpc.md)。 |

本包还附带深色主题 `oh-my-pi`，以及 `pi-suite-jobs` 和 `pi-suite-workflow` 两个技能。安装后请移除对应的独立扩展，见[替换独立扩展](docs/zh/installation.md#替换独立扩展)。

## 安装

```sh
pi install npm:pi-suite
pi list
```

然后在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用。更新见 [安装](docs/zh/installation.md)。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/goal [--tokens 100k] <目标>` | 建立目标，模型跨轮次持续工作直到完成。`/goal status`、`edit`、`pause`、`resume`、`clear` 查看、修改、暂停、恢复或清除目标。 |
| `/tasks [组 ID]` | 浏览任务清单，可直接定位到某个组。 |
| `/jobs [finished\|all] [workspace]` | 浏览 job、阅读日志，或按 `i` 接管 PTY。默认只列活动 job 和当前会话。 |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | 浏览子代理运行、对话记录、类型、定时调度和 workflow；`/subagents workspace [...]` 查看整个工作区。 |
| `/suite` | 逐项查看和编辑设置。 |
| `/exit` | 退出 Pi，先停止 job 和子代理并等待清理，job 最多等待 10 秒。 |

在输入框中输入 `@<类型>`（例如 `@explore 配置是在哪里加载的？`）可把消息交给对应类型的子代理。

## 设置项

无需任何配置。可选设置位于 `~/.pi/agent/pi-suite.json`（用户级）和 `.pi/pi-suite.json`（项目级）；项目文件按字段覆盖用户文件。常用设置：

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `modules.<ask\|tasks\|jobs\|goal\|agents>` | `true` | 单独启用或关闭某个模块。 |
| `commands.exit` | `true` | 注册 `/exit`。 |
| `ui.maxRows` | `12` | Dock 最多占用的行数。 |
| `ui.highlightBuiltinCommands` | `true` | 高亮 Pi 内置 `bash`/`powershell` 调用中的命令。 |
| `ask.timeout` | `600000` | `ask_user` 的默认空闲超时（毫秒），`0` 为一直等待。 |
| `goal.display`、`agents.display`、`jobs.display` | `status` | 摘要显示在 footer 状态、Dock 还是隐藏。 |
| `tasks.reminders` | `true` | 模型多轮未更新任务时附加提醒。 |
| `agents.maxConcurrent` | `10` | 后台子代理并发上限。 |
| `agents.maxDepth` | `3` | 子代理最大嵌套层数（含主会话）。 |
| `agents.defaultModel`、`agents.types` | 未设置 | 子代理默认模型；按类型覆盖模型、thinking 和启用状态。 |
| `agents.mentions`、`agents.scheduling`、`agents.workflows` | `true` | `@handle` 提及、定时调度和 workflow。 |
| `jobs.detachKey`、`jobs.returnKey`、`jobs.transferKey` | `ctrl+]`、`ctrl+g`、`ctrl+t` | 终端视图的离开、交还模型和发送屏幕按键。 |
| `runtime.openAIResponsesAutoRecovery` | `false` | 自动修复一类 OpenAI Responses item ID 错误。 |

```json
{
  "modules": { "goal": false },
  "agents": { "maxConcurrent": 4, "types": { "Explore": { "model": "anthropic/claude-haiku-4-5" } } }
}
```

全部字段见 [配置](docs/zh/configuration.md)，也可以用 `/suite` 编辑。

## 文档

- [中文文档](docs/zh/index.md)
- [English documentation](docs/en/index.md)

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
```

源码结构和项目规则见 [开发](docs/zh/development.md)。

## 致谢与许可证

Pi Suite 改编了多个 MIT 许可的 Pi 扩展的代码和工具契约：`pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 和 `@tintinweb/pi-subagents`。主题基于 Oh My Pi 的 Titanium 配色。详情与许可证全文见 [`third-party/UPSTREAM.md`](third-party/UPSTREAM.md)。

Pi Suite 以 [MIT 许可证](LICENSE) 发布。
