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
