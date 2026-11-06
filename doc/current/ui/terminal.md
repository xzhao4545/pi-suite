# 终端复制

Pi 全屏界面拖选和宿主其他复制入口共用 Pi 的 clipboard 能力。Linux 经 SSH 运行时，OSC 52 请求的目标是连接 SSH 的本机终端剪贴板；tmux buffer 与远端 Linux 桌面剪贴板是不同目标。

Pi Suite 在 TUI 绑定时检查 tmux 当前客户端的 clipboard 能力；支持时将服务器 `set-clipboard` 设置为 `on`，让 tmux 接收应用 OSC 52 并向外转发。`external` 允许 tmux 自身复制，但会拦截 Pi 等应用的请求。此设置作用于当前 tmux 服务器，关闭服务器后由 tmux 配置决定；希望长期保持时可在 `~/.tmux.conf` 写入 `set -s set-clipboard on`。

客户端没有 clipboard 能力时，界面提示检查本机 SSH 终端的 OSC 52 支持/权限与 tmux terminal-features；检查失败或设置失败报告错误。该路径使用 Pi 原有复制能力，不接管 stdout、鼠标选择或单个查看器，也不要求 DCS 透传。

OSC 52 写请求没有可靠的接收确认。Pi 的 `Copied!` 提示表示其 clipboard 调用完成，不能证明本机终端接受了请求；最终检查是在本机其他窗口粘贴中文与多行文本。终端名称指本机建立 SSH 连接的应用；远端 `$TERM` 描述终端能力，不能可靠识别应用名称。嵌套 tmux/SSH 需要按实际链路另行核查。

[返回统一界面](index.md)
