# 安装与扩展替换

## GitHub 安装

运行环境为 Node.js 24 或更高和官方未修改的 Pi 1.5.0，三个 Pi peer 与开发依赖均精确固定为 `1.5.0`。官方 Node bin 的 regular/fullscreen 与 RPC 实际加载入口已通过；消费者 Git/本地包及 tarball 安装尚未验收，包保持 `private: true`，未实际 npm 发布。下列命令仅说明 Pi 的安装方式，不构成安装验收结论，支持边界见 [公共运行时](./runtime/index.md#宿主加载边界)。使用 Pi 原生包管理命令安装用户级扩展：

```sh
pi install git:github.com/xzhao4545/pi-suite
pi list
```

该来源写入 Pi 用户目录的 settings.json，Pi 克隆 GitHub 默认分支并安装运行依赖，通过 package.json 的 pi.extensions 加载 src/index.ts，通过 pi.skills 加载技能目录。添加 `-l` 可安装到项目级 settings，项目资源加载遵循 Pi 的信任机制。

更新已安装的 GitHub 来源：

```sh
pi update git:github.com/xzhao4545/pi-suite
```

安装或更新后，已有交互会话执行 `/reload`，或重启 Pi。Pi Suite 默认启用 ask、tasks、jobs、goal 和 agents；可选配置见 [公共运行时与配置](./runtime/index.md)，无需为默认功能创建配置文件。

## 本地安装

在本地项目目录先运行 `pnpm install` 准备依赖，再通过 Pi 原生包管理命令安装该目录；将示例路径替换为实际项目的绝对路径：

```sh
pi install /absolute/path/to/pi-suite
pi list
```

本地来源写入用户级 settings.json，Pi 直接加载项目目录的 `pi.extensions` 和 `pi.skills`。源码修改后在已有会话执行 `/reload`，依赖变更后先运行 `pnpm install`。项目目录需要保持可访问；`-l` 控制配置写入项目级，与安装来源是否为本地路径是两个不同选项。

从 GitHub 来源切换时，先安装本地目录，再执行 `pi remove git:github.com/xzhao4545/pi-suite`；用 `pi list` 确认仅保留一份 Pi Suite 来源，然后执行 `/reload` 或重启 Pi。

## 替换重复扩展

Pi Suite 整合下列扩展的能力。先完成 Pi Suite 安装，再通过 `pi list` 核对已安装来源，使用 `pi remove <source>` 移除对应独立扩展，避免工具、命令和界面重复注册。

| 独立扩展 | Pi Suite 模块 |
| --- | --- |
| pi-ask-user | ask |
| @tintinweb/pi-tasks | tasks |
| pi-interactive-shell | jobs（PTY、交互与监督） |
| pi-background-jobs | jobs（后台执行与日志） |
| @narumitw/pi-goal | goal |
| @tintinweb/pi-subagents | agents、定时调度与 Workflow |

卸载命令使用 `pi list` 显示的完整来源；固定版本需保留版本后缀，例如：

```sh
pi remove npm:pi-ask-user
pi remove npm:@tintinweb/pi-tasks
pi remove npm:pi-interactive-shell
pi remove npm:pi-background-jobs@0.1.3
pi remove npm:@narumitw/pi-goal
pi remove npm:@tintinweb/pi-subagents
```

独立扩展的配置与持久数据遵循其各自协议，Pi Suite 不自动迁移。`@narumitw/pi-starship` 是可并存的独立 footer；Pi Suite 发布共享状态并适配其显示，可保留该包。上游来源和整合边界见 [上游登记](../../third-party/UPSTREAM.md)。

[返回当前文档](./index.md)
