# 实际 Pi CLI 终端缩放与重新接管阶段

Linux 使用真实 Pi 1.5.0 发布 CLI、JobManager PTY、本包与离线 provider，经实际 job_start 启动内层程序，再用真实键盘进入 `/jobs` 列表和 Attach terminal。外层 PTY 在 40×24、120×40、60×30、40×24 间实际缩放；内层程序通过 TTY ioctl 和同一 stdin 的 `stty size` 分别确认 40×17、120×30、60×22、40×17，收到四次 SIGWINCH。尺寸由实际 TUI 渲染和既有 PTY 后端传递，没有直接调用查看器 render、内层 resize 或设置 COLUMNS。

每次缩放后的实际用户输入均到达内层程序；用户接管时模型输入明确返回 USER_CONTROL，交还后模型输入到达。Ctrl+B 和 Esc 关闭终端及 jobs 列表后，内层继续运行；再次进入 `/jobs` 并 attach 后输入正常。实际 Stop job 菜单确认后，内层 stopped 且 managed_scope_confirmed，保留最后屏幕；外层清理同样确认。

本阶段复用现有命令、TerminalView、JobManager 与 PTY 后端，未发现产品缺陷，未新增源码或永久测试。适用范围为上述版本的 Linux 实际 CLI 路径；Windows 与真实手机 SSH 的缩放、滚轮及布局仍按 [执行待办](../../../todo/pi-suite/jobs/execution.md) 和 [界面待办](../../../todo/pi-suite/ui.md) 验收。

当前操作见 [执行任务](../../../current/jobs/index.md#用户操作)，实际 CLI 文本与接管范围见 [Pi CLI 阶段](pi-cli.md)。

[返回完成索引](../../index.md)
