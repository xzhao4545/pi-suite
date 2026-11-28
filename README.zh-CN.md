# Pi Suite

[English](README.md) · [文档](docs/zh/index.md)

[Pi](https://github.com/earendil-works/pi)（终端编码 agent）的扩展整合包，把六个独立扩展整合为五个模块：目标、子代理、用户提问、后台任务和任务清单。各模块共用一套存储层、通知队列和编辑器上方的面板（Dock）。

## 安装

```sh
pi install npm:pi-suite
pi list
```

在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用。更新方式见[安装](docs/zh/installation.md)。

扩展包附带两个技能：`pi-suite-jobs` 指导模型以 job 形式运行命令和编码 agent CLI，`pi-suite-workflow` 指导模型编写和续跑 workflow 脚本。

## 模块

| 模块 | 上游来源 |
| --- | --- |
| [Goal](docs/zh/modules/goal.md) | `@narumitw/pi-goal` |
| [Agents](docs/zh/modules/agents/index.md) | `@tintinweb/pi-subagents` |
| [Ask](docs/zh/modules/ask.md) | `pi-ask-user` |
| [Jobs](docs/zh/modules/jobs/index.md) | `pi-background-jobs`、`pi-interactive-shell` |
| [Tasks](docs/zh/modules/tasks.md) | `@tintinweb/pi-tasks` |

### Goal

`/goal <目标>` 为当前会话设定一个目标。模型跨轮次持续工作，直到附证据完成目标（`goal_complete`）、报告阻塞（`goal_blocked`），或由你暂停。`--tokens 100k` 可设置 token 预算。`goal_wait` 等待 job、子代理和 workflow 的方式与 `wait` 相同（见 [Agents](#agents)）。

### Agents

子代理是在同一进程中运行的 Pi 子会话，可在前台或后台运行。

- **类型**：内置 `general-purpose`、`Explore` 和 `Plan`，也可以在 `~/.pi/agent/agents/`（用户级）或 `.pi/agents/`（项目级）用 Markdown 文件定义自定义类型。类型决定系统提示、工具、模型、thinking 级别、轮次上限、技能和持久记忆；`agents.types` 可覆盖任意类型的模型和 thinking。见 [Agent 类型、模型与资源](docs/zh/modules/agents/types-and-models.md)。
- **提及**：在输入框中输入 `@<类型> <消息>`，例如 `@explore 配置是在哪里加载的？`，消息会交给该类型的子代理。
- **提问**：子代理的 `ask_user` 问题发给启动它的会话。
- **恢复**：子代理因网络或上游错误中断后，会在同一会话中继续。
- **等待**：`wait` 可等待任意组合的 job、子代理和 workflow，监视器触发或子代理提问时提前返回。

子代理还可以按[定时调度](docs/zh/modules/agents/schedules.md)运行。[Workflow](docs/zh/modules/agents/workflows.md) 脚本批量派出子代理，并可从之前的运行继续。其他扩展可通过 [RPC 接口](docs/zh/modules/agents/rpc.md)启动和控制子代理。

### Ask

`ask_user` 让模型向你提出单个问题或 2–4 个批量问题，支持选项、默认值、多选、自由文字回答和空闲超时（`ask.timeout`）。

### Jobs

job 以 pipe 或 PTY 模式在后台运行命令。模型可以分段读取有界日志、发送输入，并设置输出监视器，在匹配字面量、正则或数值阈值时被唤醒。在 `/jobs` 中可以阅读日志，或按 `i` 接管 PTY。

预设可在 PTY 中启动编码 agent CLI，由模型免手动监督，你也可以随时接管终端。见 [CLI 预设与 PTY 监督](docs/zh/modules/jobs/cli-and-hands-free.md)。

停止 job 时会逐一检查已捕获的进程是否退出，无法确认时报告 `unconfirmed`。

### Tasks

两级任务清单（分组与子任务），由模型维护、在 Dock 中显示，支持依赖和原子批量编辑。job 或子代理可以关联到任务，为某个任务启动的子代理可以更新该任务。

## 界面

Dock 显示目标、任务、子代理、job 和 workflow；在空编辑器中按 ← 可选择某一行。`/tasks`、`/jobs` 和 `/subagents` 使用同一种浏览布局，详情面板为名称、ID、状态和错误着色。

每个套件工具调用和通知只占一行，展开后显示带标签的字段；工具失败时折叠行显示错误的第一行。各模块的结果每次唤醒合并为一条通知，只投递给拥有该工作的会话。

Pi 内置 `bash` / `powershell` 调用和 job 中的命令按结构高亮：程序、选项、变量、字符串、运算符和重定向。高亮只扫描文本，从不执行命令。

扩展包还提供深色主题 `oh-my-pi`，并使 Pi 的复制在 tmux 中经 OSC 52 转发到本地终端。见[界面](docs/zh/interface.md)。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/goal [--tokens 100k] <目标>` | 建立目标。`/goal status`、`edit`、`pause`、`resume`、`clear` 查看、修改、暂停、恢复或清除目标。 |
| `/tasks [组 ID]` | 浏览任务清单，可直接定位到某个组。 |
| `/jobs [finished\|all] [workspace]` | 浏览 job、阅读日志，或按 `i` 接管 PTY。默认只列当前会话的活动 job。 |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | 浏览子代理运行、对话记录、类型、定时调度和 workflow；`/subagents workspace [...]` 查看整个工作区。 |
| `/suite` | 逐项查看和编辑设置。 |
| `/exit` | 退出 Pi，先停止 job 和子代理并等待清理，job 最多等待 10 秒。 |

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
| `runtime.openAIResponsesAutoRecovery` | `false` | OpenAI Responses 端点因历史来自其他上游账号（例如经过网关）而拒绝请求时，移除被拒的 item ID 或加密 reasoning 后继续。见 [OpenAI Responses 恢复](docs/zh/configuration.md#openai-responses-恢复)。 |

```json
{
  "modules": { "goal": false },
  "agents": { "maxConcurrent": 4, "types": { "Explore": { "model": "anthropic/claude-haiku-4-5" } } }
}
```

全部字段见[配置](docs/zh/configuration.md)，也可以用 `/suite` 编辑。

## 文档

- [中文文档](docs/zh/index.md)
- [English documentation](docs/en/index.md)

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
```

源码结构和项目规则见[开发](docs/zh/development.md)。

## 致谢与许可证

Pi Suite 改编了多个 MIT 许可的 Pi 扩展的代码和工具契约：`pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 和 `@tintinweb/pi-subagents`。主题基于 Oh My Pi 的 Titanium 配色。详情与许可证全文见 [`third-party/UPSTREAM.md`](third-party/UPSTREAM.md)。

Pi Suite 以 [MIT 许可证](LICENSE) 发布。
