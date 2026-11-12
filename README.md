# pi-suite

当前版本：`0.1.2`，对应 Git tag：`v0.1.2`。

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
pnpm exec pi -e ./src/index.ts
```

开发依赖使用官方未修改的 Pi 1.5.0；Pi 包的 `pi` bin 与 `./rpc-entry` 分别使用官方 `dist/bundle/cli.js`、`dist/bundle/rpc-entry.js`。扩展复用宿主 loader 的模块解析与公开 UI 组件，不修改消费者的宿主。加载、Responses 与包安装边界见 [公共运行时](./doc/current/runtime/index.md#宿主加载边界)，子代理共享父模型运行时的私有结构依赖见 [模型运行时桥接](./doc/current/agents/models.md#模型运行时桥接)。`package.json` 保持 `private: true`，三个 Pi peer 与开发依赖均精确固定为 `1.5.0`。官方 Pi 1.5.0 的实际 Node bin（regular/fullscreen）与 RPC 加载入口已通过；消费者 Git/本地包及 tarball 安装尚未验收，本包未实际 npm 发布。依赖升级后须重启 Pi；`/reload` 只重载扩展，不替换宿主模块图。

Pi 直接加载 TypeScript 扩展，因此当前不需要构建产物。

运行时使用 /suite 搜索、修改和保存配置，通用设置保存后 /reload 生效；/subagents 查看子代理，默认启用的 /exit 使用原生退出清理，询问操作和配置说明见 [ask](./doc/current/ask/index.md) 与 [公共运行时](./doc/current/runtime/index.md)。启用 ask_user 时从实际加载列表移除原版 pi-ask-user，以免同名工具重复注册。

## 主题

内置 `oh-my-pi` 深色主题，参考 Oh My Pi Titanium 的电蓝与蓝灰配色。在 Pi 中，将本包作为 Pi package 加载后执行 `/reload`，通过 `/settings` → **Theme** → `oh-my-pi` 选择；开发预览使用 `pnpm exec pi -e . --use-theme oh-my-pi`。主题 JSON 本身适用于原版 Pi，可单独安装而不加载 Suite 扩展；主题加载、单独安装及终端背景边界见 [主题说明](./doc/current/ui/themes.md)。

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
themes/
  oh-my-pi.json     Oh My Pi 参考深色主题
doc/
  current/          当前实现与开发方式
  todo/             设计、需求与实施计划
  finished/         已完成专项
third-party/
  UPSTREAM.md       上游来源记录
  licenses/         上游许可证
```

设计与实施计划见 [设计与实施记录](doc/finished/pi-suite/design/index.md)，当前项目状态见 [doc/current](./doc/current/index.md)。Pi 相关依赖以官方 1.5.0 为开发基线；pnpm-lock.yaml 与 pnpm-workspace.yaml 应提交到版本控制。
