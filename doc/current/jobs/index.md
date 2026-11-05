# 执行任务

jobs 模块在同一 Pi 进程内管理 pipe 与 PTY 两种后台执行。实现位于 src/jobs，来源与改动边界见 [上游登记](../../../third-party/UPSTREAM.md)。

## 结构

- JobManager（manager.ts）持有进程、PTY、日志和记录，不持有 Pi context。它注册在进程全局槽位 `pi-suite.jobs.runtime`，协议版本 1；reload 重新导入模块时复用同一 manager。
- JobsModule（index.ts）是每个扩展实例的会话绑定：只在会话绑定期间订阅 manager，发布当前会话的活动数量和结算通知；reload、new、resume、fork、树切换只撤销并重建订阅，不转移所有权。
- 版本不兼容且旧 manager 仍有活动或未保存的 job 时，旧 manager 继续运行，本实例的 jobs 工具返回 RUNTIME_UNAVAILABLE，需结束这些 job 后重启 Pi。

## 记录与日志

记录保存在 `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`：job.json 每次以原子重命名写入；pipe 有 stdout.log、stderr.log，PTY 有 output.log；两种模式都有 input.jsonl。workspace 为 git 顶层目录，非仓库时为 cwd。

- ID 为 job_ 加 8 位十六进制。
- 记录含命令、cwd、mode、ownerSession、启动时的分支叶子、可选 taskId 与创建归属（agentId、runId、祖先 runId）、起止时间、退出码或信号、停止原因、清理证据与错误。
- elapsedMs 使用单调计时，运行中随查询更新，退出时固定；未启动的失败不记录耗时。
- 输入记录只表示已发送；sensitive 输入只保存时间、来源、方式和字节数。
- 单个 job 日志达到 100 MiB 时以 log_limit 停止；workspace 历史达到 1 GiB 时拒绝新 job。没有工作区独占锁。

## 结算与停止

只有观测到真实退出才结算：退出码 0 且无信号为 completed，否则 failed；有停止原因时为 stopped，超时为 timed_out，日志超限为 failed。停止请求先进入 stopping，清理为 pending，直至平台后端给出证据：

- Linux 每个 job 根进程是进程组组长，先 SIGTERM，250 ms 后 SIGKILL，确认整个组消失。
- Windows 先以 CIM 记录根进程身份，按创建时间选取子树，taskkill /T /F 后确认整个范围消失；查询与 taskkill 之间仍有 TOCTOU 风险。

期限内无法确认时清理为 unconfirmed，job 继续计入活动数量。重复 stop 合并到进行中的请求；已结算 job 返回既有结果，不再发送终止。只有历史、无当前控制句柄的 job 返回 HISTORY_READ_ONLY，不按历史 PID 操作。

stopCreatedBy(runIds) 停止这些 agent 执行及其后代创建的全部 job，包括已 detach 的 job；停止期间才启动的同归属 job 不再启动，返回 START_NOT_COMMITTED。

session_shutdown 只有 quit 停止全部 job，共享 10 秒期限并关闭新 job 准入；进程 exit 时用同步停止与保存兜底未结算对象。

## 工具

| 工具 | 参数与行为 |
| --- | --- |
| job_start | command、mode?（pipe 默认、pty）、name?、cwd?、timeoutMs?（省略不限时）、taskId?、attach?；立即返回 ID。attach 只用于需要用户直接操作程序的 PTY job（登录、交互提示），立即打开终端视图，用户离开视图后返回；非 PTY 或非交互界面在启动前返回 INVALID_ARGS |
| job_list | id 查看详情，或 state?（active 默认、finished、all）、scope?（session 默认、workspace）、cursor?、limit?（默认 20，最大 100）；id 与列表参数混用返回 INVALID_ARGS；其他或已崩溃 Pi 进程未结算的记录只在 all 中显示为 unsettled history |
| job_read | id、stream?、offset?、limitBytes?、search?、context?；pipe 为 stdout（默认）、stderr、input，PTY 为 output（默认）、input，其他组合返回 UNSUPPORTED_STREAM；PTY 输出转为可见文本，偏移仍指原始字节 |
| job_write | id 与 input、keys、paste 之一，submit 追加回车，sensitive 不保存正文；endInput 关闭 pipe stdin；keys 仅 PTY；非运行状态返回 NOT_RUNNING |
| job_stop | id；返回真实状态、requested、cleanup 与 affected |
| wait | ids（job_/agent_ 前缀，1–50）、mode?（all 默认、any）、timeoutMs?（默认 300000，最大 3600000）；超时或取消只结束等待，不停止对象。除 ids 按 mode 满足外，当前会话可见的其他对象结算（列在 also 下并撤销其通知）、直接 child 提问、用户插话（steer）也提前返回；details.reason 为 condition、other、question、user 或 timeout |

结果首行格式为 `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`，清理未确认时附 cleanup 状态，最后一行给出后续调用。

## 通知

job 结算后，属于当前会话且启动时的分支叶子仍在当前分支上的，经共享 Notifications 投递一次（请求 ID `job:<id>`），消息发出后持久标记 notified。wait 或 job_stop 已返回的结算会撤销该通知。Esc 中止后，本会话尚未通知的 job 不再自动唤醒，结果随下一条用户消息送达。

## 用户操作

`/jobs [active|finished|all] [workspace]` 打开 job 列表，默认当前会话的活动 job；列表内可切换筛选、范围并翻页。选择 job 后可查看详情、读取各通道（与 job_read 相同的默认截断）、对运行中的 PTY job 打开终端视图（已结束的 PTY 显示最后一屏），以及在确认后停止运行中的 job。只有历史记录的 job 只读。浏览期间暂缓结算通知，关闭后合并送达。

终端视图显示 headless 终端屏幕，宽度随视图调整 PTY：

| 按键（可配置） | 行为 |
| --- | --- |
| 任意其他按键 | 发送给程序；用户接管输入，模型的 job_write 返回 USER_CONTROL |
| Ctrl+G（returnKey） | 把输入交还模型，视图保持打开 |
| Ctrl+T（transferKey） | 离开视图并把当前屏幕文本发给模型；/jobs 中作为新消息，job_start attach 中写入工具结果 |
| Ctrl+B（detachKey） | 离开视图，job 继续运行；程序已退出时 Esc 也可离开 |
| Shift+↑/↓ | 滚动终端回滚区，不发送输入 |

离开视图都会把输入交还模型，不停止 job。视图中的按键与 job_write 走同一输入入口，按 sensitive 记录，只保存时间、来源与字节数。视图打开期间暂缓结算通知，避免在用户操作时开始模型回复。

## Shell

pipe 与 PTY 都使用 Pi 自身的 Bash 选择（settings 的 shellPath，否则 Pi 的默认查找）。Windows 上若选中 WSL 的 `C:\Windows\System32\bash.exe`，命令经 stdin 传入：pipe job 无法再接收 job_write 输入，PTY job 直接报错，需要在 settings.json 设置 Git Bash 的 shellPath。

## 未实现

monitor、hands-free/dispatch、CLI agent 预设、events 通道、终端缩放的平台验证，以及跨 Pi 进程重新 attach，均由 [执行任务待办](../../todo/pi-suite/jobs/index.md) 管理。

[返回当前文档](../index.md)
