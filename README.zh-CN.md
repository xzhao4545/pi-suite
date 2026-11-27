# Pi Suite

[English](README.md) · [文档](docs/zh/index.md)

Pi Suite 是 [Pi](https://github.com/earendil-works/pi)（终端编码 agent）的扩展包。它把交互式提问、任务清单、后台任务、持久目标和子代理整合为一个扩展，共用同一套界面、存储层和通知队列。

## 功能

| 模块 | 提供的能力 |
| --- | --- |
| [Ask](docs/zh/modules/ask.md) | `ask_user`：模型向你提出单个问题或 2–4 个批量问题，支持选项、默认值、多选、自由文字回答和空闲超时。 |
| [Goal](docs/zh/modules/goal.md) | `/goal <目标>`：模型跨轮次持续工作，直到附证据完成目标、报告阻塞，或由你暂停。可设置 token 预算。 |
| [Tasks](docs/zh/modules/tasks.md) | 两级任务清单（分组与子任务），由模型维护、在 Dock 中显示，支持依赖和原子批量编辑。 |
| [Jobs](docs/zh/modules/jobs/index.md) | pipe 或 PTY 模式的后台命令：有界日志读取、输入、输出监视器、编码 agent CLI 预设、受监督终端；停止时逐一检查已捕获的进程是否退出，无法确认时报告 `unconfirmed`。 |
| [Agents](docs/zh/modules/agents/index.md) | 在同一进程中以 Pi 子会话运行的子代理：自定义类型、按类型配置模型与 thinking、`@handle` 提及、向父级提问、网络或上游错误后自动恢复、定时调度、脚本化 [Workflow](docs/zh/modules/agents/workflows.md)，以及供其他扩展使用的 [RPC 接口](docs/zh/modules/agents/rpc.md)。 |

共享部分：

- **Dock**：编辑器上方的面板，显示目标、任务、子代理、job 和 workflow。在空编辑器中按 ← 可选择某一行并打开。
- **浏览器**：`/tasks`、`/jobs` 和 `/subagents`，用于筛选、阅读对话记录和日志，以及控制运行。
- **`wait`**：一个工具即可等待任意组合的 job、子代理和 workflow。
- **通知**：结果和提问会合并，并只向所属会话投递一次。
- **附带资源**：深色主题 `oh-my-pi`，以及 `pi-suite-jobs` 和 `pi-suite-workflow` 两个技能。

## 环境要求

- Node.js 24 或更高版本。

## 安装

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

然后在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用。更新与本地目录安装见 [安装](docs/zh/installation.md)。

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
