# 界面

[文档索引](index.md)

## Dock

Dock 是本套件唯一的常驻组件，位于编辑器上方，按固定顺序最多显示五个分区：Goal、Tasks、Agents、Jobs 和 Workflows。空分区会隐藏。

- **Tasks** 按 ID 顺序显示任务组及其完成数/总数：☐ 待办、⟳ 进行中、⚠ 阻塞、☑ 完成。只展开焦点组：你在 Dock 中选中的组；没有时依次取有进行中任务的组、有阻塞的组、最近更新的组。焦点组显示最近完成的一个子任务和最多 5 个未完成子任务，其余计为 `… N more items`。其他未完成组最多 4 个，只显示标题，其余计为 `… N more groups`。已完成的组计入最后一行。
- **Agents** 每个子代理一行：名称（括号内为模型）、状态、运行时间、输入与输出 token、工具调用次数。时间显示为 `45s`、`12m05s`、`3h07m` 或 `2d04h`；token 数显示为 `999`、`1.2k`、`3.4M` 或 `1B`，向下取整。等待回答的子代理显示 `waiting(parent)`。
- **Jobs** 按名称和状态显示活动 job。
- **Workflows** 显示活动的 workflow 运行。

行数放不下时，Dock 会折叠并显示 `↓ … 3 more items` 这样的提示。空闲高度不超过终端一半减去编辑器和 footer 后的空间，也不超过 `ui.maxRows`（默认 12）。终端低于 18 行时，每个分区缩为一行摘要。显示 `ask_user` 期间 Dock 隐藏。

### 键盘选择

编辑器为空时按 **←** 进入 Dock。

| 按键 | 操作 |
| --- | --- |
| ↑ / ↓ | 选择任务、agent、workflow 或 job 行。选中某个任务组或其子任务时，该组展开。 |
| `[` / `]` | 切换到上一个或下一个分区。 |
| Enter | 打开所选对象：任务详情（只读）、agent 对话记录、workflow 运行，或 job 的命令与输出。 |
| Esc 或 → | 返回编辑器。 |

其他按键会退出 Dock 并交给编辑器。编辑器有文字、补全菜单打开或其他视图持有焦点时，← 不会被拦截。

## 命令

| 命令 | 打开 |
| --- | --- |
| `/goal …` | 目标控制与详情，见 [Goal](modules/goal.md)。 |
| `/tasks [组 ID]` | 任务浏览器，见 [Tasks](modules/tasks.md#任务浏览器)。 |
| `/jobs [finished\|all] [workspace]` | job 浏览器，见 [Jobs](modules/jobs/index.md#job-浏览器)。 |
| `/subagents [queued\|finished\|all\|types\|schedules\|workflows]` | 子代理浏览器，见 [Agents](modules/agents/index.md#子代理浏览器)。 |
| `/suite` | 设置，见 [配置](configuration.md#用-suite-编辑)。 |
| `/exit` | 清理后退出 Pi，见 [配置](configuration.md#用-exit-退出)。 |

## 浏览器与阅读视图

`/tasks`、`/jobs` 和 `/subagents` 使用相同的浏览器布局：列表、详情区（宽屏在列表右侧，窄屏在下方）、状态行，以及底部固定的导航行和操作行。

| 按键 | 操作 |
| --- | --- |
| ↑ / ↓、PageUp / PageDown | 在列表中移动；详情区有焦点时滚动详情。 |
| `/` | 开始筛选列表。不按 `/` 直接输入不会筛选。 |
| Tab | 在列表和详情之间切换焦点。 |
| Enter | 打开所选项。 |
| Esc | 退出搜索或详情，清空筛选，然后关闭。 |
| ← ←（300 ms 内） | 在 `/jobs` 和 `/subagents` 中关闭整条浏览链。 |

详情和日志视图使用相同的阅读按键：

| 按键 | 操作 |
| --- | --- |
| ↑ / ↓、PageUp / PageDown、Home / End | 滚动。向上滚动会停止跟随新输出，End 恢复跟随。 |
| `/`、Enter、`n` / `N` | 搜索，然后跳到下一个或上一个匹配。 |
| Esc | 退出搜索，或关闭视图。关闭视图从不停止 job 或 agent。 |

这些浮层以键盘操作为主，不支持在嵌套的工具块中点击或滚轮，也不支持拖动滚动条。主会话中 Pi 自带的鼠标展开和 `Ctrl+O`（展开全部工具）照常可用。

## 工具显示

本套件的每个工具在对话中折叠为一行，例如 `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`。展开工具（鼠标点击或 Pi 的 `Ctrl+O`）显示该工具的详情和输出预览；完整输出用 `job_read` 或 `agent_read` 读取。以 `sensitive` 发送的输入在展开后仍然隐藏。错误始终完整显示。子代理以名称标示，ID 只出现在展开内容或暗色文字中。

状态图标：⟳ 运行中、⧗ 排队、? 等待、✔ 完成、✘ 失败、⊘ 停止、⏱ 超时或受限。

## Footer 状态

本套件通过 Pi 的扩展状态接口发布两个状态项：

- `goal`：目标状态和有效运行时间，例如 `🎯 goal 03:27`，见 [Goal](modules/goal.md#状态显示)。
- `pi-suite:runtime`：活动子代理和 job 数量，显示为 `🤖N · ⚙M`，为零的项隐藏。

`goal.display`、`agents.display` 和 `jobs.display` 可以把这些摘要移到 Dock（`dock`）或隐藏（`hidden`）。

Pi 自带的 footer 会显示这两项。使用 `@narumitw/pi-starship` 0.65.2 时，它们通过其 `extension_status` 模块显示。如果 Starship 的 `format` 中没有 `$extension_status`，或 `max_statuses` 把它们挤掉了，就看不到这些状态；这时可把 `goal.display` 改为 `dock`。下面的设置保留目标状态图标，并隐藏 runtime 状态项默认的插头图标：

```toml
[extension_status]
icons = { "pi-suite:runtime" = "", fallback = "" }
```

## 主题

本包附带名为 `oh-my-pi` 的深色主题，基于 Oh My Pi 的 Titanium 配色。安装本包后执行 `/reload`，在 `/settings` → **Theme** 中选择即可。从源码目录临时使用一次：

```sh
pnpm exec pi -e . --use-theme oh-my-pi
```

只想使用主题时，把 `themes/oh-my-pi.json` 复制到 `~/.pi/agent/themes/oh-my-pi.json`，再在 `/settings` 中选择。同名主题只保留一个加载来源：要么是本包，要么是复制的文件。

`pi -e ./src/index.ts` 只加载扩展，不加载主题。主题只设置 Pi 的配色角色；想让整体观感完全一致，可把终端背景设为 `#151820`、前景设为 `#e8ecf4`。

## 命令高亮

本套件显示的命令按结构高亮：程序、选项、变量、字符串、运算符和重定向分别使用 Pi 的 `syntax*` 主题角色，支持 Bash 和 PowerShell。高亮器只扫描文本，从不执行命令，也不查找程序或路径。

| 位置 | 高亮 |
| --- | --- |
| 模型调用 Pi 内置 `bash` / `powershell` 工具 | 默认开启，由 `ui.highlightBuiltinCommands` 控制。 |
| `/jobs`、Dock 查看器和展开的套件工具中的 job 命令 | 始终开启。 |
| 你自己输入的 `!` / `!!` shell 命令 | Pi 原有显示。 |
| 日志和其他输出 | 纯文本。 |

## 在 tmux 中复制

Pi 通过 OSC 52 复制文本。Pi 运行在 tmux 中且 tmux 客户端报告支持剪贴板时，本套件把 tmux 服务器的 `set-clipboard` 选项设为 `on`，让 tmux 把这些请求转发到你本机的终端。想在 tmux 重启后保持该设置，可在 `~/.tmux.conf` 中加入 `set -s set-clipboard on`。Pi 的 `Copied!` 提示只表示请求已发出，请在别处粘贴确认。
