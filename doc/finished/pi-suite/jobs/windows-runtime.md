# Windows 运行时与实际终端阶段

本阶段完成 Windows 常驻进程查询、ConPTY 密码回显隐藏、poll-diff 轮次采样、共享 JSON 读写竞争、实际 Pi CLI 终端缩放与原生 agents 入口，以及 Codex/Claude 受控工具执行；剩余 Windows 验收仍由 [执行待办](../../../todo/pi-suite/index.md) 管理。

## 完成项

- [x] Windows 异步 CIM 查询复用按需启动的常驻 PowerShell。保留根 PID/创建时间复核、子树捕获、taskkill 与范围消失确认；同步 exit 路径独立运行。查询超时、取消与随后重新查询的真实进程烟测通过，工作进程不阻止父进程退出。
- [x] ConPTY 提示前 CSI、光标回移与重绘密码回显使用等字节隐藏；读取、搜索、预览沿用原始偏移。Windows 真实 PTY 输出检查通过，未增加永久测试条目。
- [x] poll-diff 在子 shell 中执行每轮命令，合并 stdout/stderr，写入私有 OSC 完成边界；追读器保留跨块片段，仅比较完整轮次。慢于轮询间隔的稳定命令不产生空窗口假变化，修改状态后产生一条正确差异；Windows pipe 与 ConPTY 烟测通过，既有 monitor 用例覆盖同一风险。
- [x] Windows 文件资源夹具使用目录 junction 验证越界，cwd 提示使用 Pi 的正斜杠格式。CLI 字面量夹具避开 Windows 不允许的文件名，跨进程响应快照采用原子发布，避免读取到截断中的 JSON。
- [x] 实际 Pi 1.5.0 CLI、离线 provider 与本包 `job_start` 启动内层 Node TTY 程序；经真实键盘进入 `/jobs`、选择 job 并 Attach terminal。外层 ConPTY 在 40×24、120×40、60×30、40×24 间缩放，内层 `process.stdout.columns/rows` 与 resize 事件分别记录 40×17、120×30、60×22、40×17。每种尺寸下输入到达内层。
- [x] 实际 Ctrl+G 交还、Ctrl+B 离开后继续运行、重新 attach 后输入通过。`/quit` 后 CLI 自然退出码 0，原 owner 的 job 为 stopped、stopReason=quit、cleanup=managed_scope_confirmed；退出观测使用原 owner 引用，没有新建 manager 冒充结果。
- [x] Windows Node 24.22.2 完整检查 158 项通过，零失败、跳过或取消，耗时 64.6 秒。真实 SDK/进程范围包含通知、两级任务与并发、agents 资源/交互/停止、workflow、日志/历史、控制桥受限模式与空闲替换；这是受控宿主/组件范围，不替代真实手机或业务系统组合。
- [x] 共享 JsonStore 的已有快照在 Windows 取得写入方同一跨进程锁，关闭读句柄后才允许原子替换。缺失快照不创建目录或锁；删除中的锁名暂时返回 EPERM 时复用既有有界等待。150 次实际写入与并发快照最终计数 150、无错误；既有多进程用例加入并发读取，最终 tasks/schedules 7 项检查通过。
- [x] 实际 Pi 1.5.0 的 `/agents types` 原生菜单从 120 列缩到 40 列后保存独立类型模型和 high thinking；不用 reload，RPC、单次调度和 workflow child 的实际 usage 事件均采用新模型/high，父会话仍为原模型/off。
- [x] 独立 consumer 经实际 CLI 的公开事件总线完成 ping v2、spawn、steer、consume、stop，包含执行中的真实 Bash 中断；单次调度真实触发，原生详情显示期限、次数、结果与 agent，Esc 保留。实际 workflow 的 shell gate、child、共享 wait 和结果显示通过，CLI `/quit` 自然退出码 0。业务扩展、完整 reload/时区/重放组合仍按 agents 专项验收。
- [x] Windows 实际 Codex 0.162.1 exec_command、Claude Code 2.1.301 Bash/Read 经本地受控 SSE 和临时隔离配置执行：复杂字面 prompt 到达主请求，真实工具写入文件，Claude Read 返回相同字节，最终回复和自然退出码 0 通过。两种 CLI 的真实长工具另经 stop 验证：PID/创建时间纳入范围，taskkill 返回 0、managed_scope_confirmed，独立 CIM 查询确认工具 PID 消失。该范围为 pipe，未声称 Windows 文本 PTY 接管完成。
- [x] 实际 `/jobs active` 选择运行任务、进入 stdout 日志页读取实际输出、返回后确认停止、清理历史确认与成功提示，以及最终 `/quit` 退出码 0 通过。

## 边界

实际 Codex 0.162.1、Claude Code 2.1.301 的 Windows 文本 PTY 接管/交还、Pi 1.5.0 的复杂 `@` prompt 与 reload/new 生命周期，以及完整 Starship/Pi 原生 footer 的原生组合验收见 [Windows CLI 文本 PTY 与原生 footer 阶段](windows-cli-ui.md)。

常驻 PowerShell 减少重复启动成本，不消除 CIM 查询与 taskkill 自身成本；真实进程测试固定文件并发为 4，避免按高核数同时启动大量 shell、PTY、SDK 与 CIM。Windows ConPTY 会重排 OSC 与重绘，不能承诺任意 PTY 程序的轮次边界精确，需要严格比较时使用 pipe。未完成轮次不作为变化事件。

用户实际第三方 footer 布局、Windows Codex/Claude 文本 PTY 输入接管与 Cursor 环境不属于本阶段完成范围，后续 CLI/footer 组合见[专门阶段](windows-cli-ui.md)。本机 Cursor 对应的 agent 命令缺失。用户实际 Starship 根 format 缺少 `$extension_status`，核对时未修改用户配置；实际可见性与 Dock 路径记录在后续阶段。Claude 的隔离进程显式设置 CLAUDE_CODE_GIT_BASH_PATH 后提供 Bash；不能把服务返回文本或“工具不存在”的结果当作执行成功。

当前契约见 [执行任务](../../../current/jobs/index.md)，平台检查结论见 [基线与验证](../../../current/validation.md)。

[返回完成索引](../../index.md)
