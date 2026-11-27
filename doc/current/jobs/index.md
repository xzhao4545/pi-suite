# 执行任务

jobs 模块在同一 Pi 进程内运行后台命令，有两种模式：pipe 把 stdout/stderr 写入文件，PTY 在伪终端中运行交互程序。实现位于 `src/jobs`，上游来源与改动见 [上游登记](../../../third-party/UPSTREAM.md)。

包通过 `pi.skills` 发布 [pi-suite-jobs 技能](../../../skills/pi-suite-jobs/SKILL.md)，内容为 pipe/PTY 的选择、CLI 预设与监督、输入与用户接管、读取、共享 wait、monitor 以及停止结果的含义，不含界面操作。Pi 发现包内技能不受模块开关影响，所以技能要求模型先核对当前可用的工具；缺少 jobs 工具时，通过可用的 ask_user 询问用户是否启用，或说明限制，不自行修改配置。

## 结构

| 部分 | 位置 | 职责 |
| --- | --- | --- |
| `JobManager` | manager.ts | 持有进程、PTY、日志和记录，不持有 Pi context；每个 Pi 进程一个 |
| `JobsModule` | index.ts | 每个扩展实例一个；会话绑定期间订阅 JobManager，发布当前会话的活动数量和通知 |
| `JobStore` | store.ts | 记录目录、job.json 读写、历史列表与删除 |
| 后端 | backends/ | pipe、PTY 启动与各平台进程树停止 |

JobManager 注册在进程全局槽位 `Symbol.for('pi-suite.jobs.runtime')`，注册内容包括执行协议版本（当前为 11）、agentDir、控制桥和 exit 监听。reload 重新导入模块时，协议版本与 agentDir 相同就复用同一个 JobManager。reload、new、resume、fork 和树切换只撤销并重建 JobsModule 的订阅；job 继续运行，记录中的 ownerSessionId 不变。

### 协议升级与控制桥

/reload 后的新代码按下表处理已注册的 JobManager（`runtime.ts` 的 `acquireRuntime`）：

| 已注册 manager 的情况 | 结果 |
| --- | --- |
| 协议版本和 agentDir 都相同，且未关闭 | 直接复用（active） |
| 空闲：`hasOccupancy()` 为 false，即没有活动 job、未完成的启动、未保存的记录或进行中的删除 | 旧 manager 执行 shutdown 并移除其 exit 监听，新代码创建新 manager |
| 占用中，agentDir 相同，控制桥版本为 1–4 | 受限模式（restricted） |
| 占用中，agentDir 不同，或没有可识别的控制桥 | 不可用（unavailable），旧 manager 的 exit 清理保留 |

受限模式下，新代码通过控制桥调用旧 manager 的闭包。查询、日志读取、停止、按 ID 的 wait/goal_wait 和 quit 可用，状态栏活动数量继续更新。job_start、job_write 和终端 attach 返回 RUNTIME_UNAVAILABLE；结果通知、monitor 通知和 hands-free 更新暂停。旧 job 全部结束并保存后，再次 /reload 即替换空闲 manager。受限与不可用时，每次绑定都提示原因；不可用时所有 jobs 工具返回 RUNTIME_UNAVAILABLE。

控制桥（`control.ts` 的 `ControlBridge`）的版本独立于执行协议版本：

| 版本 | 提供的操作 |
| --- | --- |
| 1 | peek、get、list、logPath、subscribe、stop、activeIds、markNotified、quit |
| 2 | v1 加 createdBy |
| 3 | v2 加 sessionJobs（当前会话启动的全部 job，不限 cwd） |
| 4（当前） | v3 加 readTerminalSnapshot（读取终态屏幕）和 clear（删除历史） |

版本不足时的行为：

- v1 调用 createdBy 返回 RUNTIME_UNAVAILABLE。
- v1/v2 的完整 session 列表返回 RUNTIME_UNAVAILABLE；workspace 列表、日志、停止与 quit 仍可用。每次绑定时提示，状态栏只统计当前分支上本会话直接启动的活动 job，不含 agent 创建的 job。
- v1–v3 没有终态快照和删除，查看器只显示日志，不提供 Delete。

保存记录或控制桥返回数据的格式变化时，必须提升控制桥版本。

## 记录与日志

workspace 是 cwd 所在 git 仓库的顶层目录（`git rev-parse --show-toplevel`，3 秒超时）。cwd 不在仓库内，或系统没有安装 git 时，workspace 就是 cwd。路径先经过 realpath；cwd 不存在或不是目录返回 INVALID_CWD，其他 git 失败返回 WORKSPACE_QUERY_FAILED。Windows 上 workspace 键转为小写并统一使用 `/`；workspaceHash 是该键的 SHA-256。

记录保存在 `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`：

| 文件 | 内容 |
| --- | --- |
| job.json | 完整记录；每次先写临时文件再原子重命名 |
| stdout.log、stderr.log | pipe 输出 |
| output.log | PTY 原始输出 |
| input.jsonl | 已发送的输入，两种模式都有 |
| events.jsonl | monitor 事件，仅带 monitor 的 job |
| terminal.json | PTY 结算时保存的终端快照，见 [输出读取](#输出读取) |

目录权限为 0700，文件为 0600。路径任一层是符号链接或解析到托管目录之外时，返回 UNSAFE_PATH。

- job ID 为 `job_` 加 8 位十六进制，分配时跳过已存在的目录。
- 记录字段：command、cwd、mode、ownerSessionId（启动 job 的会话）、anchorEntryId（启动时的会话叶子 entry）、可选 taskId/taskGeneration、可选 `creator`、起止时间、exitCode 或 signal、stopReason、cleanup（清理证据）、error。`creator` 记录由 agent 或 workflow 启动的 job 的 agentId 或 workflowId、runId 和祖先 run ID。
- creator 带 workflowId 的 job 是 workflow gate。它使用同一套执行和日志存储，但普通 job 列表、状态和通知都不显示，查看入口见 [Workflow 操作](../agents/workflow/operations.md)。
- elapsedMs 用单调时钟计算，运行中每次查询都会更新，退出时固定。从未启动的失败没有 elapsedMs。
- input.jsonl 只证明输入已发送给程序。sensitive 输入只保存时间、来源、方式和字节数。
- job.json 保存失败时，error 附加 `history not saved: …`，并按 1 秒起倍增、最长 30 秒的间隔重试。
- 输出日志（pipe 为 stdout 加 stderr，PTY 为 output）每秒检查一次大小，单个 job 达到 100 MiB 时以 stopReason=log_limit 停止。
- workspace 目录总大小达到 1 GiB 时，job_start 返回 WORKSPACE_CAPACITY。
- workspace 没有独占锁，多个 Pi 进程可以同时在其中运行各自的 job。
- 无法解析的 job.json 在列表中显示为 `history error`，不影响其他记录。

## 结算与停止

job 只在观测到进程真实退出后结算，终态由 `state.ts` 的 `settleExit` 决定：

| 条件 | 终态 |
| --- | --- |
| stopReason=timeout | timed_out |
| stopReason=log_limit | failed |
| 其他 stopReason（user、agent、quit、start_aborted、quiet） | stopped |
| 无 stopReason，退出码 0、无信号、无退出错误 | completed |
| 其余情况 | failed |

cleanup 有四种状态：

| 状态 | 含义 |
| --- | --- |
| not_required | 进程自然退出，未执行停止；不检查退出后残留的后代进程 |
| pending | 停止进行中 |
| managed_scope_confirmed | 后端确认受管范围内的进程全部消失，且根进程已退出 |
| unconfirmed | 期限内无法确认，cleanup.error 记录原因 |

停止流程（`JobManager.stop`，默认期限 10 秒）：

1. 状态改为 stopping，cleanup 改为 pending。
2. 等待启动完成，然后由平台后端执行停止并返回清理证据 `CleanupEvidence`（state、scope 进程身份列表、rootExited）。
3. 根进程已退出时，等待日志、monitor、终端快照和输出预览处理完毕，再返回终态。

`state.ts` 的 `isActive` 决定 job 是否为活动，用于状态栏数量、列表的 active 分组和 /jobs 排序。满足任一条件即为活动：

- 状态不是终态（starting、running、stopping）；
- cleanup 为 pending；
- cleanup 为 unconfirmed，且尚未观测到根进程退出（`cleanup.rootExited` 为 false）。

已结算、cleanup 为 unconfirmed 但根进程已退出的 job 不计为活动，仍以 `cleanup unconfirmed` 显示在结果首行和 Dock 中。

重复调用与边界：

- 重复 stop 加入进行中的停止，并可缩短其期限。
- 已结算的 job 返回原结果，requested 为 false，不再发送信号。
- 进程已退出、结算仍在处理（读完日志、等待 detector）时，stop 等待结算并返回 requested:false，保留自然退出码和状态。
- 本进程没有控制句柄的历史记录返回 HISTORY_READ_ONLY，不按历史 PID 发送信号。

### 平台后端

Linux（`backends/linux-tree.ts`）：

- 每个 job 的根进程是进程组组长。pipe 子进程以 detached 启动；PTY 由 /bin/sh 引导，并用一个辅助进程固定进程组 ID。
- 启动时从 `/proc/<pid>/stat` 记录根进程身份。身份的 createdAt 为 `linux:<开机以来的启动 ticks>`。
- 停止时从 `/proc` 捕获范围：根进程组的全部成员，加上从已捕获进程沿父子关系找到、启动时间不早于父进程的后代，包括另建 session 或进程组的子进程。捕获结果一直保留到确认结束，父进程先退出也不会丢失后代。
- 发信号前逐个核对 PID 与精确的启动 ticks。一个进程组的成员全部核对通过时向整组发信号；混有未捕获成员时，只向核对通过的单个 PID 发信号。
- 先发 SIGTERM；250 ms 后重新捕获仍存活的范围并发 SIGKILL，然后等待到期限。
- 状态为 Z 或 X 的进程视为已终止，不等待 PID 1 回收 zombie。
- 首次捕获时根进程已退出，则无法建立范围，cleanup 为 unconfirmed。
- 首次捕获前已脱离祖先链且不在根进程组内的进程不在范围内；`/proc` 核对与 kill 之间存在系统调用竞态。

其他 POSIX 平台向根进程组发 SIGTERM，250 ms 后发 SIGKILL，进程组消失即确认。

Windows（`backends/windows-tree.ts`）：

- 启动后在 3 秒内用 CIM（Win32_Process）记录根进程的 PID 和创建时间。没有记录到根身份时，停止拒绝按 PID 操作，cleanup 为 unconfirmed。
- 停止时查询全部进程，按父 PID 与创建时间（不早于父进程）选出子树。终止前再次核对根进程身份，然后执行 `taskkill /T /F`，每 50 ms 查询一次，直到整个范围消失或接近期限。查询与 taskkill 之间存在 TOCTOU 风险。
- 异步查询共用一个按需启动的常驻 PowerShell，按请求 ID 对应 JSON 行回复。每个查询有自己的期限和取消信号；查询超时会重启该 PowerShell 并重发其余查询。PowerShell 空闲 60 秒后关闭，其进程和管道不阻止 Pi 退出。
- 进程 exit 时的同步停止另行启动 PowerShell，不依赖常驻进程。
- PowerShell 与 taskkill 只从 `C:\Windows\System32` 启动；SystemRoot 不是 `C:\Windows` 或该目录被重定向时拒绝停止，cleanup 为 unconfirmed。

### agent 创建的 job

`createdBy(runIds)` 返回当前 JobManager 持有的、creator.runId 或祖先 run ID 命中任一传入 ID 的全部 job 副本，不按 cwd、owner、分支或分页截断，也不改变任何状态。agent_get 的 detail 传入该 agent 的全部 run；Subagents 中某个 run 的 Jobs 入口只传该 run，结果包含其后代 run 创建的 job。taskId 不影响 creator。

`stopCreatedBy(runIds)` 停止同样选出的全部 job，包括已 detach 的 job。传入的 ID 会被永久记入停止集合：之后 creator 命中这些 ID 的 job_start 会先创建记录，再以 START_NOT_COMMITTED 结束（状态 stopped）。本次返回结果只包含调用时已存在的 job。

### 生命周期与退出

- job 只在同一 Pi 进程内保活；reload、会话切换和分支操作不影响运行。
- session_shutdown 的原因为 quit 时，停止全部受管 job（包括 PTY），共享 10 秒期限；此后 job_start 返回 CLOSING。
- 进程 exit 事件时，同步停止仍未结算的 job 并同步保存记录，最多 3 秒。
- Pi 重启后可以读取历史和日志，不能重新接管原进程或 PTY。
- modules.jobs=false 时不注册 job 工具和会话订阅。agents 模块仍用一个不绑定会话的 JobsModule 查询和查看本进程已有的 job；reload 不停止这些 job。
- 主会话 quit 总会查找当前 agentDir 已注册的 JobManager，通过其控制桥（v1–4）退出；jobs 与 agents 都关闭、或此前从未查询 jobs 时同样如此。没有注册时不创建新 manager。

## 会话可见集合

job_list 的 session 范围、/jobs 的 This session 范围和状态栏活动数量使用同一个集合（`JobsModule` 的 `sessionScope`）：

1. 当前会话启动的 job（ownerSessionId 相同），且 anchorEntryId 在当前分支上或为 null；不限 cwd。
2. 当前可见 agent 的各次 run 通过 createdBy 匹配到的 job，包括后代 agent 和已结束 run 留下的 job。
3. 排除 workflow gate。

列表先读取当前 workspace 的存储记录，再合入上述集合中运行时持有的最新副本，按 job ID 去重后筛选状态并分页。活动数量对同一集合使用 isActive，不另存计数。session 列表可以包含 cwd 不在当前 workspace 的 job，这些 job 的 owner 与通知归属不变。

- job_list 的 workspace 范围只返回当前 workspace 的记录。
- agents 模块关闭时，run ID 从当前分支保存的 agent 记录读取（`visibleAgent`），不创建 AgentManager。
- 只有磁盘历史、没有运行时控制句柄的记录不计为活动，也不会按历史 PID 重建进程。
- 受限模式下，v3/v4 控制桥保留完整集合；v1/v2 的行为见 [协议升级与控制桥](#协议升级与控制桥)。

列表分组由 `state.ts` 的 `bucket` 决定：

| 记录 | 分组 |
| --- | --- |
| 本进程控制，isActive 为 true | active |
| 本进程控制，isActive 为 false | finished |
| 仅磁盘记录，已终态且 cleanup 不是 pending/unconfirmed | finished |
| 仅磁盘记录，其他情况（其他或已崩溃的 Pi 进程留下） | unsettled，只在 state=all 中出现，标记为 read-only history |

## 工具

| 工具 | 参数与行为 |
| --- | --- |
| job_start | command 或 agent（二选一）、mode?（pipe 默认，或 pty）、name?（≤80 字符）、cwd?（相对会话 cwd 解析）、timeoutMs?（1–86400000，省略不限时，到期结算为 timed_out）、taskId?、taskGeneration?、attach?、monitor?、handsFree?。command 为 1–32768 字符。检查参数后直接启动，返回首行与 `timeout Nms`（如设置）。agent 见 [CLI 预设与直接启动](launch.md)；monitor 见 [monitor](#monitor)，file-watch 不能传 command 或 agent；handsFree 仅用于 PTY，见 [PTY 监督与委派](hands-free.md) |
| job_list | state?（active 默认、finished、all）、scope?（session 默认、workspace）、cursor?、limit?（默认 10，最大 100）。按约 4 KiB 正文预算在记录边界分页，名称超过 200 字节时缩略。只读历史、unsettled 和 error 在行尾标注 |
| job_get | id、detail?。默认返回首行、显示名、命令前 256 字节、cleanup 与任务引用、error；命令更长时附 detail 入口。detail:true 返回名称、cwd、mode、状态、运行时长、完整命令、时间、退出、timeoutMs、监督统计、cleanup、error、任务和 creator。本进程没有控制句柄时标注 read-only history |
| job_read | id、stream?、offset?、limitBytes?、search?、context?。pipe 的流为 stdout（默认）、stderr、input，PTY 为 output（默认）、input；带 monitor 的 job 另有 events；其他组合返回 UNSUPPORTED_STREAM。读取规则见 [输出读取](#输出读取) |
| job_write | id，加 input、keys、paste 中至多一个；submit 和 endInput 可以单独发送。三者都不给且没有 submit/endInput 时返回 INVALID_ARGS。submit 追加回车（PTY 为 `\r`，pipe 为 `\n`）；keys 仅 PTY；paste 在 PTY 中使用 bracketed paste，在 pipe 中原样写入；endInput 仅 pipe，关闭 stdin（PTY 改用 keys `["ctrl+d"]`）；sensitive 不保存正文。job 不是 running 时返回 NOT_RUNNING，用户接管终端时返回 USER_CONTROL |
| job_stop | id。返回 requested、state、cleanup 和 affected；正文说明已确认停止、清理 pending/unconfirmed，或已结算未发送停止 |
| wait | 共享工具，参数见 [模型工具契约](../runtime/tools.md#共享参数与返回)。job 的结算、monitor 事件和 hands-free 更新（包括被等待 job 自身的）都会使 wait 提前返回。其他提前返回原因：当前会话可见的其他对象结算（列在 also 下并撤销其通知）、直接 child 提问、用户插话（steer）。details.reason 为 condition、question、event、other、user 或 timeout |

taskId 使用 `1.2` 形式，必须同时传 task_list 返回的 taskGeneration：

1. tasks 模块关闭时返回 TASK_SCOPE。
2. tasks 校验该子任务存在且代次有效（缺少或过期的代次报错），然后启动 job。
3. job ID 写回子任务的执行引用；写入失败返回 TASK_LINK_FAILED，此时 job 已在运行。

清空任务列表不停止 job；过期的代次不能写入编号被重用的新任务。任务状态与 job 状态各自管理。

attach 用于用户必须直接操作程序的 PTY job（登录、交互提示）：打开终端视图并直接进入用户输入，用户离开视图后工具返回，job 继续运行。mode 不是 pty 或当前不是 TUI 时，启动前返回 INVALID_ARGS。

结果首行格式为 `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`，秒数保留一位小数，按需追加 `stop <reason>`、`cleanup pending|unconfirmed`、`events N`、`completionReason <reason>`。job_write 只报告 `sent N bytes` 和 `stdin closed`，不回显正文。固定的操作说明写在工具描述里；失败、截断和交接的结果给出具体的后续调用。

工具显示使用公共 renderer：

| 工具 | 折叠行 | 展开内容 |
| --- | --- | --- |
| job_start、job_get | ID、名称、状态 | 完整命令、cwd、timeout、任务引用、状态、cleanup、error、正文；job_get 另附全部字段 |
| job_list | 数量与范围 | 每条 job 的状态、时长与 cleanup |
| job_read | 流与字节区间 | 正文 |
| job_write | 已发送字节与 stdin 关闭状态 | 输入内容，sensitive:true 时显示 `[sensitive]` |
| job_stop | 真实状态与 cleanup 结论 | job 字段与 affected |

job_write 的调用行不显示输入；sensitive:true 的错误正文中输入值替换为 `[sensitive]`。主会话工具结果的单项鼠标展开和默认 Ctrl+O 全部展开由 Pi 管理，错误全文始终可见。

## 输出读取

`output.ts` 的 `readJobLog` 为 job_read、日志查看器和结算预览提供同一个 reader，底层是共享的 `runtime/read.ts`；agent_read 也复用 `runtime/read.ts`。字节读取、分页与搜索的公共参数见 [模型工具契约](../runtime/tools.md#共享参数与返回)。

| 规则 | 行为 |
| --- | --- |
| 默认读取 | limitBytes 默认 4096、最大 65536。小日志整段返回；大日志组合头部、关键行（error、fail、warning 等）及其前后各一行、尾部；truncated 的 head/keys/tail 记录原始字节范围 |
| 搜索 | 正文、上下文和前缀一起计入 limitBytes；超长的返回行按 UTF-8 裁剪并标注。续读提示保留 search、context 和 limitBytes |
| 显式 offset | nextOffset 落在完整 UTF-8 字符边界，可能小于 offset+limitBytes；续读使用返回的 nextOffset |
| endOfStream | 默认智能截断时为 true，表示已扫描到文件结尾；省略的中间部分用 truncated 范围另行 offset 或 search。full 提示从 offset:0 连续读取 |
| 运行中的 EOF | 只表示当前文件结尾，不证明执行已结束 |
| pipe stderr 提示 | 读取 stdout 默认视图（无 offset、无 search）且 stderr 非空时，附 `stderr has N bytes`；job 为 failed 时附读取 stderr 的调用 |
| input 流 | 每行显示时间、来源、方式和 JSON 正文；sensitive 行显示 `[sensitive input sent]` |
| events 流 | 每行显示 eventId、时间、triggerId、stream 和匹配行，detector 失败时附错误 |

共享 reader 逐块扫描，一条逻辑行只在 LF 或 EOF 处合并一次，完整正则匹配后才裁剪要返回的上下文。单行组装是线性成本，但单行缓冲和解码的内存随最长行增长。V8 正则求值抛出 RangeError 时，整次搜索以 REGEX_RESOURCE_LIMIT 结束并报告该行的原始范围，可以改用 offset 分页。完整 JavaScript 正则不保证任意行长度下的常量内存或执行时限。

### PTY 可见文本

PTY 的 output 流在返回前转为可见文本，分页偏移仍指原始字节：

1. 隐藏密码回显：匹配 password、passphrase、passcode、pin、密码、口令等提示后，同一行其后的字节替换为等长空格。提示识别忽略紧挨提示的 CSI 控制序列，并跟踪 Windows ConPTY 离开备用屏后的换行、光标回移与重绘回显。提示后没有回显、也没有光标回移时，下一行的普通文字（例如 sudo 的 "Sorry, try again"）保留。从提示之后开始的 offset 页也会还原隐藏状态。原始日志不修改。
2. 在单条物理行内处理 CR、BS、横向 CSI 定位/移动/行清理与字素宽度。
3. 折叠连续的重复行，显示为 `<行>  [×N]`。

垂直移动、跨行定位、清屏与备用屏切换按日志顺序保留为文本片段，不保证得到最终的二维画面。搜索与结算预览使用同样的转换。

`fullScreen` 表示 xterm 曾进入备用屏（alternate buffer）；程序返回主屏后该标志仍保留。读取 output 时正文前附全屏提示，提示用户可在 /jobs 查看屏幕。

### 终端屏幕与快照

当前或终态的二维屏幕来自 xterm，不由线性 reader 反推：

- 运行中的 PTY 由 headless xterm 维护屏幕，回滚上限 5000 行。job 结算后，本进程继续保留该 xterm 缓冲区供查看器滚动，删除历史时释放。
- 结算时只捕获一次 xterm SerializeAddon 快照：正常屏回滚最多 1000 行，恢复数据最多 4 MiB。超限时回滚行数减半重试；回滚为 0 仍超限时不保存快照，error 记录 `final terminal snapshot unavailable: …`，不截断 ANSI 数据。
- `terminal.json` 原子保存尺寸、光标、是否备用屏和序列化数据；job.json 只保存其中的元信息（尺寸、光标、备用屏标记）。
- 快照保存的是结算时的当前屏：程序退出前已返回主屏时为最终主屏，被覆盖的备用屏帧不保存。
- 跨进程只能读取最终屏幕和有限回滚，不重新执行程序，也不恢复输入。
- 没有可用终端画面的 PTY 记录（无实时终端、控制桥 v1–v3、或快照缺失），查看器底栏显示 `Logs only`，详情说明只有日志可读；快照文件损坏时返回 CORRUPT_HISTORY，不从日志尾部伪造屏幕。

## 通知

job 结算后，满足下列条件时经共享 Notifications 投递一次结果通知（请求 ID `job:<id>`）：job 属于当前会话、不是 workflow gate，且 anchorEntryId 在当前分支上或为 null。消息发出后持久标记 notified。

- 结果通知包含首行、显示名、outputPreview、error，以及 job_read 入口；completionReason 为 quiet 时说明静默终止不代表任务成功。
- wait 或 job_stop 已返回的结算会撤销该通知。
- 用户按 Esc 中止回复后，本会话尚未通知的活动 job 不再自动唤醒模型，结果、monitor 事件和 hands-free 更新随下一条用户消息送达。
- 解绑会话时撤销本绑定排队的通知；新的绑定重新排队尚未送达的项。
- 浏览 /jobs 或终端视图期间暂缓通知，关闭后合并送达。

outputPreview 在终态发布前生成，最多 2 KiB：pipe 的 stdout 与 stderr 各占一半，PTY 使用已隐藏密码回显的 output 可见文本。

## monitor

job_start 的 monitor 在输出匹配触发条件时唤醒模型，pipe 与 PTY 都可用。monitor 每 250 ms 追读 job 自己的日志文件，日志仍是输出的唯一来源。

| 字段 | 规则 |
| --- | --- |
| strategy | stream（默认）：逐行匹配完整行。poll-diff：循环执行 command，每轮间隔 poll.intervalMs（默认 5000，范围 250–3600000），本轮输出与上一轮不同时匹配，首轮作为基线。file-watch：本包生成 Node `fs.watch` 命令监视 fileWatch.path（recursive?、events? 为 rename/change，默认两者），输出 `RENAME 名称` 或 `CHANGE 名称` 行，再按 stream 匹配 |
| triggers | 1–20 个，id 唯一（1–64 字符）；literal 与 regex 二选一（各 1–1000 字符）。regex 与 job_read search 同语法：`/re/flags`，或不区分大小写的裸模式。threshold（captureGroup、op 为 lt/lte/gt/gte/eq、value）比较捕获组的数值，只能与 regex 合用 |
| dedupeExactLine | 默认 true：同一 trigger 对同一行（poll-diff 为同一差异摘要）只触发一次 |
| cooldownMs | 0–86400000，同一 trigger 两次触发的最小间隔；trigger 自己的 cooldownMs 优先 |
| detector | command（≤4096 字符）从 stdin 接收候选事件 JSON，在 job 的 cwd 中用 Pi 的 Bash 执行；stdout 返回 true/false 或 `{"emit":bool,"triggerId"?,"matchedText"?,"lineOrDiff"?}`，空输出视为通过，非零退出视为失败。timeoutMs 为 100–60000，默认 3000。detector 失败时候选事件附 detectorError 照常投递。需要以参数接收命令的 Bash |

poll.intervalMs 只能与 poll-diff 合用，fileWatch 只能与 file-watch 合用，file-watch 不能同时传 command。

poll-diff 的执行方式：

1. 每轮在子 shell 中执行 command，stderr 合入 stdout。
2. 本轮完成后写入不可见的私有 OSC 标记，再等待 poll.intervalMs；间隔不含命令执行时间。
3. 追读器按完整标记切分样本，去掉空行与行尾空白后比较；跨读取块保留未完成片段。
4. 停止时丢弃没有完成标记的末轮，不把中断产生的样本当作变化。

command 的 exit 或局部 shell 状态只作用于当前一轮。pipe 的轮次顺序由同一输出流保证；Windows ConPTY 可能重排 OSC 与画面重绘，PTY 的轮次边界不保证精确，需要可靠比较时用 pipe。终端与可见文本读取不显示私有标记，原始日志和字节偏移包含标记。

匹配前，PTY 行按回车覆写转为可见文本，pipe 行去除控制字符。事件按 eventId 递增写入 events.jsonl（eventId、时间、strategy、triggerId、matchedText、lineOrDiff、stream、detectorError），job.json 记录 monitor 配置、事件总数与已送达数。job 退出时先读完剩余日志、等待 detector，再结算；有事件时首行附 `events N`。

未送达的事件以请求 ID `job:<id>:monitor` 进入共享 Notifications，同一 job 只保留一条，内容为新事件数和最新 10 条（每条最长 200 字符）。事件通知排在同一 job 的结果通知之前。wait 返回的事件不再通知。goal_wait 的 waitFor 包含该 job 时，它的 monitor 事件也会恢复目标。

## 用户操作

主会话空编辑器按 ← 进入底部 Dock，job 行按 Enter 直接打开该 job 的命令/输出查看器。Dock 的选择与按键见 [Dock 键盘进入](../ui/index.md#dock-键盘进入)；完整 job 历史使用 `/jobs`。

job_start 检查参数后直接执行，普通命令、CLI 预设与 monitor（含 detector）使用同一启动流程，TUI 与非交互模式相同。`attach: true` 需要交互终端。配置入口与默认值见 [CLI 预设与直接启动](launch.md#启动行为)。

### /jobs 列表

`/jobs [finished|all] [workspace]` 打开 job 列表，标题为 `Jobs ▸ List`。不带参数时为当前会话的 All。列表使用公共 BrowserView，焦点、过滤、详情与底部两行的通用规则见 [原生会话查看](../ui/index.md#原生会话查看)，配色见 [浏览器配色角色](../ui/index.md#浏览器配色角色)。

| 按键 | 行为 |
| --- | --- |
| w | 循环 Scope：This session / Workspace |
| s | 循环 State：All / Finished，选项显示各自数量 |
| / | 进入过滤，匹配 ID、名称、状态、完整命令和 cwd |
| Tab | 在列表与详情之间切换 |
| Enter | 打开所选 job 的命令/输出查看器 |
| Esc | 先离开详情或清空过滤，再关闭 |

- 排序：活动 job（按 isActive，含根进程未退出的 cleanup unconfirmed）在前，按启动或创建时间倒序；其余按结束时间（没有则用启动或创建时间）倒序。
- 列表行与状态行只显示 job 名称，ID 只出现在过滤元数据和详情中。
- 宽屏右侧详情显示 ID、名称、cwd、模式、状态、运行时长、完整命令、时间、退出与清理；窄屏上下布局。
- 返回列表时保留查询、所选 job 和详情阅读位置。
- 运行变化通过 JobManager 订阅刷新；有活动 job 时每秒刷新时长，计时不读取历史文件或日志。
- 非 TUI 模式下选择 job 只显示文本详情。

### 命令/输出查看器

Dock、`/jobs` 与 agents 的 Jobs 入口打开同一个查看器（`viewer/component.ts` 的 `JobView`）。它按 job 自己的 cwd 读取详情和日志，顶部是命令区，下方是输出区，底部两行是 job 状态行和阅读状态。

- 初始输出：有终端画面时显示终端，否则 pipe 显示 stdout、PTY 显示 output。
- 本进程控制的活动 PTY 默认只读浏览，按 `i` 才接管输入。
- 已结束、跨进程或只读的对象不提供输入和停止，可以读取已有屏幕快照和日志；底栏标注 `read-only object`。
- agents 的只读历史隐藏 Input、Stop 和 Delete。退出查看器不停止 job 或其所属 agent，返回时刷新所属列表。
- 浏览期间持有通知暂缓令牌。

| 按键 | 行为 |
| --- | --- |
| c | 展开/收起命令区（收起 2 行，展开最多约 35% 高度） |
| Tab | 在命令区与输出区之间切换焦点，进入命令区时自动展开 |
| s | 循环切换输出：终端屏幕（如有）、各日志流（stdout、stderr 或 output，input，有 monitor 时 events） |
| d | 打开完整详情：ID、全部字段、清理、monitor、hands-free 与保存的原始 JSON |
| x | 二次确认后停止进程及其子进程；仅本进程控制的活动 job |
| Delete | 二次确认后删除该 job 的记录、全部日志和终态快照；条件见下 |
| detachKey（默认 Ctrl+]） | 离开查看器，job 继续运行 |

各日志流使用独立的 `JobLogView`，分别保留字节窗口、阅读位置、搜索和跟随状态。切走时停止该流的轮询和订阅，切回时刷新。stdout 与 stderr 不合并。

Delete 的条件：控制桥提供 clear，job 已结算且 cleanup 不是 pending/unconfirmed，对象不是只读 agents 历史。删除流程：

1. JobManager 等待已有结算、输入/事件写入和保存队列，重试未保存的终态。
2. JobStore 重新读取磁盘记录核对状态，再删除整个目录。
3. 删除期间拒绝重复删除；晚到的通知消费不会重新写出记录；该 job 已排队的结果和事件通知一并撤销。

删除不停止进程，也不使用历史 PID。

### 日志视图

日志视图初始显示该流末尾最多 64 KiB 的字节窗口，正文按字面量显示（不解释 Markdown）。阅读窗口、滚动与跟随使用公共 DetailsView/ScrollView，规则见 [原生会话查看](../ui/index.md#原生会话查看) 和 [原生阅读与鼠标](../ui/terminal.md#原生阅读与鼠标)。

- 运行中的 job 每 250 ms 检查日志大小。停在底部时持续跟随最新窗口；向上滚动或搜索时暂停跟随，保留当前正文和位置，只更新大小并提示 `↓ new output · End to follow`。
- job 结算后停止轮询，并补读一次最终输出；回到底部时也会补读。
- 窗口范围使用原始字节偏移；UTF-8 字符跨窗口或实时写入边界时只显示完整字符。
- 状态行显示首行、流、字节区间和 following/paused。

| 按键 | 行为 |
| --- | --- |
| ↑/↓、PageUp/PageDown、Home/End | 在当前窗口内滚动；向上阅读暂停跟随，回到底部或 End 恢复并补读 |
| /、Enter、n/N | 输入并提交搜索，跳到下一个/上一个匹配 |
| [ / ] | 读取前/后最多 64 KiB |
| f | 载入最新窗口并恢复跟随 |
| Esc | 退出搜索，或关闭查看器；job 继续运行 |

### 终端视图

终端视图显示 headless xterm 的屏幕、文字属性、颜色、光标和有界回滚，job_start attach 与查看器中的终端使用相同的高度预算。标题、命令区、信息栏和提示先扣除高度，剩余区域的尺寸才 resize 到 PTY；尺寸未变时不重复调用。历史快照保持保存时的尺寸。

底部提示按实际配置的按键显示，离开键在最前，最多两行。接管态显示交还输入、发送屏幕与历史滚动；浏览态显示 Esc 返回和可用时的 `i` 接管；已结束或只读时不显示输入操作。错误和二次确认单独占一行，不挤掉退出提示。命令区有焦点时不显示 `i` 提示。

浏览态不向程序发送任何按键。按 `i`（或 attach 打开时）进入接管态：用户按键通过 `JobManager.write` 以 source=user、sensitive 写入，此时模型的 job_write 返回 USER_CONTROL，hands-free 更新与静默终止暂停。离开视图总会把输入交还模型，不停止 job。

| 按键（离开、交还、发送键可配置） | 行为 |
| --- | --- |
| ↑↓、PgUp/PgDn、Home/End、滚轮（浏览态） | 滚动历史，不发送输入 |
| End、f（浏览态） | 回到底部并恢复跟随 |
| i（浏览态） | 本进程控制的运行中 PTY 进入接管态 |
| 其他按键（接管态） | 原样发送给程序 |
| Shift+↑/↓（接管态） | 按页滚动回滚区，不发送输入 |
| returnKey（默认 Ctrl+G，接管态） | 把输入交还模型，留在视图中；恢复 hands-free 更新并重新开始静默计时 |
| transferKey（默认 Ctrl+T，接管态） | 离开视图，把当前屏幕文字发给模型：在查看器中作为新消息并触发回复，在 job_start attach 中写入工具结果 |
| detachKey（默认 Ctrl+]） | 离开视图，job 继续运行；默认值避开 tmux 的 Ctrl+B 前缀 |
| x / Delete（查看器内，浏览态） | 与查看器相同的停止/删除；停止后 cleanup 为 pending/unconfirmed 时如实显示 |
| Esc（浏览态） | 返回来源；attach 打开时离开视图 |
| ←←（查看器内，浏览态，300 ms 内） | 关闭整个 Jobs/Subagents 浏览链 |

离开、交还和发送键在 `jobs.detachKey`、`jobs.returnKey`、`jobs.transferKey` 中配置，见 [公共运行时](../runtime/index.md#配置)。搜索、过滤和编辑器中的左右键只移动光标。

## Shell

pipe 与 PTY 都使用 Pi 自己的 Bash 选择：settings 中的 shellPath，否则 Pi 的默认查找。Windows 上若选中 WSL 的 `C:\Windows\System32\bash.exe`，Pi 通过 stdin 传入命令：pipe job 因此无法再接收 job_write 输入，PTY job 启动失败，detector 返回 INVALID_ARGS。需要在 settings.json 中把 shellPath 设为 Git Bash。

PTY 以 120×30 启动，环境变量 TERM=xterm-256color；Linux 上移除 TMUX、STY、COLUMNS、LINES 等会误导程序的变量。

## 验证范围

Windows 实际 Pi CLI 的监督、输出分页/搜索、密码隐藏、当前/最后屏幕与只读入口见 [监督与输出阶段](../../finished/pi-suite/jobs/windows-supervision-output.md)，预设参数见 [Pi 预设阶段](../../finished/pi-suite/jobs/windows-pi-presets.md)，Codex/Claude 实际接管见 [CLI 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md)。Cursor 预设只验证了参数构造，未用实际 agent CLI 验收，见 [Windows 收尾记录](../../finished/pi-suite/windows-completion.md)。

[返回当前文档](../index.md)
