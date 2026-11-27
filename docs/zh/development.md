# 开发

[文档索引](index.md)

## 环境与检查

需要 Node.js 24+ 和 pnpm 12.6.0。在包根目录运行：

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # Node 内置测试运行器，带 TypeScript 转换
```

Pi 直接加载 TypeScript 源码，没有构建步骤。试用修改：

```sh
pnpm exec pi -e .                # 整个包，含技能和主题
pnpm exec pi -e ./src/index.ts   # 仅扩展
```

修改源码后执行 `/reload`。升级依赖后需要重启 Pi，因为 `/reload` 不会替换 Pi 自身已加载的模块。

要把源码目录作为日常使用的安装来源，安装该目录并移除 npm 包，保证只剩一份 Pi Suite 来源：

```sh
pi install /absolute/path/to/pi-suite
pi remove npm:pi-suite
pi list
```

Pi 直接加载该目录，因此目录需要保持可访问。依赖变化后先运行 `pnpm install`。`-l` 只决定哪个设置文件记录该来源。

`pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 纳入版本控制。工作区文件让 lockfile 保留 Windows 与 Linux 的可选依赖（`supportedArchitectures`），并禁用两个只打印消息的依赖安装脚本（`allowBuilds`）。lockfile 的变化与引起它的 `package.json` 修改一起提交。

## 源码结构

| 路径 | 内容 |
| --- | --- |
| `src/index.ts` | 唯一的扩展入口。 |
| `src/runtime/` | 会话绑定、配置、通知、JSON 存储、共享 `wait`、工具注册与渲染、`/suite` 设置、Responses 恢复。 |
| `src/ui/` | Dock、浏览器、详情与阅读视图、工具显示、命令高亮。 |
| `src/ask/` | `ask_user`。 |
| `src/goal/` | 目标状态、生命周期、上下文和 `/goal`。 |
| `src/tasks/` | 任务存储、模型、工具和 `/tasks`。 |
| `src/jobs/` | job 管理器、pipe/PTY 后端、监视器、预设、终端和 `/jobs`。 |
| `src/agents/` | 子代理管理器、运行器、类型与资源、提及、定时调度、RPC、workflow 和 `/subagents`。 |
| `skills/` | `pi-suite-jobs` 和 `pi-suite-workflow` 技能。 |
| `themes/` | `oh-my-pi` 主题。 |
| `tests/` | 按模块分组的测试，共用辅助代码位于 `tests/support/`。 |
| `third-party/` | 上游来源记录和许可证。 |

模块按需加载：查看器、PTY 后端、子代理运行器和 workflow Worker 在首次使用时才导入。

## 文档

| 位置 | 读者与内容 |
| --- | --- |
| `README.md`、`README.zh-CN.md` | 项目概览。 |
| `docs/en/`、`docs/zh/` | 用户文档，中英文保持同步。用户可见的行为变化时需要同步更新。 |
| `doc/current/` | 维护者文档（中文）：当前设计、协议、数据模型和验证。 |
| `doc/todo/`、`doc/finished/` | 计划中的工作和已归档的完成工作。 |

代码和文档的项目规则见 [`AGENTS.md`](../../AGENTS.md)。

## 发布

本包以 `pi-suite` 发布到 npm。推送 `v*` tag 会运行 `.github/workflows/publish.yml`：先检查 tag 与 `package.json` 的 `version` 一致，再运行 `pnpm typecheck` 和 `pnpm test`，然后通过 npm trusted publishing 发布，仓库不保存 npm token。发布包只包含 `package.json` 中 `files` 列出的路径。

发布新版本：

1. 升级 `package.json` 的 `version` 并提交。
2. 创建同名附注 tag，例如 `git tag -a v0.3.1 -m "pi-suite 0.3.1"`。
3. 推送提交和 tag：`git push origin main v0.3.1`。

## 平台覆盖

- 支持的宿主：官方未修改的 Pi 1.6.1 及更高版本。peer 依赖为 `>=1.6.1`，开发依赖精确固定为 `1.6.1` 作为测试基线；适配新 Pi 版本时同步升级开发依赖。
- 已在 Linux 和 Windows 上验证，各模块的验证范围记录在 [`doc/current/validation.md`](../../doc/current/validation.md)。
- 子代理通过受保护地读取 Pi 的一个私有字段来共享父级模型运行时。Pi 升级可能破坏这一点；这种失败报告为 `MODEL_RUNTIME_UNAVAILABLE`，本套件从不退回到独立的运行时。

## 上游来源

本套件的部分内容改编自 MIT 许可的扩展：`pi-ask-user`、`@tintinweb/pi-tasks`、`pi-interactive-shell`、`pi-background-jobs`、`@narumitw/pi-goal` 和 `@tintinweb/pi-subagents`。主题基于 Oh My Pi 的 Titanium 配色（MIT）。版本、导入的文件和许可证全文见 [`third-party/UPSTREAM.md`](../../third-party/UPSTREAM.md) 和 [`third-party/licenses/`](../../third-party/licenses/)。

OpenAI Responses 恢复参考了 `pi-model-manager`（AGPL-3.0-only）的行为，但为独立实现，未复制其代码。
