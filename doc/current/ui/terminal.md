# 终端复制

Pi 全屏界面拖选和宿主其他复制入口共用 Pi 的 clipboard 能力。Linux 经 SSH 运行时，OSC 52 请求的目标是连接 SSH 的本机终端剪贴板；tmux buffer 与远端 Linux 桌面剪贴板是不同目标。

Pi Suite 在 TUI 绑定时检查 tmux 当前客户端的 clipboard 能力；支持时将服务器 `set-clipboard` 设置为 `on`，让 tmux 接收应用 OSC 52 并向外转发。`external` 允许 tmux 自身复制，但会拦截 Pi 等应用的请求。此设置作用于当前 tmux 服务器，关闭服务器后由 tmux 配置决定；希望长期保持时可在 `~/.tmux.conf` 写入 `set -s set-clipboard on`。

客户端没有 clipboard 能力时，界面提示检查本机 SSH 终端的 OSC 52 支持/权限与 tmux terminal-features；检查失败或设置失败报告错误。该路径使用 Pi 原有复制能力，不接管 stdout、鼠标选择或单个查看器，也不要求 DCS 透传。

OSC 52 写请求没有可靠的接收确认。Pi 的 `Copied!` 提示表示其 clipboard 调用完成，不能证明本机终端接受了请求；最终检查是在本机其他窗口粘贴中文与多行文本。终端名称指本机建立 SSH 连接的应用；远端 `$TERM` 描述终端能力，不能可靠识别应用名称。嵌套 tmux/SSH 需要按实际链路另行核查。

## 查看器与输入

Dock、`/jobs` 和 Subagents 所属 Jobs 的 Enter 直接打开同一个命令/输出查看器。浏览默认只读，方向键滚动，不向 PTY 发送输入；`i` 才明确接管输入。接管后 Ctrl+G 交还模型、Ctrl+T 发送当前屏幕并离开、Ctrl+B 离开但保留进程；实际提示使用 `jobs.returnKey`、`transferKey`、`detachKey` 配置。`job_start attach:true` 是明确的用户输入入口，直接进入接管态。浏览态 Esc 返回上一层，300ms 内双左关闭整个 Jobs/Subagents 浏览链路；搜索、过滤、消息 Editor 和 PTY 接管态保留自己的左右键。

PTY 使用同一个有界 xterm 屏幕与回滚缓冲区，命令、信息和操作栏不占进程屏幕尺寸。仅尺寸变化时向活动 PTY 传递真实输出区列/行。结算时保存 xterm 序列化快照（最多 1000 行回滚、4 MiB）；跨进程恢复只读最终屏幕，不重启进程或恢复输入。无快照的历史明确为 log only，原始日志读取不冒充二维终端还原。普通 pipe 的 stdout/stderr 独立显示，不猜测合并顺序。

Subagents 的 `m` 在原列表或会话底部打开 Pi 原生多行 Editor；默认 Enter 发送、Shift+Enter/Ctrl+J 换行，提示读取宿主配置。中文、粘贴、撤销和光标由原生 Editor 管理；失败保留草稿，Esc 只取消编辑，不停止运行。查看器底部信息属于当前视图，不替换主会话原生或第三方 footer。

[返回统一界面](index.md)
