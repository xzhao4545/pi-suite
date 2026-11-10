# 终端复制

Pi 全屏界面拖选和宿主其他复制入口共用 Pi 的 clipboard 能力。Linux 经 SSH 运行时，OSC 52 请求的目标是连接 SSH 的本机终端剪贴板；tmux buffer 与远端 Linux 桌面剪贴板是不同目标。

Pi Suite 在 TUI 绑定时检查 tmux 当前客户端的 clipboard 能力；支持时将服务器 `set-clipboard` 设置为 `on`，让 tmux 接收应用 OSC 52 并向外转发。`external` 允许 tmux 自身复制，但会拦截 Pi 等应用的请求。此设置作用于当前 tmux 服务器，关闭服务器后由 tmux 配置决定；希望长期保持时可在 `~/.tmux.conf` 写入 `set -s set-clipboard on`。

客户端没有 clipboard 能力时，界面提示检查本机 SSH 终端的 OSC 52 支持/权限与 tmux terminal-features；检查失败或设置失败报告错误。该路径使用 Pi 原有复制能力，不接管 stdout、鼠标选择或单个查看器，也不要求 DCS 透传。

OSC 52 写请求没有可靠的接收确认。Pi 的 `Copied!` 提示表示其 clipboard 调用完成，不能证明本机终端接受了请求；最终检查是在本机其他窗口粘贴中文与多行文本。终端名称指本机建立 SSH 连接的应用；远端 `$TERM` 描述终端能力，不能可靠识别应用名称。嵌套 tmux/SSH 需要按实际链路另行核查。

## 查看器与输入

Dock、`/jobs` 和 Subagents 所属 Jobs 的 Enter 直接打开同一个命令/输出查看器。浏览默认只读，方向键滚动，不向 PTY 发送输入；`i` 才明确接管输入。接管后 Ctrl+G 交还模型、Ctrl+T 发送当前屏幕并离开、Ctrl+B 离开但保留进程；实际提示使用 `jobs.returnKey`、`transferKey`、`detachKey` 配置。`job_start attach:true` 是明确的用户输入入口，直接进入接管态。浏览态 Esc 返回上一层，300ms 内双左关闭整个 Jobs/Subagents 浏览链路；搜索、过滤、消息 Editor 和 PTY 接管态保留自己的左右键。

PTY 使用同一个有界 xterm 屏幕与回滚缓冲区，命令、信息和操作栏不占进程屏幕尺寸。仅尺寸变化时向活动 PTY 传递真实输出区列/行。结算时保存 xterm 序列化快照（最多 1000 行回滚、4 MiB）；跨进程恢复只读最终屏幕，不重启进程或恢复输入。无快照的历史明确为 log only，原始日志读取不冒充二维终端还原。普通 pipe 的 stdout/stderr 独立显示，不猜测合并顺序。

Subagents 的 `m` 在原列表或会话底部打开 Pi 原生多行 Editor；默认 Enter 发送、Shift+Enter/Ctrl+J 换行，提示读取宿主配置。中文、粘贴、撤销和光标由原生 Editor 管理；失败保留草稿，Esc 只取消编辑，不停止运行。查看器底部信息属于当前视图，不替换主会话原生或第三方 footer。

## 原生阅读与鼠标

Subagent、普通详情、workflow 与文本日志使用公开组件和显式阅读窗口：原生 ScrollView 持有唯一 scrollTop 与跟随状态，Suite 按共享预算切片/补齐输出，scrollbar:hidden 不创建滚动条计时器。按行/页、Home/End、搜索以及工具/thinking 的键盘展开用于复杂正文阅读；该阅读 overlay 不保证嵌套工具单项鼠标命中、区域鼠标切焦点或可拖动 scrollbar，不新增模拟鼠标。主会话工具的单项鼠标展开与默认 Ctrl+O 由 Pi 原版管理；Ask 表单保留页签点击、选项点击/滚轮与 Review 选择等既有本地交互，History/全文与说明预览不承诺相同鼠标能力。Job 的 TerminalView 保留终端正文滚轮，不把事件转发到嵌套文本、命令区或工具组件。关闭 overlay 恢复原焦点与主会话视口，按自有生命周期释放订阅和回调，不替换原生/第三方 footer，也不停止执行。工具组件保留原生实例，不扫描文本标题、不另建复制或链接处理层。

Subagent 阅读链无论主会话采用普通还是 fullscreen 模式，均以终端完整列/行覆盖主 footer；模型/thinking 选择、Details、所属 Jobs 及异步页面切换保持同一覆盖和输入焦点。readingWindow 自行填足输出行数，背景 lease 在子页间隙保持覆盖；正常或异常退出释放自有背景 overlay 与作用域，恢复原焦点、原 footer 实例和最新主状态，不改变执行 owner。其他普通阅读保留百分比预算与恢复焦点；鼠标与复制仍取决于宿主和终端实际能力，不承诺未提供的交互。OSC 8 链接、文本拖选与 clipboard 通道沿用 Pi，不接管 stdout；PTY 输入接管不使用文本 ScrollView 替代。

## 宿主加载与重启

运行本仓库时使用 `pnpm exec pi -e ./src/index.ts`，官方 Pi 1.5.0 Node CLI/RPC 使用发布包的 `dist/bundle/cli.js`、`dist/bundle/rpc-entry.js`，模块解析由原版 loader 负责。依赖升级后须退出当前 Pi 进程并重新启动；`/reload` 只重载扩展，不能替换宿主已载入的 TUI/adapter 类与函数。保留当前会话和目标时加 `--resume` 并选择原会话，不通过新建目标或 fork 迁移运行归属。加载及安装范围见 [公共运行时](../runtime/index.md#宿主加载边界)。

[返回统一界面](index.md)
