# 基线与验证

开发依赖锁定 @earendil-works/pi-coding-agent、pi-ai、pi-tui 1.5.0 和 typebox 1.3.27，使用新作用域 API；调度运行依赖锁定 croner 10.0.1。Windows 实际 CLI 为 Pi 1.5.0；Linux 使用同版本 SDK。项目要求 Node.js 24+ 和 pnpm 12.6.0。Linux 按操作系统能力验证，使用已有环境，不安排发行版专项或安装新发行版。

Linux 检查复用已有 Node.js/nvm 环境；非交互 shell 应先加载 nvm 初始化脚本，再解析 node 命令。pnpm-workspace.yaml 的 supportedArchitectures 为 Windows/Linux 保留平台可选依赖，使共享依赖目录包含 TypeScript 7 的两平台编译器。

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)。ask 以 pi-ask-user 0.17.2 的工具契约为基线，将交互重构到公共 runtime/ui；其完整许可证保存在 [许可证](../../third-party/licenses/pi-ask-user.txt)。所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

goal 参考 @narumitw/pi-goal 0.54.15 的工具契约与控制语义，生命周期接入 Pi 1.5.0 的公共最终结算接口，许可证见 [pi-goal MIT](../../third-party/licenses/pi-goal.txt)。

goal 模型工具的 3 项 Linux 契约检查通过，核对空白参数 INVALID_ARGS、错误或缺失 goalId 的 NOT_FOUND、非 active 目标的 NOT_RUNNING，以及失效修订/绑定或非所属会话的 STALE_BINDING；工具错误通过共享 ToolError 保留代码与调用 goalId，操作边界见 [目标接口](goal/operations.md)。

## 检查

```sh
pnpm typecheck
pnpm test
```

模块准入的 1 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，覆盖与 process.cwd 不同的 ctx.cwd 项目配置、工具/命令注册和手动 active-tool 选择、首次 mentions 补全、new/resume/fork/tree 重绑与 reload 重新准入、child 配置根与实际工具目录分离。goal 模块未实际创建时，startup/重绑/reload/quit 保留其他 provider 的 goal 状态；活动摘要与必要详情未变时不重复写入或请求 Dock 重绘。全禁用模块的 reload 保留既有 job、SDK child 和 workflow Worker，quit 通过既有 owner 注册等待 child/session、Worker、job/gate 的真实结算与清理，不创建新的运行时。

Node 内置测试运行器使用 experimental-transform-types 加载 TypeScript。检查包括外部参数契约、混合批量最终确认、预选/推荐身份、排队及超时竞态、配置覆盖、会话撤销、通知合并、状态去重和原生消息呈现；相同 goal 摘要不重复写状态；等数量的活动 ID 变化更新集合，必要详情相同时不请求 Dock 重绘，问题/清理/选择变化则单独刷新详情。实际 Pi SDK 通过原生工具包装器验证注册及结果；TUI 组件检查 40×24、60×30、120×40 的询问高度和可见宽度。目标检查使用 SDK 自带 faux provider，通过真实宿主核对正常继续、重试成功/耗尽、手动与阈值/溢出压缩、压缩取消、Esc、未回答询问、预算、reload、新建/恢复/fork、树切换和期限恢复；压缩摘要由公共 hook 提供。原生 footer 核对 40、60、120 列的状态行与宽度。

jobs 检查使用真实进程：pipe 的 stdout/stderr、退出码与耗时，stdin 输入与 sensitive 记录，进程树停止确认、重复停止与已结算不再停止，timeoutMs，另一 manager 只读历史，按创建归属级联停止及停止期间的启动，quit 停止与准入关闭，PTY 输入与合并输出；并通过真实宿主核对 wait 撤销通知、轮后结算恰好唤醒一次、状态计数清除、列表筛选与参数冲突、job_stop 结果和不支持的通道。同进程保活用 SDK 的 AgentSessionRuntime 与 reload 核对：job 运行中执行 new、resume、fork 与 reload，仍是原进程且日志连续，只有所属会话收到一次结果。输出读取核对小日志全量、1 MiB 与 100 MiB 日志的头尾与中段关键行截断及续读范围、中文与 emoji 分页边界、搜索上下文与匹配上限续读、无效正则，以及 PTY 回车覆写与重复行折叠。Windows 用 Git Bash 运行（测试在临时 agentDir 的 settings.json 设置 shellPath），Linux 用系统 bash。

共享 wait 用内存来源核对其他对象结算、未在 ids 中的 child 提问、等待中与等待前的用户插话、超时，以及 mode all 的部分结算不返回；真实宿主核对等待一个 job 时另一 job 结算提前返回且不再通知、用户 steer 结束等待且不停止 job。goal_wait 的 waitFor 通过真实宿主核对其他 job 结算不结束等待、恢复时合并送达，以及已结算 ID 不进入等待。终端视图在真实 PTY job 上核对用户按键接管后模型写入返回 USER_CONTROL、Ctrl+G 交还、Ctrl+T 带回含用户与模型输入结果的屏幕、Ctrl+B 离开后 job 仍在运行。monitor 用真实进程核对 literal 与阈值 trigger、同行去重、冷却、detector 丢弃与改名，poll-diff 在样本变化时触发，file-watch 不带 command 运行并在文件事件时触发；真实宿主核对 monitor 事件使等待其自身 job 的 wait 提前返回、events 通道读取，以及已返回事件不再唤醒。

询问协调的 1 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，使用公共 UI 包装器与 AskView 键盘输入核对 answered、timed_out、cancelled；两个真实 child 的父级问题与实际 pipe job 完成在原生询问期间暂存，恢复边界和 goal 请求合并为一条消息。超时或取消后目标等待新的用户 prompt；父级原生询问依次展示，排队不启动第二题期限，回答后两个 child 实际完成，已消费消息不再次唤醒。child 问题的父级协议期限独立管理。该检查通过受控 UI 上下文驱动实际组件和定时器，Windows 组合与真实手机 SSH 由 [询问待办](../todo/pi-suite/ask/index.md) 管理。

hands-free 的 4 项检查覆盖静默/定时增量更新、单次与总输出预算、暂停与释放、真实 PTY 的宽限期与用户接管、静默终止的进程组清理证据、总运行超时与自行退出，以及 wait 返回更新后去重和 reload 后 goal_wait 恢复。该范围在 Linux（Node 24.22.2）通过，Windows 监督验收由对应待办管理。

CLI 启动的 7 项检查覆盖预设字段合并、用户级策略与精确命令优先级、真实 Bash 的字面量 prompt/Pi fork 参数、受控 CLI 启动读取、拒绝与取消不创建进程或历史、取消询问后的 goal 自动工作停止、最终 monitor/detector 命令授权，以及非交互模式和参数互斥。实际 Pi 1.5.0 发布 CLI 用隔离资源与 faux provider 验证 fork 源会话保持原文、复杂 prompt、真实 PTY 接管/交还/离开及确认清理；以 @ 开头的 Pi 位置 prompt 在启动前报告上游附件解析限制。Codex 0.166.0 与 Claude Code 2.1.153 通过实际预设/JobManager PTY 与本地受控服务验收，复杂初始正文、用户输入与交还后的模型输入逐字进入主对话 HTTP 请求，CLI 显示对应 SSE 回复，USER_CONTROL 与 managed_scope_confirmed 停止通过。Codex 隔离配置并用 --no-daemon，Claude 使用 --bare、空配置/工具和本地测试密钥；该结论仅覆盖上述版本的 Linux 文本交互，范围见 [CLI 文本阶段](../finished/pi-suite/jobs/cli-pty.md)。cursor 的 agent 命令缺失，CLI 工具执行、Windows 与手机组合继续按 [监督待办](../todo/pi-suite/jobs/monitors.md) 验收。

输出组合的 1 项 Linux（Node 24.22.2）真实 PTY 检查通过，核对密码提示至 LF 回显隐藏、从提示之后的原始 offset/search 读取、CSI/BS/中文宽字素、重复两行折叠与 fullScreen 提示；原始日志保留真实字节，sensitive 输入不保存正文，终态 outputPreview 在 2 KiB 内。既有真实 SDK 通知聚合核对预览与完成结果同条投递；14 项读取/agent/job 定向聚合同时核对上下文、keys 原始范围、预算与实际 more 提示续读。多行 100 MiB 与 UTF-8 验收通过，平台组合由 [输出待办](../todo/pi-suite/jobs/output.md) 管理。

超长逻辑行的 1 项 Linux（Node 24.22.2）聚合通过，覆盖 100 MiB 文件单行的完整起止锚定、未命中、中文跨块、空行、原始 offset 续读及默认关键行预算。相同环境的含中文单行与 Unicode 正则可复现 V8 栈资源失败，完整匹配输入保持原样，求值 RangeError 明确报告 REGEX_RESOURCE_LIMIT。真实 SDK 核对 job_read/agent_read 直接调用与工具管线保留错误、失败不消费结果或增加模型请求、普通全文匹配与原始分页成功；job 日志来自实际进程，agent 大结果为真实已结束 child 记录的受控注入。单行组装为线性，缓冲与解码内存随行长增长，任意正则不保证执行时限；机制见 [长行阶段](../finished/pi-suite/jobs/long-line.md)。真实 PTY 另核对垂直重绘、备用屏幕切换、覆盖帧、停在备用屏幕和先返回主屏再退出，以及同 owner 最后一屏和重启只读日志；当前画面使用既有 xterm，线性 reader 不还原二维历史，见 [屏幕范围](../finished/pi-suite/jobs/screen-range.md)。

jobs 技能格式与实际 Pi 包资源加载验收通过，覆盖 package.pi.skills、包管理器/ResourceLoader/SDK 发现、原生 /skill 调用及 jobs=false reload 撤销工具并保留 ask_user；技能始终先核对实际工具，模块开关不影响 Pi 包级资源发现，见 [技能发布阶段](../finished/pi-suite/jobs/skill.md)。

日志查看的 3 项检查在 Linux 使用真实 pipe job，覆盖底部实时跟随、滚动与搜索保留位置、UTF-8 分次写入、关闭详情后进程继续及退出后补读最终输出；历史核对有界尾窗、前后字节翻页、字面量 Markdown 与 40/60/120 列渲染，列表核对同一筛选集合插入新记录后的游标稳定、会话/workspace 范围与已结束详情。Windows 与完整 /jobs 交互选择流程继续由历史控制专项验收。

历史主动清理的 1 项 Linux（Node 24.22.2）真实 SDK/进程聚合检查通过，覆盖活动/磁盘未确认拒绝、settlement/inputQueue/saveQueue 后删除元数据及全部日志、晚消费不重建、阻塞期间未读通知撤销、原生取消/确认与 foreign 历史删除。只读 agents 历史及受限执行协议隐藏删除入口；Windows 综合流程由 [历史控制专项](../todo/pi-suite/jobs/history-control.md) 验收。

升级控制边界的 2 项检查在 Linux 使用真实宿主 reload 与受控进程，核对执行协议不兼容时查询/日志/停止/指定 ID 等待、活动计数和 quit 可用，新启动与写入明确拒绝，占用注册与退出监听保留，以及空闲替换和历史只读。不同 agentDir 与缺少兼容控制桥的占用注册保持不可接管。创建归属查询核对完整 owned 集合、跨 cwd/owner/branch 与返回副本；v3 控制桥提供完整 sessionJobs/createdBy 查询，v2 保留 createdBy，v1 明确拒绝创建归属查询；v1/v2 显式拒绝完整 session 列表，状态只投影当前分支直属活动 job 并提示一次范围，workspace 读取、停止与 quit 保留。另以真实 monitor detector 延迟最终结算，核对已观测自然退出时重复 stop 等待完整事件、requested:false、退出码 0 和 completed 状态。Windows 升级边界与停止竞争由对应专项验收。

会话 job 可见集的 1 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，核对当前 owner/branch 的直属执行、可见 agent 全部 run 根与回收后代的所属 job，在不同 cwd 的 session 列表、状态数量和稳定分页中使用同一集合；workspace 不扩大目录范围。存储 await 期间的结算以返回时 owned 副本为准；主级可见 child job 不转移结果通知 owner，agents 禁用后仍从当前分支保存记录保留遗留 job，v2 受限计数/完整 session 查询拒绝边界通过。平台组合由 [状态栏待办](../todo/pi-suite/status.md) 管理。

tasks 的 8 项检查在 Linux 覆盖两级批量原子编辑、稳定短 ID、移动与重新打开后的派生进度、依赖反向关系及警告、两个真实进程并发写入同一文件、异步锁等待、无效文件与取消不覆盖。真实 SDK 核对 new/resume/fork/reload 清单独立、内存模式与 job 引用；临时提醒不进入持久 transcript，doing 间隔与项目关闭配置生效。40/60/120 列核对 Dock 完成比例保留、完成反馈与共享详情阅读状态。Windows 与真实手机的界面、并发组合由任务专项管理。

任务界面的现有聚合同时核对父行先分配、余预算 child 相邻展开、blocked 完成与重新打开、选中稳定 ID 及询问期间按实际子任务计数。共享发布器同时接收必要 agent/job 详情，数量不变时的问题、清理和选择变化仍刷新详情，相同内容保持去重。

子代理任务集成的 2 项 Linux 真实 SDK 聚合检查通过，覆盖多 child 同时读写同一 TaskStore 后保留 status/description/owner 与派生进度，以及持久主会话 reload/fork 期间存活 child 的原清单、fork 独立副本、回到原 owner 的回收后 agent_send 恢复和 stable agent/task 引用。完成或停止不自动把任务改为 done；Windows 与真实手机组合由 [任务待办](../todo/pi-suite/tasks.md) 管理。

agents 的 8 项 Linux 离线检查使用真实 Pi SDK child 与 faux provider，覆盖两池队列与排队停止、原生前台问题/回答、嵌套免占位、共享 TaskStore、run 恢复与结束叶子、配置模型来源、真实 abort 与问题超时；真实 pipe job 核对已结束 child 的遗留 job 清理且同级 job 保持运行。模型配置另有 5 项检查，覆盖 /agents 类型写回与即时 agent_start、旧执行独立、当前请求不中断与下一请求切换、持久 individual 恢复、认证丢失、取消不写入、40/120 列原生选择和 transcript 阅读保留，以及配置逐字段位置/删除后的用户值与无效文件拒绝。

模型配置的 Linux 入口组合另通过临时受控 SDK 验收：实际 /agents types 原生选择保存后无需 reload，调度和 workflow 新 child 使用当前类型配置，显式参数优先；已准入请求与 workflow 固定 resume 保留原契约，认证丢失明确报错且不创建替代 run。实际 interactive @类型 输入使用父模型 clone 整理任务、child 使用类型模型，@handle 对结束记录和回收后的持久恢复保持 individual 优先级及历史实际模型。父模型未改写，40/120 列原生选择通过；该验收未增加永久测试条目，Windows 留在 [模型待办](../todo/pi-suite/agents/models.md)，完整范围见 [入口组合阶段](../finished/pi-suite/agents/models-entrypoints.md)。

主从交互的 3 项 Linux 真实 SDK 聚合检查通过，覆盖多 run 的读取/通知消费隔离与边界合并、旧 run 的 wait others 返回和已取消 signal 入口；真实多 child any/all、ids 外问题优先、状态/活动数量/进度读取及提问消费通过。嵌套 FG/BG 问题只到直接父级，主会话 SDK Esc 或 wait 超时后 child 保留 waiting，回答可继续结算；进度字段与结果通知的验收见 [主从交互专项](../finished/pi-suite/agents/interaction.md)，平台与真实手机组合由 [扩展专项](../todo/pi-suite/agents/extensions.md) 管理。

进度与通知的 3 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，覆盖并发工具参数摘要与有界正文、排队/等待父级状态、活动用量与流式进度、稳定 agent ID 的全部 run 根和回收后代所属 job；正文最近 20 个 run 不截断 details 或归属集合。创建归属查询不可用时保留明确原因；失败结果通知含实际 SDK 用量和错误，读取按 run 撤销待发结果。

所属 Jobs 的 2 项 Linux（Node 24.22.2）原生组件/真实 SDK 检查通过，覆盖所选 run 子树与回收后代、不同 cwd、同 agent 新 run 和无关 job 排除、单独停止选中 job、Transcript 滚动/搜索/折叠与执行引用保留；真实新会话的 foreign PTY 历史允许日志且隐藏 attach/stop，通知 hold 退出后一次释放。modules.jobs=false 保留同 owner 的既有 job 查询，主会话 quit 即使未查询也完成清理。Windows 与真实手机 SSH 组合由 [扩展专项](../todo/pi-suite/agents/extensions.md) 管理。

停止竞争的 3 项 Linux 聚合检查通过，覆盖同步 abort/event/changed 重入只清理一次、整批排队目标取消与回调 drain、清理期间及 task I/O 后的新 run 准入、旧 run 停止不影响新执行和 sweep 后同范围合并。真实 job 核对回收后代的祖先清理、授权等待期间停止阻止后续启动；父级最终结算核对自然终态 child、清理失败与父级 job 清理均等待全部 done，并保留正确终态和错误。

资源基础的 4 项 Linux 真实 SDK/faux 检查覆盖已配置包声明、字段优先级、门控、精确排除与目录/单文件、同名类型覆盖、项目信任与路径/符号链接边界；真实扩展核对排除工厂不执行、本包不重复、晚注册工具、第一请求扩大工具集合后的直接/嵌套调用限制，以及 MCP 服务器通配与桥接。技能完整预加载一次、memory 前 200 行及只读/读写目录行为、父级文本不含工具结果、frontmatter 运行选项与会话目录、隔离提示和嵌套准入均通过。Windows、实际 MCP 服务、更多竞争与综合资源组合按 agents 专项继续验收。

@handle 的 3 项 Linux 检查使用真实 SDK 输入事件、faux provider 与 Pi 原生补全，覆盖 handle/alias 唯一及恢复、会话过滤、排队消息、文件与命令补全并存、CJK 前缀及重复绑定；克隆核对当前父级上下文、只持有一个注册启动工具、重复调用只有一次启动、普通 owner/run 与前台结果通知、活动引导和结束恢复。切换事件取消实际流式克隆并拒绝后续启动，克隆未调用工具时明确报错；配置关闭、裸名称/文件/普通文本/图片、非用户与 print 输入边界通过。Windows 与真实手机 SSH 的提及组合按扩展专项继续验收。

定时调度的 4 项 Linux 检查使用真实 SDK/faux、计时器与原生选择器，覆盖六字段 cron、周期与相对/ISO 单次、无效时间、远期延时、文件竞争只准入一次与损坏文件保留；原生 agent_start 核对参数互斥、长名称取消和 40/120 列、关闭后的 schema。实际 once/interval/cron 在普通池满时立即启动并保持计数，触发时使用更新的类型选项，普通 run 的结果通过统一通知；实际 new/resume/reload 按 owner 恢复期限，模型不可用时保存和通知错误且不替换。公共 JSON 存储沿用 tasks 的真实多进程锁、取消/无效文件与宿主会话验收。另 1 项真实 SDK/虚拟时钟聚合核对纽约→UTC reload 保留已提交期限并恰好触发一次，后续 cron 使用当前本地时区，日历夏令时 23/25 小时、固定周期 24 小时，以及错过周期恢复与 claim 共用原相位。范围见 [时区阶段](../finished/pi-suite/agents/schedule-timezone.md)，Windows 与实际 CLI/手机 SSH 调度组合按扩展专项继续验收。

RPC 的 4 项 Linux 检查使用真实 SDK/faux 与公共事件总线，覆盖五通道和版本 2、工厂后的注册、重复绑定、reload 撤销/恢复、生命周期与用量、同步消费不触发父级请求、待发通知撤销、已结束引导拒绝、启动错误与显式模型/参数校验；排队即时返回、信号取消、满池绕过、普通级联停止和会话/嵌套/workflow 归属拒绝通过。指定 cwd 保留父级配置/扩展并隔离目标信任，结构化工具验证、纠正提示、JSON 结果及父工作区列表通过。Windows 与实际外部扩展组合按扩展专项继续验收。

Workflow 编排核心的 6 项 Linux 检查使用真实 Worker，覆盖流水线独立推进、parallel、嵌套阶段和共享并发/预算、结构化返回与 gate、排队期间暂停/跳过/重试及全部尝试用量。journal 成功且未改变的前缀、失败/变化后执行、schema 重检、含 child resume 的整段执行、文件损坏与明确 I/O 错误通过；JSON、metadata 纯字面量、确定性 globals、未支持选项、agent/item/nested 上限、未等待调用与无限循环 Worker 实际终止通过。

Workflow 宿主的 5 项 Linux（Node 24.22.2）真实 SDK/faux 与进程检查覆盖后台工具、结构化 child、cwd gate/短退出/EOF、普通列表与数量隐藏、共享等待消费、journal 重放与 SDK 引用恢复；固定 schema/model/type/tools 续接、实际父模型 wait/agent_send 回答问题、workflow 与排队 agent 的 reload/new/resume owner、quit 等待真实 gate 清理通过。保存资源优先级/信任/包门控、源码互斥、高优先级无效资源、truncated/损坏 journal 与明确持久化错误、工具开关撤销/恢复和手动禁用保持、模型使用动态类型描述、原生 40/60/120 列、精确阶段/unphased 分组、暂停返回的阅读与搜索状态通过。6 项 Worker 核心检查和类型检查通过。Windows、真实手机 SSH 和 shell/资源/MCP 组合按 [扩展专项](../todo/pi-suite/agents/extensions.md) 继续验收。

类型开关与回收的 5 项 Linux（Node 24.22.2）检查覆盖 enabled 逐字段来源、规范类型身份、定义恢复和模型字段保持；真实 SDK 核对普通/嵌套/恢复/workflow 新调用准入、已准入执行与固定 child 续接、原生 40/120 列菜单、即时补全与动态工具说明。回收核对活动执行、未消费通知、多 reader 引用、非持久历史与祖先归属，以及 job 清理失败仍等待 child 结算、后续 stop 重试；既有 runtime/workflow-host 用例同时核对持久历史回收后读取与恢复、遗留 job 清理和 host 失败重试时释放执行引用。该范围及类型检查通过，Windows 与综合生命周期竞争由 [agents 待办](../todo/pi-suite/agents/index.md) 管理。

查看器控制的 4 项 Linux（Node 24.22.2）检查覆盖真实前台转后台的调用释放、两池收费转移、后台记录持久化、父级取消隔离与完成通知；原生查看核对 workflow 问题回答、两次停止与搜索文字隔离、输入往返的阅读状态、实际 child.cwd、多处并发部分结果/assistant 更新及旧 run 延迟输入拒绝。既有 Transcript 聚合检查扩展 toolCallId 配对、partial/final 结果、稳定组件身份与 40/60/120 列缓存和阅读位置。该范围通过，Windows 与真实手机 SSH 留在 [扩展专项](../todo/pi-suite/agents/extensions.md) 验收。

持久历史的 5 项 Linux（Node 24.22.2）检查覆盖默认/类型配置目录的冷启动发现、目标 cwd 与 configCwd 归属、普通/workflow 保存引用、多次 run 的结束叶子、稳定分页及原生只读菜单；真实 SDK 核对直接父级发送准入、当前可见结束记录的模型与清理入口、跨工作区文件缓存及外部 child 引用、磁盘更新和本地编辑/真实 Execution 优先。只读存储核对缺失/未来 header、损坏 JSONL、无效记录、错误叶子与缺失文件、中断 owner 的 failed 规范化，以及读取前后原文件内容和 mtime 保持。该范围通过，发现边界见 [持久历史](agents/history.md)，平台与真实手机组合由 [扩展专项](../todo/pi-suite/agents/extensions.md) 管理。

公共基础的 46 项离线检查及类型检查在 Windows（Node 24.22.2）和 Linux（已有 WSL/nvm 环境，Node 24.14.0）通过，日常检查在 5 分钟内。共享 wait 提前返回、goal_wait waitFor、终端视图与 monitor 的 11 项检查目前只在 Linux 通过，Windows 待复核。另在 Windows 执行 pi-starship 0.65.2 实际 extension_status 模块，验证 goal/runtime 槽位读取、数量上限与空状态。这些检查证明当前询问、目标、执行任务及共享组件的契约；Windows 的 /jobs 综合交互、真实手机 SSH 输入与终端缩放、用户实际第三方 footer 配置和业务模块平台综合生命周期由 [完整实施计划](../todo/pi-suite/implementation.md) 管理。

真实 MCP 的 1 项 Linux stdio 聚合验证原生传输与 discovery、mcp__ 服务器名单和显式资源 helper 并存、禁用与非选择服务器不执行，以及 child 结束后全部服务进程退出。受控真实服务另核对原生 codemode/tool_search、晚注册工具在下一请求执行、隔离与不可信项目不连接；跨 cwd RPC 只加载用户 MCP，不加载父项目或目标项目 MCP。服务为本机协议夹具，业务服务、OAuth 与 Windows 范围见 [MCP 传输阶段](../finished/pi-suite/agents/mcp-transport.md) 和扩展待办。

当前 Linux（Node 24.22.2）检查集共 157 项，全量检查通过，无跳过或取消项，耗时 19.96 秒，类型检查通过；日常检查耗时在 5 分钟内。检查覆盖询问、目标、任务、执行、子代理、workflow 和共享组件的当前契约。平台适用范围按上述各专项结论区分。

完整 Starship 的 1 项 Linux SDK 聚合从开发依赖加载 0.65.2 实际发布入口，核对 goal_wait、tasks、运行 child、两个 job 与主询问在 40×24、60×30、120×40 并存，实际 emoji/24 位样式、max_statuses 插入顺序、disabled/缺失 extension_status、整体换行和显式 Dock 显示。询问期间实际 job 结算不增加模型调用。终端尺寸由受控 fixture 驱动；当前布局满足本包预算，任意用户 footer format 无可靠公共高度反馈，Windows 与真实手机组合按 [footer 联动范围](../finished/pi-suite/footer-integration.md) 的边界继续验收。

[返回当前文档](./index.md)
