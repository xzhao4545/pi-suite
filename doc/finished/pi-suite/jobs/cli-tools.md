# 实际 CLI 工具执行与 Linux 后代清理阶段

Linux 使用真实 Codex 0.166.0、Claude Code 2.1.153、JobManager PTY 和本地受控 SSE 服务，工具只操作隔离临时目录，不调用付费模型。

- Codex：实际 exec_command 创建文件、返回工具输出与退出码 0，公共 job 日志包含完成结果，Ctrl+D 后自然 completed/exit 0。长工具另建进程组，其后台 sleep 在停止前具有可追溯祖先链；Linux 后端捕获 root、工具 shell 与 sleep 的身份，停止后全部消失，另一独立 job 保持运行且不在清理 scope。workspace-write 在本机被 bwrap 权限限制阻断，本阶段成功执行使用仅限临时配置的 danger-full-access；不代表该沙箱环境已通过。
- Claude：bare 模式显式开放 Bash/Read，默认权限界面只确认本次临时命令。实际 Bash 子进程创建含中文、美元符号、引号、反引号和换行的 62 字节文件，Read 的真实 tool_result 返回对应内容。当前 xterm 显示完成结果；线性 reader 返回正确原始偏移和可读命令路径，垂直增量重绘仍遵循 [屏幕支持范围](screen-range.md)。`/exit` 后自然 completed/exit 0，再次 stop 为 requested:false；受控停止清理也通过。

根因是 CLI 工具能够创建独立 session/进程组，单独终止 job 根进程组不能覆盖这些后代。本阶段扩展既有 Linux 停止后端，复用 Tracked、retainedScope 与 CleanupEvidence：停止前以 `/proc` start ticks 捕获根组及可追溯后代，发信号前核对身份，保留父退出后的目标并确认终止；不另建 CLI 管理器。执行协议为 10，避免 reload 复用不同停止语义的占用 manager。

新增 1 项真实进程聚合覆盖 pipe/PTY 异步 stop、pipe 同步退出、忽略 TERM 的独立 session 工具、原根组内已重新挂到 PID 1 的成员，以及另一独立 job 保持运行。首次捕获前已经脱离祖先链且不在根组的进程不属于可证明范围；`/proc` 复核与 kill 之间仍有系统调用竞态，zombie 视为已经终止。本阶段不覆盖任意其他 CLI 工具、Windows 或 Cursor。

稳定停止规则见 [执行任务](../../../current/jobs/index.md#结算与停止)，启动及验收范围见 [CLI 预设](../../../current/jobs/launch.md)。平台与其他 CLI 待办见 [监督专项](../design/jobs/monitors.md)。

[返回完成索引](../../index.md)
