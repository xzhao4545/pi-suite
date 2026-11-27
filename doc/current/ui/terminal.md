# 终端交互

## 终端复制

Pi 全屏界面的拖选和其他复制入口共用 Pi 的 clipboard 能力，通过 OSC 52 写入剪贴板。Linux 经 SSH 运行时，OSC 52 的目标是发起 SSH 连接的本机终端的剪贴板；tmux buffer 和远端 Linux 桌面剪贴板是另外的目标。

在 tmux 中（存在 `TMUX` 环境变量）以 TUI 模式绑定会话时，Pi Suite（`src/runtime/clipboard.ts`）：

1. 执行 `tmux display-message -p '#{set-clipboard}|#{client_termfeatures}'` 读取当前设置和客户端能力；失败时报错 `Cannot inspect tmux clipboard`。
2. 客户端能力中没有 `clipboard` 时，发出警告：检查 SSH 终端的 OSC 52 支持与权限，以及 tmux 的 terminal-features。不修改设置。
3. `set-clipboard` 已经是 `on` 时不做改动；否则执行 `tmux set-option -s set-clipboard on`，失败时报错 `Cannot enable tmux application clipboard`。

`on` 让 tmux 接收应用发出的 OSC 52 并转发到外层终端；tmux 默认的 `external` 只允许 tmux 自己复制，会拦下 Pi 的请求。该设置作用于当前 tmux 服务器，服务器重启后由 tmux 配置决定；需要长期生效时在 `~/.tmux.conf` 写入 `set -s set-clipboard on`。这条路径只使用 Pi 已有的复制能力，不接管 stdout、鼠标选择或某个查看器，也不需要 DCS 透传。

OSC 52 写请求没有接收确认。Pi 的 `Copied!` 只表示 clipboard 调用已完成，不能证明本机终端接受了请求；确认方法是在本机其他窗口粘贴中文与多行文本。远端 `$TERM` 只描述终端能力，不能可靠识别本机终端应用。嵌套 tmux/SSH 需要按实际链路逐层检查。

## 查看器与输入

- 命令/输出查看器、终端视图的浏览态与接管态、离开/交还/发送键：见 [执行任务](../jobs/index.md#命令输出查看器) 与 [终端视图](../jobs/index.md#终端视图)。
- 阅读 overlay 的尺寸（普通居中 90% 宽、70% 高，fullscreen 全屏）：见 [阅读 overlay](index.md#阅读-overlay)。
- Subagents 的 `m` 消息输入：见 [子代理操作](../agents/operations.md)；输入组件规则见 [输入与选择](index.md#输入与选择)。
- 搜索、过滤、消息 Editor 和 PTY 接管态自己处理左右键，不触发 ←← 关闭。

## 原生阅读与鼠标

阅读视图以键盘操作为准：

- Subagent、普通详情、workflow 与文本日志使用公开组件和显式阅读窗口，原生 ScrollView 持有唯一的 `scrollTop` 与跟随状态，滚动条隐藏。
- 按行/页、Home/End、搜索，以及工具与 thinking 的键盘展开，用于阅读复杂正文。

鼠标能力：

| 位置 | 鼠标 |
| --- | --- |
| 主会话工具结果 | 单项点击展开与默认 Ctrl+O 全部展开，由 Pi 管理 |
| Ask 表单 | 页签点击、选项点击与滚轮、Review 选择；History、全文与说明预览不提供这些操作，见 [询问操作](../ask/index.md#操作) |
| TerminalView | 正文区域的滚轮滚动终端历史，每格 3 行；不转发到命令区或工具组件 |
| 阅读 overlay 中的嵌套内容 | 不保证嵌套工具的单项点击、按区域切换焦点或拖动滚动条；Suite 不模拟鼠标事件 |

其他边界：

- 工具组件保留原生实例，Suite 不扫描文本标题，也不另建复制或链接处理层。OSC 8 链接、文本拖选与 clipboard 由 Pi 处理，不接管 stdout。
- PTY 输入接管使用 TerminalView，不使用文本 ScrollView。
- 关闭 overlay 恢复原焦点与主会话视口，按各自生命周期释放订阅与回调，不替换原生或第三方 footer，也不停止执行。
- Subagent 消息阅读链无论主会话是普通还是 fullscreen 模式，都覆盖终端全部行列（包括主 footer）；交接规则见 [阅读 overlay](index.md#阅读-overlay)。
- 鼠标与复制最终取决于宿主和终端的实际能力。

## 宿主加载与重启

在本仓库开发时使用 `pnpm exec pi -e ./src/index.ts`。依赖升级后须退出当前 Pi 进程再启动：`/reload` 只重载扩展，不替换宿主已载入的 TUI 和 adapter。需要保留当前会话和目标时，启动加 `--resume` 并选择原会话；不要用新建目标或 fork 代替。加载入口与安装范围见 [宿主加载边界](../runtime/index.md#宿主加载边界)。

[返回统一界面](index.md)
