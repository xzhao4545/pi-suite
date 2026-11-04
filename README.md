# pi-suite

自定义 Pi 扩展包。使用 pnpm 管理依赖，按模块逐步实现询问、两级任务管理、后台执行、goal 和 subagents 功能。

当前已建立项目骨架和扩展入口，尚未实现具体功能。

## 开发

需要 Node.js 24 或更高版本，以及 pnpm 12.6.0。

```sh
pnpm install
pnpm typecheck
```

开发时使用本地扩展入口：

```sh
pi -e ./src/index.ts
```

Pi 直接加载 TypeScript 扩展，因此当前不需要构建产物。

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
