# 当前项目文档

本目录记录当前实现和稳定规则；需求及未完成专项维护在 [待办索引](../todo/index.md)，已完成专项归入 [完成索引](../finished/index.md)。

## 项目状态

- 项目是单个 pnpm 包，包名为 pi-suite，package.json 设置 private: true。
- Node.js 要求为 24 或更高，包管理器固定为 pnpm 12.6.0。
- 源码使用 TypeScript 和 ESM；Pi 通过 package.json 的 pi.extensions 加载 src/index.ts。
- src/index.ts 是唯一扩展入口，注册 ask_user、goal_complete/goal_blocked/goal_wait、job_start/job_list/job_read/job_write/job_stop、共享 wait、/goal、/suite 及会话生命周期事件。
- 源码目录按 ui、runtime、ask、tasks、jobs/backends、goal、agents 划分；上游来源登记位于 third-party/UPSTREAM.md。
- Pi 开发依赖固定为 1.5.0；jobs 运行依赖固定为 zigpty 0.1.6、@xterm/headless 5.5.0、@xterm/addon-serialize 0.13.0。依赖解析记录在 pnpm-lock.yaml。

## 模块文档

- [公共运行时与配置](./runtime/index.md) — 会话绑定、统一通知、模块开关及配置优先级。
- [统一界面](./ui/index.md) — dock 高度预算、状态发布与原生历史组件。
- [ask 接口与操作](./ask/index.md) — 默认值、批量、多选、超时、搜索及焦点。
- [目标管理](./goal/index.md) — 持久目标、运行调度、宿主恢复、预算和操作。
- [执行任务](./jobs/index.md) — pipe/PTY job、记录与日志、停止证据、工具、通知和同进程保活。
- [基线与验证](./validation.md) — 依赖来源、目标平台和必要检查范围。

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
