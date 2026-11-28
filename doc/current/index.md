# 当前项目文档

本目录记录当前实现和稳定规则；需求及未完成专项维护在 [待办索引](../todo/index.md)，已完成专项归入 [完成索引](../finished/index.md)。

## 项目状态

| 项目 | 当前值 |
| --- | --- |
| 包 | 单个 pnpm 包 `pi-suite`，版本 `0.3.1`，Git tag `v0.3.1`，发布到 npm，见[发布](./installation.md#发布) |
| 工具链 | Node.js ≥24、pnpm `12.6.0`，TypeScript 和 ESM |
| 扩展入口 | Pi 通过 `package.json` 的 `pi.extensions` 加载 `src/index.ts`；工具、命令和事件见[入口与注册](./runtime/index.md#入口与注册) |
| 源码 | `src/ui`、`src/runtime`、`src/ask`、`src/tasks`、`src/jobs`（含 `backends`）、`src/goal`、`src/agents`；上游来源见 `third-party/UPSTREAM.md` |
| 依赖 | Pi 版本见[宿主加载边界](./runtime/index.md#宿主加载边界)。jobs 依赖 `zigpty` 0.1.6、`@xterm/headless` 5.5.0、`@xterm/addon-serialize` 0.13.0；`@narumitw/pi-starship` 0.65.2 仅用于开发时验证完整 footer。解析版本见 `pnpm-lock.yaml` |

## 模块文档

- [安装与发布](./installation.md) — 安装、更新、加载源码和发布。
- [公共运行时与配置](./runtime/index.md) — 模块加载、配置优先级、JSON 存储、会话绑定与通知。
- [模型工具契约](./runtime/tools.md) — 公共参数、分页、等待、显示与错误码。
- [设置与退出操作](./runtime/settings.md) — 用 `/suite` 编辑设置，用 `/exit` 退出 Pi。
- [Responses 历史 ID 恢复](./runtime/responses-recovery.md) — 可独立重放请求的恢复条件、隔离记录和重试。
- [统一界面](./ui/index.md) — Dock 布局与高度、状态栏、查看器和原生历史组件。
- [主题](./ui/themes.md) — 参考配色、主题资源、选择方式及终端和 footer 的边界。
- [命令结构高亮](./ui/command-highlighting.md) — Bash／PowerShell 高亮、主题、缓存和内置工具显示。
- [ask 接口与操作](./ask/index.md) — 询问字段、批量顺序、多选、超时、搜索和焦点。
- [目标管理](./goal/index.md) — 会话目标、自动续跑、等待、暂停、恢复和存储。
- [两级任务管理](./tasks/index.md) — 任务组与子任务、批量编辑、进度、存储、Dock 和提醒。
- [执行任务](./jobs/index.md) — pipe/PTY job、记录、日志、停止、工具和通知。
  - [PTY 监督与委派](./jobs/hands-free.md) — 监测输出、监督更新与终端接管。
  - [CLI 预设与直接启动](./jobs/launch.md) — 普通命令、预设和 monitor 的启动参数。
- [Pi 子代理](./agents/index.md) — 同进程子会话、并发队列、运行记录、父级提问、任务共享与级联停止。
  - [Workflow 编排](./agents/workflow/index.md) — 脚本资源、运行记录、等待与控制。
- [基线与验证](./validation.md) — 宿主版本、支持与平台范围、模块验证结论和当前测试集。

## 版本控制

- 提交源码、目录占位文件、AGENTS.md、文档、上游来源与许可证，以及 package.json、pnpm-lock.yaml、pnpm-workspace.yaml、.npmrc 和 TypeScript 配置。
- .gitignore 排除依赖、本地 pnpm 缓存、构建与测试产物、包根目录的打包文件、日志、临时文件、环境变量文件和编辑器本地状态。
- .env.example 与 .env.*.example 可作为无凭据配置模板提交；VS Code 的 extensions.json、settings.json、tasks.json、launch.json 可作为共享项目配置提交。

## 开发与检查

从包根目录运行：

```sh
pnpm install
pnpm typecheck
pnpm test
```

开发入口：

```sh
pi -e ./src/index.ts
```

Pi 直接加载 TypeScript 扩展；类型检查使用 tsc --noEmit。测试使用 Node 内置测试运行器和 TypeScript 转换，覆盖实际 Pi SDK 工具包装器及原生 TUI 组件。
