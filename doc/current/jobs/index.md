# 执行任务

jobs 模块在同一 Pi 进程内管理 pipe 与 PTY 两种后台执行。实现位于 src/jobs，来源与改动边界见 [上游登记](../../../third-party/UPSTREAM.md)。

包通过 `pi.skills` 发布 [pi-suite-jobs 技能](../../../skills/pi-suite-jobs/SKILL.md)，说明 pipe/PTY 选择、CLI 监督、输入接管、日志与共享等待、停止及历史清理。Pi 的包资源发现独立于模块开关；技能要求先核对当前工具，缺少 jobs 工具时通过可用的 ask_user 询问启用意愿或说明限制，不自行修改配置。

## 结构

- JobManager（manager.ts）持有进程、PTY、日志和记录，不持有 Pi context。它注册在进程全局槽位 `pi-suite.jobs.runtime`，执行协议版本 10；reload 重新导入模块时复用同一 manager。
- JobsModule（index.ts）是每个扩展实例的会话绑定：只在会话绑定期间订阅 manager，发布当前会话的活动数量和结算通知；reload、new、resume、fork、树切换只撤销并重建订阅，不转移所有权。
- 执行协议不兼容且占用中的 manager 仍有活动或未保存的 job 时，保留其注册和退出清理。相同 agentDir 且控制桥版本兼容时，进入受限模式：查询、日志、停止、指定 ID 的 wait/goal_wait 与 quit 通过原实现的闭包调用，活动数量继续更新；新启动、写入与终端 attach 返回 RUNTIME_UNAVAILABLE，自动结果与监督通知暂停。job 全部结束并保存后，/reload 替换空闲 manager，同时释放其退出监听。
- 控制桥版本 3 暴露查询、日志路径、订阅、活动数量、停止、通知已读标记、创建归属查询 createdBy、全 cwd 的直属 sessionJobs 与 quit。版本 2 支持 createdBy，版本 1 的创建归属查询明确返回 RUNTIME_UNAVAILABLE；版本 1/2 不提供完整 session 列表，明确返回 RUNTIME_UNAVAILABLE，workspace 查询、日志、停止与 quit 保留。绑定时提示一次状态仅包含当前分支直属活动 job，完整 child 聚合需要 v3。保存记录和控制返回数据的契约变化需要同步提升控制桥版本。没有兼容控制桥或 agentDir 不同的占用注册保留退出清理，绑定时提示原因，工具返回 RUNTIME_UNAVAILABLE。

## 记录与日志

记录保存在 `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`：job.json 每次以原子重命名写入；pipe 有 stdout.log、stderr.log，PTY 有 output.log；两种模式都有 input.jsonl，带 monitor 的 job 另有 events.jsonl。workspace 为 git 顶层目录，非仓库时为 cwd。

- ID 为 job_ 加 8 位十六进制。
- 记录含命令、cwd、mode、ownerSession、启动时的分支叶子、可选 taskId 与创建归属（agentId 或 workflowId、runId、祖先 run/workflow ID）、起止时间、退出码或信号、停止原因、清理证据与错误。workflow gate 使用同一执行和日志存储，普通 jobs 列表、状态与通知按归属隐藏，查看入口见 [Workflow 操作](../agents/workflow/operations.md)。
- elapsedMs 使用单调计时，运行中随查询更新，退出时固定；未启动的失败不记录耗时。
- 输入记录只表示已发送；sensitive 输入只保存时间、来源、方式和字节数。
- 单个 job 日志达到 100 MiB 时以 log_limit 停止；workspace 历史达到 1 GiB 时拒绝新 job。没有工作区独占锁。

## 结算与停止

只有观测到真实退出才结算：退出码 0 且无信号为 completed，否则 failed；有停止原因时为 stopped，超时为 timed_out，日志超限为 failed。停止请求先进入 stopping，清理为 pending，直至平台后端给出证据：

- Linux 每个 job 根进程是进程组组长；停止前从 `/proc` 捕获根组成员与可追溯后代，包括另建 session/进程组的 CLI 工具。发信号前核对 PID 与精确 start ticks，先 SIGTERM，250 ms 后 SIGKILL，确认捕获范围均已终止；同步进程退出使用同一捕获范围。混有未捕获成员的组只对已核对身份的 PID 发信号，避免扩大清理目标。
- Windows 先以 CIM 记录根进程身份，按创建时间选取子树，终止前再次复核根身份，taskkill /T /F 后确认整个范围消失；查询与 taskkill 之间仍有 TOCTOU 风险。异步身份与清理查询共用按需启动的常驻 PowerShell，以请求 ID 对应 JSON 行响应，查询仍受各自期限与取消信号约束；空闲一分钟关闭，进程及其管道不阻止 Pi 退出。同步 exit 兜底独立启动 PowerShell，不依赖异步工作进程。

Linux 的 CleanupEvidence.scope 身份字段 createdAt 使用 `linux:<boot-relative start ticks>`；Windows 使用 CIM 创建时间。捕获范围保留到实际确认，不因父进程先退出而丢失后代；Z/X 进程已终止，不等待 PID 1 回收 zombie。首次捕获前已脱离祖先链且不在根组的进程不属于可证明范围，不能用历史 PID 恢复其控制权；`/proc` 身份复核与 kill 之间仍有系统调用竞态。

期限内无法确认时清理为 unconfirmed，job 继续计入活动数量。重复 stop 合并到进行中的请求；已结算 job 返回既有结果，不再发送终止。进程已观测到退出、最终 monitor 仍在处理时，stop 等待已有结算并返回 requested:false，保留自然退出码与状态。只有历史、无当前控制句柄的 job 返回 HISTORY_READ_ONLY，不按历史 PID 操作。

stopCreatedBy(runIds) 按本次传入的 agent run/workflow ID 及祖先匹配其创建的全部 job，包括已 detach 的 job；累计关闭的 creator 仅拒绝后续准入，不扩大本次结果范围。停止期间才启动的同归属 job 不再启动，返回 START_NOT_COMMITTED。

createdBy(runIds) 与 stopCreatedBy 共用创建归属选择，从当前运行时持有的全部 job 记录返回副本，不按 cwd、owner、branch 或分页截断；只读查询不关闭 creator。agents 的稳定 ID 查询汇总该 agent 全部 run 根，原生 Jobs 入口限定所选 run 的子树；活动筛选使用公共 isActive，包含非终态、cleanup=pending，以及 cleanup=unconfirmed 且尚未确认根进程退出的对象，任务引用不改变创建归属。

modules.jobs=false 关闭 job 工具注册和会话订阅；agents 保留未绑定的 JobsModule 查询与查看同一进程 owner 的既有 job，reload 不停止或抹去这些 job。主会话 quit 查询当前 agentDir 的既有运行时注册并清理 owner；jobs 与 agents 同时关闭或此前没有查询也适用，清理不创建新 manager。

保活仅覆盖同一 Pi 进程内的 reload、会话及分支操作。session_shutdown 的 quit 停止全部受管 job 与 PTY，共享 10 秒期限并关闭新 job 准入；进程 exit 时用同步停止与保存兜底未结算对象。Pi 重启后保留历史与日志读取，不提供原任务或 PTY 的跨进程重新接管。

## 会话可见集合

job_list 的 session 范围、/jobs 默认列表与状态数量共用 JobsModule 的会话范围：当前 owner 且 anchor 位于当前分支（或为 null）的直属 job，以及当前可见 agent 各次 run 根通过 createdBy 匹配的子树 job。运行时的直属 job 覆盖全部 cwd，agent 后代与已回收/结束运行留下的 job 同样可见；列表在存储读取完成后补入当前 owned 副本，按 job ID 去重，再筛状态与分页。活动数量对同一集合使用公共 isActive，不持久化冗余计数。

工作区列表仍限定当前 workspace；session 列表可包含实际工具 cwd 不同的可见直属/child job，归属和通知 owner 保持原值。agents 模块关闭时，从当前分支保存的 agent 记录复用 visibleAgent 提取 run 根，不创建 AgentManager runtime。只有磁盘历史且没有运行时控制句柄的记录不计活动，不能根据历史 PID 重建进程。

执行协议不兼容时，v3 控制桥保留完整 session 查询与计数；v1/v2 只能显示当前分支直属活动数量并在绑定时提示其范围，完整 session 查询明确拒绝。各版本受限运行时的新启动、写入和 attach 均遵循上述受限模式。

## 工具

| 工具 | 参数与行为 |
| --- | --- |
| job_start | command 或 agent、mode?（pipe 默认、pty）、name?、cwd?、timeoutMs?（省略不限时）、taskId?、attach?、monitor?、handsFree?；授权后启动并返回 ID，未匹配策略的命令先询问用户。tasks 启用时 taskId 须对应当前清单的子任务，job ID 写回其执行引用；任务与 job 状态分别管理。agent 指定 preset、prompt、fork?，见 [CLI 预设与启动授权](launch.md)。attach 只用于需要用户直接操作程序的 PTY job（登录、交互提示），立即打开终端视图，用户离开视图后返回；非 PTY 或非交互界面在启动前返回 INVALID_ARGS。monitor 见下节；file-watch 不传 command 或 agent；handsFree 仅用于 PTY，见 [监督与委派](hands-free.md) |
| job_list | id 查看详情，或 state?（active 默认、finished、all）、scope?（session 默认、workspace）、cursor?、limit?（默认 20，最大 100）；id 与列表参数混用返回 INVALID_ARGS；其他或已崩溃 Pi 进程未结算的记录只在 all 中显示为 unsettled history |
| job_read | id、stream?、offset?、limitBytes?、search?、context?；pipe 为 stdout（默认）、stderr、input，PTY 为 output（默认）、input，带 monitor 的 job 另有 events，其他组合返回 UNSUPPORTED_STREAM；PTY 输出转为可见文本，偏移仍指原始字节 |
| job_write | id 与 input、keys、paste 之一，submit 追加回车，sensitive 不保存正文；endInput 关闭 pipe stdin；keys 仅 PTY；非运行状态返回 NOT_RUNNING |
| job_stop | id；返回真实状态、requested、cleanup 与 affected |
| wait | ids（job_/agent_/wf_ 前缀，1–50）、mode?（all 默认、any）、timeoutMs?（默认 300000，最大 3600000）；超时或取消只结束等待，不停止对象。除 ids 按 mode 满足外，当前会话可见的其他对象结算（列在 also 下并撤销其通知）、monitor 事件与 hands-free 更新（包括被等待 job 自身的）、直接 child 提问、用户插话（steer）也提前返回；details.reason 为 condition、question、event、other、user 或 timeout |

结果首行格式为 `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`，清理未确认时附 cleanup 状态，最后一行给出后续调用。

## 输出读取

src/jobs/output.ts 为模型工具、日志查看器和结算预览提供同一 reader，调用共享 runtime/read.ts；agent_read 的结果与 transcript 也复用共享读取。默认按头部、关键行和尾部组合，关键行带前后各一行，truncated 的 head/keys/tail 保留原始字节范围。搜索把正文、上下文及前缀一起计入 limitBytes，超长返回行按 UTF-8 裁剪并标注；job_read/agent_read 的续读提示保留 search/context/limitBytes。

显式 offset 页的 nextOffset 位于完整 UTF-8 字符边界，可能小于 offset+limitBytes；续读使用返回的 nextOffset。默认智能截断的 endOfStream=true 表示已扫描至文件结尾，省略的中间区域通过 truncated 范围另行 offset 或 search 读取。

PTY 输出先以等字节空白隐藏密码回显，再处理 CR、BS、横向 CSI 定位/移动/行清理与字素宽度，折叠连续重复行；提示识别忽略紧邻提示的 CSI 控制序列，并跟踪 ConPTY 的换行、光标回移与重绘回显。无回显时的下一行普通文字保留。原始日志与分页偏移保持原值，提示之后的 offset 页仍恢复隐藏上下文。可见文本转换的范围是当前读取片段内的单条物理行；垂直移动、跨行定位、清屏与备用屏幕切换保留为按日志顺序出现的文本片段，不保证得到最终二维画面。搜索与结算预览沿用这一范围。

fullScreen 表示已有 xterm 曾进入 alternate buffer，即使程序返回主屏，该标志仍保留；读取附全屏提示。同一 owner 运行时可通过 /jobs attach 查看现有 xterm 当前屏幕，结束或停止后查看释放时保留的最后一屏及退出提示。最后一屏取当时的当前 viewport；程序结束前返回主屏时显示主屏，不保存被覆盖的备用屏幕历史帧。Pi 重启后仅能读取磁盘历史日志，无法查看该内存屏幕或恢复 attach；完整二维历史还原不在 reader 支持范围内。

共享 reader 逐块扫描，单条逻辑行只在 LF/EOF 合并一次，完整正则匹配后才裁剪待返回上下文。单行组装为线性成本，单行缓冲和解码仍占用随最长行增长的内存。V8 正则求值的 RangeError 以 REGEX_RESOURCE_LIMIT 明确结束整次搜索并报告原始行范围；可以改用 offset 分页。完整 JavaScript 正则不承诺任意行长度下的常量内存或执行时限。

## 通知

job 结算后，属于当前会话且启动时的分支叶子仍在当前分支上的，经共享 Notifications 投递一次（请求 ID `job:<id>`），消息发出后持久标记 notified。wait 或 job_stop 已返回的结算会撤销该通知。Esc 中止后，本会话尚未通知的 job 不再自动唤醒，结果随下一条用户消息送达。

结算前用同一 reader 捕获至多 2 KiB 的 outputPreview，pipe 汇总 stdout/stderr，PTY 使用已隐藏密码回显的 output；预览在终态发布前完成，随既有结算通知投递。

## monitor

job_start 的 monitor 让模型在输出匹配时被唤醒，pipe 与 PTY 都可用。monitor 读取 job 自己的日志文件（每 250 ms 追读新字节），日志仍是输出的唯一来源。

| 字段 | 规则 |
| --- | --- |
| strategy | stream（默认）逐行匹配完整行；poll-diff 每 poll.intervalMs（默认 5000，最小 250）循环执行 command，样本变化时匹配，首个样本作为基线；file-watch 由本包生成 Node fs.watch 命令监视 fileWatch.path（recursive?、events? 为 rename/change），输出 `CHANGE 名称` 等行后按 stream 匹配，不能同时传 command |
| triggers | 1–20 个，id 唯一；literal 或 regex 二选一。regex 与 job_read search 同语法：`/re/flags`，或裸模式不区分大小写。threshold（captureGroup、op 为 lt/lte/gt/gte/eq、value）比较捕获的数值 |
| dedupeExactLine | 默认 true，同一 trigger 的同一行（或差异摘要）只触发一次 |
| cooldownMs | 同一 trigger 两次触发的最小间隔；trigger 自己的 cooldownMs 优先 |
| detector | command 从 stdin 接收候选事件 JSON，stdout 返回 true/false 或 `{"emit":bool,"triggerId"?,"matchedText"?,"lineOrDiff"?}`，空输出视为通过；timeoutMs 默认 3000。detector 失败时候选事件附 detectorError 照常投递，不静默丢弃。需要以参数接收命令的 Bash |

poll-diff 每轮在子 shell 中执行 command，将该轮 stderr 合入 stdout，完成后写入不可见的私有 OSC 边界，再等待 poll.intervalMs；间隔不包含命令执行时间。追读器按完整边界比较样本，不按时间窗口取样；跨读取块保留未完成片段，停止时丢弃没有完成标记的末轮，不把中断产生的空样本当作变化。command 的 exit 或局部 shell 状态只作用于该轮。pipe 的轮次顺序由同一输出流保持；Windows ConPTY 可能重排 OSC 与画面重绘，PTY 轮次边界不保证任意程序下精确，需可靠比较时选择 pipe。终端与可见文本读取不显示私有标记，原始日志和字节偏移包含标记。

PTY 行先按回车覆写转为可见文本，pipe 行去除控制字符。事件按 eventId 递增写入 events.jsonl（时间、strategy、triggerId、匹配文本、行或差异、stream），job.json 记录 monitor 配置、事件数与已送达数。job 退出时先读完剩余日志并等待 detector，再结算，结算结果的首行附 `events N`。

未送达的事件以请求 ID `job:<id>:monitor` 进入共享 Notifications，同一 job 只保留一条，带新事件数与最新 10 条；它与结算通知在同一边界合并。wait 返回的事件不再通知；Esc 后改为下一轮送达。goal_wait 的 waitFor 包含该 job 时，它的 monitor 事件也恢复目标。

## 用户操作

job_start 的启动询问复用 ask 面板：↑/↓ 选择 Allow once 或 Do not launch，Enter 选中，Tab 切到操作栏再 Enter 确认。可进入详情查阅完整命令与 cwd；超时、取消或会话绑定撤销均不启动进程，超时/取消结束本轮自动工作。确认只授权本次最终命令，不写入配置；下次同一命令仍按用户级 launchPolicy 判断。非交互模式只接受精确 allow 规则。配置入口与默认值见 [启动授权](launch.md#启动策略)。

`/jobs [active|finished|all] [workspace]` 打开 job 列表，默认当前会话的活动 job；列表内可切换筛选、范围并翻页。选择 job 后可查看详情、读取各通道、对运行中的 PTY job 打开终端视图（已结束的 PTY 显示最后一屏），以及在确认后停止运行中的 job。只有历史记录的 job 不提供 attach 或 stop。浏览期间暂缓结算通知，关闭后合并送达。

当前执行协议可用时，已结算且 cleanup 不是 pending/unconfirmed 的记录提供 `Clear history`；用户确认 `Delete history and logs?` 后，删除该 job 的元数据与全部输入、输出和 monitor 日志。JobManager 等待已有结算、输入/事件写入和保存队列，重试未保存的终态，再由 JobStore 复核磁盘状态后删除目录；删除期间拒绝重复清理，晚到的通知消费不重新创建历史，已排队的结果与事件通知一并撤销。该操作不会停止进程或使用历史 PID，活动与未确认记录、只读 agents 历史及执行协议受限的 owner 不提供清理入口。

agents 记录与 Transcript 的 Jobs 入口复用同一 job 操作界面，按 job 自己的 cwd 读取详情和日志，返回时刷新所属活动集合；只读 agents 历史允许读取详情及日志，隐藏 attach、stop 和 Clear history。浏览保持公共通知阻塞令牌，退出 job 界面不停止其所属 agent。

日志详情初始显示末尾最多 64 KiB 的字节窗口，使用共享详情与滚动组件显示安全的字面量文本。运行中的 job 每 250 ms 检查通道大小；阅读位置在底部且未输入搜索时跟随新输出，向上滚动或搜索时保留当前正文和位置。结算后停止轮询，返回底部仍会补读最终输出；关闭日志详情不停止 job。

| 日志详情操作 | 行为 |
| --- | --- |
| ↑/↓、PageUp/PageDown、Home/End、滚轮 | 在当前字节窗口内滚动；自动跟随模式下返回底部恢复跟随 |
| /、Enter、n/N | 输入并提交当前窗口的搜索，查找下一个/上一个匹配 |
| ←/→、Enter | 选择并执行 Previous bytes、Next bytes、Follow latest 或 Back；前后读取最多 64 KiB，Follow latest 返回最新窗口并恢复跟随 |
| Esc | 退出搜索或关闭详情，job 继续运行 |

窗口范围使用原始字节偏移，日志文本的控制字符清理不改变续读位置。UTF-8 字符跨分页或实时写入边界时只显示完整字符；模型读取仍按 job_read 的默认智能截断与搜索契约返回。

终端视图显示 headless 终端屏幕，宽度随视图调整 PTY：

| 按键（可配置） | 行为 |
| --- | --- |
| 任意其他按键 | 发送给程序；用户接管输入，模型的 job_write 返回 USER_CONTROL；hands-free 更新与静默终止暂停 |
| Ctrl+G（returnKey） | 把输入交还模型，视图保持打开；恢复 hands-free 更新，重新开始静默计时 |
| Ctrl+T（transferKey） | 离开视图并把当前屏幕文本发给模型；/jobs 中作为新消息，job_start attach 中写入工具结果 |
| Ctrl+B（detachKey） | 离开视图，job 继续运行；程序已退出时 Esc 也可离开 |
| Shift+↑/↓ | 滚动终端回滚区，不发送输入 |

离开视图都会把输入交还模型，不停止 job。视图中的按键与 job_write 走同一输入入口，按 sensitive 记录，只保存时间、来源与字节数。视图打开期间暂缓结算通知，避免在用户操作时开始模型回复。

## Shell

pipe 与 PTY 都使用 Pi 自身的 Bash 选择（settings 的 shellPath，否则 Pi 的默认查找）。Windows 上若选中 WSL 的 `C:\Windows\System32\bash.exe`，命令经 stdin 传入：pipe job 无法再接收 job_write 输入，PTY job 直接报错，需要在 settings.json 设置 Git Bash 的 shellPath。

## 验证范围

Windows 实际 Pi CLI 的监督、启动询问、输出分页/搜索、密码隐藏、当前/最后屏幕与只读入口见 [监督与输出阶段](../../finished/pi-suite/jobs/windows-supervision-output.md)；预设参数见 [Pi 预设阶段](../../finished/pi-suite/jobs/windows-pi-presets.md)，实际 Codex/Claude 接管见 [CLI 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md)。Cursor 实际 agent CLI 环境验收由 [执行任务待办](../../todo/pi-suite/index.md) 管理。

[返回当前文档](../index.md)
