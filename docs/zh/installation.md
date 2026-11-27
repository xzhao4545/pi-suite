# 安装

[文档索引](index.md)

## 环境要求

- Node.js 24 或更高版本。
- 官方未修改的 Pi **1.6.1** 或更高版本。本套件以 1.6.1 为开发与测试基线，并随 Pi 版本更新跟进适配。

## 从 npm 安装

```sh
pi install npm:pi-suite
pi list
```

Pi 会把最新发布的版本及其运行依赖安装到 Pi 的 npm 目录，通过 `pi.extensions` 加载 `src/index.ts`，并发现附带的技能和主题。该来源写入用户级 Pi `settings.json`；加 `-l` 则写入项目级设置，项目资源遵循 Pi 的信任规则。

之后更新：

```sh
pi update npm:pi-suite
```

固定了版本的来源（如 `npm:pi-suite@0.3.0`）不会被更新，需要安装新版本才能切换过去。

安装或更新后，在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用，不需要配置文件。

Pi 的 `/reload` 只重新加载扩展。升级 Pi 或本套件的依赖后，需要退出并重新启动 Pi；用 `--resume` 可继续原会话。

## 替换独立扩展

Pi Suite 包含下列扩展的能力。同时保留会重复注册工具、命令和界面。先安装 Pi Suite，用 `pi list` 核对准确来源，再移除这些独立包。

| 独立扩展 | Pi Suite 模块 |
| --- | --- |
| `pi-ask-user` | ask |
| `@tintinweb/pi-tasks` | tasks |
| `pi-interactive-shell` | jobs（PTY、交互与监督） |
| `pi-background-jobs` | jobs（后台执行与日志） |
| `@narumitw/pi-goal` | goal |
| `@tintinweb/pi-subagents` | agents、定时调度与 workflow |

使用 `pi list` 显示的完整来源；固定了版本的来源要保留版本后缀：

```sh
pi remove npm:pi-ask-user
pi remove npm:@tintinweb/pi-tasks
pi remove npm:pi-interactive-shell
pi remove npm:pi-background-jobs@0.1.3
pi remove npm:@narumitw/pi-goal
pi remove npm:@tintinweb/pi-subagents
```

Pi Suite 不会迁移这些扩展的配置或存储数据。

`@narumitw/pi-starship` 是独立的 footer，可以保留。Pi Suite 通过 Pi 的扩展状态接口发布状态，pi-starship 会读取它，见 [界面](interface.md#footer-状态)。
