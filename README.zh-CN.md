# Pi Suite

[English](README.md) · [文档](docs/zh/index.md)

Pi Suite 是 [Pi](https://github.com/earendil-works/pi)（终端编码 agent）的扩展包。它把交互式提问、任务清单、后台任务、持久目标和子代理整合为一个扩展，共用同一套界面、存储层和通知队列。

它运行在官方未修改的 Pi 1.5.0 上，不需要修改 Pi 本身。当前版本为 0.1.2（Git tag `v0.1.2`）。

## 功能

| 模块 | 提供的能力 |
| --- | --- |
| [Ask](docs/zh/modules/ask.md) | `ask_user`：模型向你提出单个问题或 2–4 个批量问题，支持选项、默认值、多选、自由文字回答和空闲超时。 |
| [Goal](docs/zh/modules/goal.md) | `/goal <目标>`：模型跨轮次持续工作，直到附证据完成目标、报告阻塞，或由你暂停。可设置 token 预算。 |
| [Tasks](docs/zh/modules/tasks.md) | 两级任务清单（分组与子任务），由模型维护、在 Dock 中显示，支持依赖和原子批量编辑。 |
| [Jobs](docs/zh/modules/jobs/index.md) | pipe 或 PTY 模式的后台命令：有界日志读取、输入、输出监视器、编码 agent CLI 预设、受监督终端；停止时逐一检查已捕获的进程是否退出，无法确认时报告 `unconfirmed`。 |
| [Agents](docs/zh/modules/agents/index.md) | 在同一进程中以 Pi 子会话运行的子代理：自定义类型、按类型配置模型与 thinking、`@handle` 提及、向父级提问、定时调度、脚本化 [Workflow](docs/zh/modules/agents/workflows.md)，以及供其他扩展使用的 [RPC 接口](docs/zh/modules/agents/rpc.md)。 |

共享部分：

- **Dock**：编辑器上方的面板，显示目标、任务、子代理、job 和 workflow。在空编辑器中按 ← 可选择某一行并打开。
- **浏览器**：`/tasks`、`/jobs` 和 `/subagents`，用于筛选、阅读对话记录和日志，以及控制运行。
- **`wait`**：一个工具即可等待任意组合的 job、子代理和 workflow。
- **通知**：结果和提问会合并，并只向所属会话投递一次。
- **附带资源**：深色主题 `oh-my-pi`，以及 `pi-suite-jobs` 和 `pi-suite-workflow` 两个技能。

## 环境要求

- Node.js 24 或更高版本。
- Pi 1.5.0（官方版本）。不支持其他 Pi 版本。
- Linux 或 Windows。

## 安装

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

然后在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用。

本包已在本仓库中加载并测试；从其他项目以 Git、本地路径或 tarball 方式安装尚未验证。

如果你在使用 `pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 或 `@tintinweb/pi-subagents`，请移除它们，避免工具重复注册。本地安装、更新和替换这些扩展的方法见 [安装](docs/zh/installation.md)。

## 快速上手

| 试一试 | 效果 |
| --- | --- |
| `/goal 让测试全部通过` | 建立目标；目标保持活动期间，模型跨轮次持续工作。 |
| 让模型“在后台启动开发服务器，就绪后告诉我” | 模型启动带监视器的 job，输出匹配时被唤醒。 |
| `@explore 配置是在哪里加载的？` | 把问题发给 Explore 子代理。 |
| `/subagents` | 浏览子代理运行、对话记录、类型、定时调度和 workflow。 |
| `/jobs` | 浏览 job、阅读日志，或按 `i` 接管 PTY。 |
| `/tasks` | 浏览任务清单。 |
| `/suite` | 编辑设置。 |
| `/exit` | 退出 Pi。套件会停止 job 和子代理并等待清理完成，job 最多等待 10 秒。 |

## 配置

无需任何配置。可选设置位于 `~/.pi/agent/pi-suite.json`（用户级）和 `.pi/pi-suite.json`（项目级）；项目文件按字段覆盖用户文件。

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
pnpm exec pi -e .
```

源码结构和项目规则见 [开发](docs/zh/development.md)。

## 致谢与许可证

Pi Suite 改编了多个 MIT 许可的 Pi 扩展的代码和工具契约：`pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 和 `@tintinweb/pi-subagents`。主题基于 Oh My Pi 的 Titanium 配色。详情与许可证全文见 [`third-party/UPSTREAM.md`](third-party/UPSTREAM.md)。

Pi Suite 以 [MIT 许可证](LICENSE) 发布。
