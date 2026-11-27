# 安装与扩展替换

## npm 安装

需要 Node.js 24 或更高，以及官方 Pi 1.6.1 或更高版本。npm 与本地路径安装的验证范围见[宿主加载边界](./runtime/index.md#宿主加载边界)。使用 Pi 原生包管理命令安装到用户层：

```sh
pi install npm:pi-suite
pi list
```

Pi 把来源写入用户层 `settings.json`，把 npm 上的最新版本及运行依赖安装到 Pi 的 npm 目录。`package.json` 的 `pi.extensions` 指向 `src/index.ts`，`pi.skills` 指向 `skills/`。加 `-l` 则写入项目层设置；项目资源按 Pi 的项目信任规则加载。

更新已安装的 npm 来源；固定版本的来源（如 `npm:pi-suite@0.3.0`）不随更新移动：

```sh
pi update npm:pi-suite
```

安装或更新后，在当前会话执行 `/reload`，或重启 Pi。默认功能无需配置文件，模块开关见[公共运行时与配置](./runtime/index.md)。

## 本地安装

在本地项目目录先运行 `pnpm install` 准备依赖，再通过 Pi 原生包管理命令安装该目录；将示例路径替换为实际项目的绝对路径：

```sh
pi install /absolute/path/to/pi-suite
pi list
```

Pi 把本地路径写入 `settings.json`，直接从该路径加载扩展和技能，所以目录必须保持可访问。`-l` 仍只决定设置写入哪一层。改动扩展源码后执行 `/reload`；依赖变更后重新运行 `pnpm install`，再重启 Pi。也可从包根目录临时加载源码：`pi -e ./src/index.ts`。

从 npm 来源切换到本地路径：

1. 安装本地目录。
2. 执行 `pi remove npm:pi-suite`。
3. 用 `pi list` 确认只有一份 Pi Suite 来源，再执行 `/reload` 或重启 Pi。

## 发布

npm 包名为 `pi-suite`。`package.json` 中：

- `files` 只列出运行所需的 `src/`、`skills/`、`themes/`、`third-party/` 和两份 README，npm 另外自动附带 `LICENSE` 与 `package.json`；
- `publishConfig.registry` 固定为 npm 官方源，本机 `.npmrc` 指向镜像时也发布到官方源；
- `repository` 指向 GitHub 仓库，npm 用它校验 provenance。

`.github/workflows/publish.yml` 在推送 `v*` tag 时运行：

1. 校验 tag 与 `package.json` 的 `version` 一致，不一致即失败；
2. 执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`；
3. 执行 `npm publish`。认证使用 npm trusted publishing（GitHub OIDC），仓库不保存 npm token，provenance 自动生成；trusted publishing 要求 npm 11.5.1 或更高，工作流先升级 npm。

npm 只能为已存在的包配置 trusted publisher，因此首个版本在本机 `npm login` 后手动 `npm publish`，再在 npmjs.com 的包设置中把仓库 `xzhao4545/pi-suite` 和工作流 `publish.yml` 登记为 trusted publisher。之后发布新版本：升级 `version` 并提交，打同名附注 tag，推送提交和 tag。

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

Pi Suite 不自动迁移独立扩展的配置和持久数据。`@narumitw/pi-starship` 是独立 footer，可与 Pi Suite 的共享状态显示并用。上游来源和范围见[上游登记](../../third-party/UPSTREAM.md)。

[返回当前文档](./index.md)
