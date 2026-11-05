# 统一执行任务管理

目标：融合交互 shell 和非交互后台任务，共用管理、日志与通知。

当前状态：实施中；pipe 与 PTY 执行、记录、工具与通知已实现并在 Windows（Git Bash）和 Linux 通过检查，见 [执行任务](../../../current/jobs/index.md)。/jobs 列表与详情、job_start 的 attach、终端视图（用户接管、Ctrl+G 交还、Ctrl+T 发送屏幕、Ctrl+B 离开）已实现，终端视图契约在 Linux 通过检查，Windows 待复核。monitor、hands-free、dispatch、CLI agent 预设与 launchPolicy 已实现并在 Linux 通过离线检查；终端缩放的两平台实际验证、Windows 监督与 CLI 预设验收待实施。

影响范围：JobManager、pipe/PTY 后端、工具入口、日志和任务元数据。

约束：pipe 与 PTY 保持各自语义；Windows 控制代码不能视作 Linux 支持。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 统一任务元数据、日志和通知入口
- [x] 实现 pipe 与 PTY 两种执行模式
- [x] 实现输入、查看、attach/detach 和停止
- [x] 保留已结束 job 历史及起止时间、耗时，向共享状态栏提供活动数量
- [x] 验证 Windows 与 Linux 的基础 pipe/PTY 后端、记录、工具与通知
- [ ] 完成两平台终端缩放实际验证，以及 Windows 终端视图、监督与 CLI 预设组合复核

## 验收方式

核对日志、输入、终端缩放、退出码和任务归属；两个平台分别验证。

## 关联计划

- [同进程保活](session-lifecycle.md)
- [跨进程保活](persistent-runtime.md)
- [架构与发布](../../../finished/pi-suite/architecture.md)
- [运行记录与手动控制](history-control.md)

## 6. jobs：融合交互 shell 与后台执行

统一 JobManager，但保留两种执行模式：

| 模式 | 使用场景 | 输出/交互方式 |
| --- | --- | --- |
| `pipe` | 构建、测试、批处理、日志采集 | stdout/stderr 文件与分页读取，不模拟终端 |
| `pty` | REPL、交互程序、需要 TTY 的命令 | PTY、终端尺寸变化、输入、attach/detach |

job 元数据统一包括 ID、workspace、ownerSession、可选 taskId、创建 agentId/agentRunId 及可追溯父级执行链、mode、status、创建/开始/结束时间、耗时、退出与停止/清理信息、输入记录和日志位置。创建归属从运行上下文取得，用于 subagent 停止时级联清理；通知按照原会话和分支引用投递，切换到其他会话不会把旧任务结果误发给新模型。

模型工具按 [统一工具设计](../../../finished/pi-suite/tool-design.md) 注册 job_start、job_list、job_read、job_write、job_stop 与共享 wait，内部走同一个 manager；上游 interactive_shell 与 background_job_* 不再注册，旧调用方式不保留。attach/detach 是用户在 /jobs 详情或终端视图中的操作，不注册为模型工具。

| job_start 参数 | 规则 |
| --- | --- |
| command | 必填，除非使用 monitor.fileWatch 或 CLI agent 预设；1–32768 字符 |
| mode | pipe（默认）或 pty；需要 TTY、REPL、交互输入或 hands-free 时用 pty |
| name、cwd | name 最长 80；cwd 相对当前会话 cwd 解析 |
| timeoutMs | 省略不限时；到期结算为 timed_out |
| taskId | 关联任务的展示引用，不改变归属 |
| attach | 仅 pty；启动后立即打开终端视图给用户操作 |
| monitor、handsFree、agent | 见 [监视与委派](monitors.md) |

job_write 参数 id 与 input、keys、paste 三选一：input 为原文，submit 为 true 时追加回车；keys 为命名按键数组（enter、up、ctrl+c、alt+x、shift+tab 等，沿用上游 key-encoding）；paste 使用括号粘贴模式发送多行文本；sensitive 为 true 时输入记录不保存正文。pipe 模式的 stdin 只接受 input/paste。

平台后端：Windows 使用经过实际验证的 ConPTY 兼容 PTY 提供者和 Windows 进程停止实现；Linux 使用原生 PTY 和 POSIX 进程组。`pi-background-jobs` 的 Windows 控制代码不能直接当作 Linux 支持。PTY 由 zigpty 提供，上游 pi-interactive-shell 在 Windows 只终止 PTY 根进程，需接入 pi-background-jobs 的进程树停止补齐；Windows 上 shell 解析沿用 Pi 的 Bash 选择，缺少 Git Bash 时 PTY 与 pipe 都无法启动，错误需明确提示。

不保留上游默认的工作区独占锁：PTY REPL 与构建常需并存。单个 job 日志上限 100 MiB、工作区历史上限 1 GiB，达到日志上限时以 log_limit 原因停止。

运行中和已结束的 job 都可以查询和查看；命令、输入、输出、时间与退出结果按需读取，手动停止保留历史，detach 或关闭查看器不终止执行。完整契约见 [job 记录、输入输出与手动控制](history-control.md)，读取与搜索见 [输出读取](output.md)。活动数量由 manager 提供给 [共享状态栏](../status.md)，不由独立 widget 各自计数。
