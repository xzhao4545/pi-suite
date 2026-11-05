# 基线与验证

开发依赖锁定 @earendil-works/pi-coding-agent、pi-ai、pi-tui 1.5.0 和 typebox 1.3.27，使用新作用域 API；调度运行依赖锁定 croner 10.0.1。Windows 实际 CLI 为 Pi 1.5.0；Linux 使用同版本 SDK。项目要求 Node.js 24+ 和 pnpm 12.6.0。Linux 按操作系统能力验证，使用已有环境，不安排发行版专项或安装新发行版。

Linux 检查复用已有 Node.js/nvm 环境；非交互 shell 应先加载 nvm 初始化脚本，再解析 node 命令。pnpm-workspace.yaml 的 supportedArchitectures 为 Windows/Linux 保留平台可选依赖，使共享依赖目录包含 TypeScript 7 的两平台编译器。

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)。ask 以 pi-ask-user 0.17.2 的工具契约为基线，将交互重构到公共 runtime/ui；其完整许可证保存在 [许可证](../../third-party/licenses/pi-ask-user.txt)。所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

goal 参考 @narumitw/pi-goal 0.54.15 的工具契约与控制语义，生命周期接入 Pi 1.5.0 的公共最终结算接口，许可证见 [pi-goal MIT](../../third-party/licenses/pi-goal.txt)。

## 检查

```sh
pnpm typecheck
pnpm test
```

Node 内置测试运行器使用 experimental-transform-types 加载 TypeScript。检查包括外部参数契约、混合批量最终确认、预选/推荐身份、排队及超时竞态、配置覆盖、会话撤销、通知合并、状态去重和原生消息呈现。实际 Pi SDK 通过原生工具包装器验证注册及结果；TUI 组件检查 40×24、60×30、120×40 的询问高度和可见宽度。目标检查使用 SDK 自带 faux provider，通过真实宿主核对正常继续、重试成功/耗尽、手动与阈值/溢出压缩、压缩取消、Esc、未回答询问、预算、reload、新建/恢复/fork、树切换和期限恢复；压缩摘要由公共 hook 提供。原生 footer 核对 40、60、120 列的状态行与宽度。

jobs 检查使用真实进程：pipe 的 stdout/stderr、退出码与耗时，stdin 输入与 sensitive 记录，进程树停止确认、重复停止与已结算不再停止，timeoutMs，另一 manager 只读历史，按创建归属级联停止及停止期间的启动，quit 停止与准入关闭，PTY 输入与合并输出；并通过真实宿主核对 wait 撤销通知、轮后结算恰好唤醒一次、状态计数清除、列表筛选与参数冲突、job_stop 结果和不支持的通道。同进程保活用 SDK 的 AgentSessionRuntime 与 reload 核对：job 运行中执行 new、resume、fork 与 reload，仍是原进程且日志连续，只有所属会话收到一次结果。输出读取核对小日志全量、1 MiB 与 100 MiB 日志的头尾与中段关键行截断及续读范围、中文与 emoji 分页边界、搜索上下文与匹配上限续读、无效正则，以及 PTY 回车覆写与重复行折叠。Windows 用 Git Bash 运行（测试在临时 agentDir 的 settings.json 设置 shellPath），Linux 用系统 bash。

共享 wait 用内存来源核对其他对象结算、未在 ids 中的 child 提问、等待中与等待前的用户插话、超时，以及 mode all 的部分结算不返回；真实宿主核对等待一个 job 时另一 job 结算提前返回且不再通知、用户 steer 结束等待且不停止 job。goal_wait 的 waitFor 通过真实宿主核对其他 job 结算不结束等待、恢复时合并送达，以及已结算 ID 不进入等待。终端视图在真实 PTY job 上核对用户按键接管后模型写入返回 USER_CONTROL、Ctrl+G 交还、Ctrl+T 带回含用户与模型输入结果的屏幕、Ctrl+B 离开后 job 仍在运行。monitor 用真实进程核对 literal 与阈值 trigger、同行去重、冷却、detector 丢弃与改名，poll-diff 在样本变化时触发，file-watch 不带 command 运行并在文件事件时触发；真实宿主核对 monitor 事件使等待其自身 job 的 wait 提前返回、events 通道读取，以及已返回事件不再唤醒。

hands-free 的 4 项检查覆盖静默/定时增量更新、单次与总输出预算、暂停与释放、真实 PTY 的宽限期与用户接管、静默终止的进程组清理证据、总运行超时与自行退出，以及 wait 返回更新后去重和 reload 后 goal_wait 恢复。该范围在 Linux（Node 24.22.2）通过，Windows 监督验收由对应待办管理。

CLI 启动的 6 项检查覆盖预设字段合并、用户级策略与精确命令优先级、真实 Bash 的字面量 prompt/Pi fork 参数、受控 CLI 启动读取、拒绝与取消不创建进程或历史、取消询问后的 goal 自动工作停止、最终 monitor/detector 命令授权，以及非交互模式和参数互斥。该范围通过 Linux 离线检查，Windows 与实际 CLI 版本的综合运行按完整实施计划验收。

日志查看的 3 项检查在 Linux 使用真实 pipe job，覆盖底部实时跟随、滚动与搜索保留位置、UTF-8 分次写入、关闭详情后进程继续及退出后补读最终输出；历史核对有界尾窗、前后字节翻页、字面量 Markdown 与 40/60/120 列渲染，列表核对同一筛选集合插入新记录后的游标稳定、会话/workspace 范围与已结束详情。Windows 与完整 /jobs 交互选择流程继续由历史控制专项验收。

升级控制边界的 2 项检查在 Linux 使用真实宿主 reload 与受控进程，核对执行协议不兼容时查询/日志/停止/指定 ID 等待、活动计数和 quit 可用，新启动与写入明确拒绝，占用注册与退出监听保留，以及空闲替换和历史只读。不同 agentDir 与缺少兼容控制桥的占用注册保持不可接管。另以真实 monitor detector 延迟最终结算，核对已观测自然退出时重复 stop 等待完整事件、requested:false、退出码 0 和 completed 状态。Windows 升级边界与停止竞争由对应专项验收。

tasks 的 8 项检查在 Linux 覆盖两级批量原子编辑、稳定短 ID、移动与重新打开后的派生进度、依赖反向关系及警告、两个真实进程并发写入同一文件、异步锁等待、无效文件与取消不覆盖。真实 SDK 核对 new/resume/fork/reload 清单独立、内存模式与 job 引用；临时提醒不进入持久 transcript，doing 间隔与项目关闭配置生效。40/60/120 列核对 Dock 完成比例保留、完成反馈与共享详情阅读状态。Windows 与 agents 多 child 更新/恢复关联由任务专项管理。

agents 的 8 项 Linux 离线检查使用真实 Pi SDK child 与 faux provider，覆盖两池队列与排队停止、原生前台问题/回答、嵌套免占位、共享 TaskStore、run 恢复与结束叶子、配置模型来源、真实 abort 与问题超时；真实 pipe job 核对已结束 child 的遗留 job 清理且同级 job 保持运行。模型配置另有 5 项检查，覆盖 /agents 类型写回与即时 agent_start、旧执行独立、当前请求不中断与下一请求切换、持久 individual 恢复、认证丢失、取消不写入、40/120 列原生选择和 transcript 阅读保留，以及配置逐字段位置/删除后的用户值与无效文件拒绝。

资源基础的 4 项 Linux 真实 SDK/faux 检查覆盖已配置包声明、字段优先级、门控、精确排除与目录/单文件、同名类型覆盖、项目信任与路径/符号链接边界；真实扩展核对排除工厂不执行、本包不重复、晚注册工具、第一请求扩大工具集合后的直接/嵌套调用限制，以及 MCP 服务器通配与桥接。技能完整预加载一次、memory 前 200 行及只读/读写目录行为、父级文本不含工具结果、frontmatter 运行选项与会话目录、隔离提示和嵌套准入均通过。Windows、实际 MCP 服务、更多竞争与综合资源组合按 agents 专项继续验收。

@handle 的 3 项 Linux 检查使用真实 SDK 输入事件、faux provider 与 Pi 原生补全，覆盖 handle/alias 唯一及恢复、会话过滤、排队消息、文件与命令补全并存、CJK 前缀及重复绑定；克隆核对当前父级上下文、只持有一个注册启动工具、重复调用只有一次启动、普通 owner/run 与前台结果通知、活动引导和结束恢复。切换事件取消实际流式克隆并拒绝后续启动，克隆未调用工具时明确报错；配置关闭、裸名称/文件/普通文本/图片、非用户与 print 输入边界通过。Windows 与真实手机 SSH 的提及组合按扩展专项继续验收。

定时调度的 4 项 Linux 检查使用真实 SDK/faux、计时器与原生选择器，覆盖六字段 cron、周期与相对/ISO 单次、无效时间、远期延时、文件竞争只准入一次与损坏文件保留；原生 agent_start 核对参数互斥、长名称取消和 40/120 列、关闭后的 schema。实际 once/interval/cron 在普通池满时立即启动并保持计数，触发时使用更新的类型选项，普通 run 的结果通过统一通知；实际 new/resume/reload 按 owner 恢复期限，模型不可用时保存和通知错误且不替换。公共 JSON 存储沿用 tasks 的真实多进程锁、取消/无效文件与宿主会话验收。Windows、实际 CLI/手机 SSH 和本地时区的综合调度场景按扩展专项继续验收。

RPC 的 4 项 Linux 检查使用真实 SDK/faux 与公共事件总线，覆盖五通道和版本 2、工厂后的注册、重复绑定、reload 撤销/恢复、生命周期与用量、同步消费不触发父级请求、待发通知撤销、已结束引导拒绝、启动错误与显式模型/参数校验；排队即时返回、信号取消、满池绕过、普通级联停止和会话/嵌套/workflow 归属拒绝通过。指定 cwd 保留父级配置/扩展并隔离目标信任，结构化工具验证、纠正提示、JSON 结果及父工作区列表通过。Windows 与实际外部扩展组合按扩展专项继续验收。

Workflow 编排核心的 6 项 Linux 检查使用真实 Worker，覆盖流水线独立推进、parallel、嵌套阶段和共享并发/预算、结构化返回与 gate、排队期间暂停/跳过/重试及全部尝试用量。journal 成功且未改变的前缀、失败/变化后执行、schema 重检、含 child resume 的整段执行、文件损坏与明确 I/O 错误通过；JSON、metadata 纯字面量、确定性 globals、未支持选项、agent/item/nested 上限、未等待调用与无限循环 Worker 实际终止通过。

Workflow 宿主的 5 项 Linux（Node 24.22.2）真实 SDK/faux 与进程检查覆盖后台工具、结构化 child、cwd gate/短退出/EOF、普通列表与数量隐藏、共享等待消费、journal 重放与 SDK 引用恢复；固定 schema/model/type/tools 续接、实际父模型 wait/agent_send 回答问题、workflow 与排队 agent 的 reload/new/resume owner、quit 等待真实 gate 清理通过。保存资源优先级/信任/包门控、源码互斥、高优先级无效资源、truncated/损坏 journal 与明确持久化错误、工具开关撤销/恢复和手动禁用保持、模型使用动态类型描述、原生 40/60/120 列、精确阶段/unphased 分组、暂停返回的阅读与搜索状态通过。6 项 Worker 核心检查和类型检查通过。Windows、真实手机 SSH 和 shell/资源/MCP 组合按 [扩展专项](../todo/pi-suite/agents/extensions.md) 继续验收。

公共基础的 46 项离线检查及类型检查在 Windows（Node 24.22.2）和 Linux（已有 WSL/nvm 环境，Node 24.14.0）通过，日常检查在 5 分钟内。共享 wait 提前返回、goal_wait waitFor、终端视图与 monitor 的 11 项检查目前只在 Linux 通过，Windows 待复核。另在 Windows 执行 pi-starship 0.65.2 实际 extension_status 模块，验证 goal/runtime 槽位读取、数量上限与空状态。这些检查证明当前询问、目标、执行任务及共享组件的契约；终端缩放、/jobs 交互选择流程、真实手机 SSH 输入、完整第三方 footer 布局和后续业务模块综合生命周期由 [完整实施计划](../todo/pi-suite/implementation.md) 管理。

当前 Linux（Node 24.22.2）检查集共 120 项，均已通过全量检查或变更影响范围复核，类型检查通过；覆盖询问、目标、任务、执行、子代理、workflow 和共享组件的当前契约。平台适用范围按上述各专项结论区分。

[返回当前文档](./index.md)
