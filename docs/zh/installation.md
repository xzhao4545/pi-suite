# 安装

[文档索引](index.md)

## 环境要求

- Node.js 24 或更高版本。
- 官方未修改的 Pi **1.5.0** 或更高版本。本套件以 1.5.0 为开发与测试基线，并随 Pi 版本更新跟进适配。
- pnpm 12.6.0，仅在从本地目录安装或开发本套件时需要。

本包设置了 `private: true`，没有发布到 npm。通过官方 Pi CLI 和 RPC 入口加载已经验证。从 Git、本地路径或 tarball 安装走 Pi 的常规包安装流程，但尚不在已验证范围内。

## 从 GitHub 安装

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

Pi 会克隆默认分支、安装运行依赖，通过 `pi.extensions` 加载 `src/index.ts`，并发现附带的技能和主题。该来源写入用户级 Pi `settings.json`；加 `-l` 则写入项目级设置，项目资源遵循 Pi 的信任规则。

之后更新：

```sh
pi update git:github.com/xzhao4545/pi-suite
```

安装或更新后，在已打开的会话中执行 `/reload`，或重启 Pi。所有模块默认启用，不需要配置文件。

## 从本地目录安装

```sh
cd /absolute/path/to/pi-suite
pnpm install
pi install /absolute/path/to/pi-suite
pi list
```

Pi 直接加载该目录，因此目录需要保持可访问。修改源码后执行 `/reload`；依赖变化后先运行 `pnpm install`。`-l` 只决定哪个设置文件记录该来源，与来源是否为本地路径无关。

从 GitHub 来源切换到本地目录时，先安装本地目录，再执行 `pi remove git:github.com/xzhao4545/pi-suite`。用 `pi list` 确认只剩一份 Pi Suite 来源，然后 `/reload` 或重启。

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

## 不安装直接运行

从源码目录临时启动一次：

```sh
pnpm exec pi -e .                  # 整个包：扩展、技能和主题
pnpm exec pi -e ./src/index.ts     # 仅扩展，不含包主题
```

Pi 的 `/reload` 只重新加载扩展。升级 Pi 或本套件的依赖后，需要退出并重新启动 Pi；用 `--resume` 可继续原会话。
