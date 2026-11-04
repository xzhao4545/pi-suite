# pi-suite

自定义 Pi 扩展包。使用 pnpm 管理依赖，按模块逐步实现询问、两级任务管理、后台执行、goal 和 subagents 功能。

当前提供统一界面与会话绑定基础，以及 ask_user 的批量、多选、推荐、默认答案、超时和历史查阅能力。业务专项进度维护在 doc/todo。

## 开发

需要 Node.js 24 或更高版本，以及 pnpm 12.6.0。

```sh
pnpm install
pnpm typecheck
pnpm test
```

开发时使用本地扩展入口：

```sh
pi -e ./src/index.ts
```

Pi 直接加载 TypeScript 扩展，因此当前不需要构建产物。

运行时使用 /suite 查看配置，询问操作和配置说明见 [ask](./doc/current/ask/index.md) 与 [公共运行时](./doc/current/runtime/index.md)。启用 ask_user 时从实际加载列表移除原版 pi-ask-user，以免同名工具重复注册。

## 目录

```text
src/
  index.ts          扩展入口
  ui/               面板布局、焦点与消息渲染
  runtime/          会话绑定与通知协调
  ask/              用户询问
  tasks/            两级任务管理
  jobs/backends/    后台执行与平台后端
  goal/             目标与续跑
  agents/           subagent 管理与查看
doc/
  current/          当前实现与开发方式
  todo/             设计、需求与实施计划
  finished/         已完成专项
third-party/
  UPSTREAM.md       上游来源记录
  licenses/         上游许可证
```

设计与实施计划见 [doc/todo/pi-suite](./doc/todo/pi-suite/index.md)，当前项目状态见 [doc/current](./doc/current/index.md)。Pi 相关依赖以 1.5.0 为开发基线；pnpm-lock.yaml 应提交到版本控制。
