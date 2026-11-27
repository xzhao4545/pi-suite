# Pi Suite 文档

[English](../en/index.md) · [项目 README](../../README.zh-CN.md)

本文档介绍 Pi Suite 的安装、配置和使用方法，面向 Pi 用户，以及编写依赖本套件工具的提示词、agent 类型或 workflow 的人。面向维护者的实现设计说明位于 [`doc/current`](../../doc/current/index.md)。

## 入门

- [安装](installation.md)：从 GitHub 或本地目录安装、更新，以及移除被本套件替代的独立扩展。
- [基本概念](concepts.md)：会话与归属、ID、通知、共享 `wait` 工具，以及 `/reload` 后保留哪些内容。
- [配置](configuration.md)：`pi-suite.json` 字段、优先级、`/suite` 设置页、`/exit` 和 OpenAI Responses 恢复。
- [界面](interface.md)：Dock、浏览器与阅读视图、footer 状态、附带主题和命令高亮。

## 模块

- [Ask](modules/ask.md)：`ask_user` 提问、默认值、超时和结果状态。
- [Goal](modules/goal.md)：`/goal`、目标生命周期、预算和 `goal_*` 工具。
- [Tasks](modules/tasks.md)：两级任务清单、代次（generation）、`/tasks` 和提醒。
- [Jobs](modules/jobs/index.md)：pipe 与 PTY 后台任务、日志、监视器和 `/jobs`。
  - [CLI 预设与 PTY 监督](modules/jobs/cli-and-hands-free.md)
- [Agents](modules/agents/index.md)：同进程子代理、`/subagents`、`@handle` 提及和父级提问。
  - [Agent 类型、模型与资源](modules/agents/types-and-models.md)
  - [定时调度](modules/agents/schedules.md)
  - [Workflow](modules/agents/workflows.md)
  - [跨扩展 RPC](modules/agents/rpc.md)

## 参考

- [模型工具](tools.md)：本套件注册的全部工具、参数入口和错误码。
- [技能](skills.md)：`pi-suite-jobs` 和 `pi-suite-workflow` 技能。
- [开发](development.md)：源码结构、检查命令、文档规则和平台覆盖范围。
