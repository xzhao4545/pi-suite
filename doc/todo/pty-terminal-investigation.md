# PTY 控制终端与嵌套 Pi 退出排查

## 现象与范围

用户在配色预览的嵌套 Pi 中报告无法顺畅操作／返回，输入 `/quit` 后看似停住；预览随后已退出。Ctrl+B 与外层 tmux 前缀冲突已由默认 Ctrl+] 避开，底部提示专项独立完成；这里保留尚未证明解决的终端链路问题。

Linux、官方 Pi 1.5.0、隔离资源与 tmux 3.4 的补充验证发现：

- 通过 Suite `createPtyProcess` 直接启动独立 tmux 客户端，tmux 报告客户端已连接，但调用方没有读到程序输出；额外用 `script` 建立控制终端后可读到输出及输入回显。仅证明两种链路有差异，尚未定位控制终端、前台进程组或描述符中的具体原因。
- 在独立 tmux 的正常终端链路中，嵌套 Pi 的输入消费和提示接管／交还可用；发送原生 `/exit` 后未出现预期的终端结束状态。尚未区分子 Pi 是否真的退出、退出清理是否阻塞、PTY 是否仍被其他描述符持有或屏幕结算是否延迟。
- 普通读行程序的官方 CLI 直接接管、原生退出与默认离开键通过，不将它们作为复杂嵌套 Pi 退出已通过的证据。

不推荐把 `script` 包装当成生产兜底，不修改用户 tmux 配置或关闭无关 Pi/tmux 进程。`/quit` 不是所有子程序通用退出命令；需要按子 CLI 实际命令或按键区分程序退出与离开 Suite 视图。

## 排查任务

- [ ] 最小复现并核对 Linux PTY 的 slave/master、控制终端、session／前台进程组，以及 tmux 的 `/dev/tty` 路径；区分输出路由与按键消费。
- [ ] 对嵌套 Pi 的 `/exit` 核对实际 PID、生命周期事件和仍持有 PTY 的描述符，区分程序退出与 `processExited`／`outputFinished`／`TerminalSource.closed` 的结算边界。
- [ ] 在已有 PTY backend、Manager 和终端框架内修复证实的根因，不为显示问题加并行状态机、不通过提前标记成功掩盖未完成清理。
- [ ] 核对独立进程组、自然退出、停止、另一 job 隔离和输入所有权，再由用户在实际嵌套预览／tmux 环境复核；明确官方 Pi 版本及未覆盖平台。

## 相关实现与说明

- [PTY backend](../../src/jobs/backends/pty.ts)、[终端视图](../../src/ui/terminal.ts)、[接管入口](../../src/jobs/viewer.ts)
- [Jobs 当前协议](../current/jobs/index.md)、[终端当前交互](../current/ui/terminal.md)

[返回待办索引](index.md)
