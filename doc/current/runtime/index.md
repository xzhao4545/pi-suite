# 公共运行时与配置

唯一扩展入口为 src/index.ts；入口先注册 CLI prompt 协议，首次真实 session_start 按需加载 runtime/suite.ts，根据 ctx.cwd 读取配置并创建本次扩展激活的模块集合，工具、命令和宿主事件由公共运行时与对应模块注册。当前工具为 ask_user、goal_complete、goal_blocked、goal_wait、task_list、task_edit、job_start、job_list、job_read、job_write、job_stop、agent_start、agent_list、agent_read、agent_send、agent_stop、agent_workflow 和共享 wait，本文说明的操作命令为 /goal、/tasks、/jobs、/subagents、/suite 和默认启用的 /exit。

runtime/tools.ts 的 registerBoundTool 共用 Pi 公开工具注册，刷新描述/schema 时保留当前 active-tool 选择；首次晚注册只按该入口的启用规则加入本工具。agent_start 调度 schema 与 workflow 动态类型描述复用此入口。共享 ID、列表/读取 schema、等待/停止返回类型与错误边界见 [模型工具契约](tools.md)。

## 配置

配置按内置默认、用户文件 `<getAgentDir()>/pi-suite.json`、项目 `.pi/pi-suite.json` 的顺序覆盖，各节逐字段合并。getAgentDir() 遵循 Pi 的 PI_CODING_AGENT_DIR。缺失文件表示无覆盖；无效 JSON、未知字段、数值范围错误及读取失败会报告错误。

```json
{
  "commands": { "exit": true },
  "modules": { "ask": true },
  "runtime": { "openAIResponsesAutoRecovery": false },
  "ui": { "maxRows": 12 },
  "ask": { "timeout": 600000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "tasks": { "reminders": true },
  "agents": { "display": "status", "maxConcurrent": 10, "maxConcurrentForeground": 0, "maxDepth": 3, "persistSessions": true, "workflows": true, "types": {} },
  "jobs": { "display": "status", "detachKey": "ctrl+]", "returnKey": "ctrl+g", "transferKey": "ctrl+t" }
}
```

modules.ask、modules.goal、modules.tasks、modules.jobs 与 modules.agents 在本次激活首次真实 session_start 时决定是否注册对应模块；改变开关后使用 /reload 创建新激活，按该会话 cwd 重新准入。new/resume/fork/tree 只重新绑定，沿用本次模块集合；其他配置在绑定时按当前 cwd 读取。共享 goal 状态键的 ownership 按本次是否实际创建 GoalManager 传给 StatusPublisher，不因重绑时配置值变化而越权写入或清除其他 provider 的状态。modules.jobs=false 关闭 job 工具与绑定，agents 的所属 job 查询/查看和主会话 quit 清理仍使用同一进程 owner，边界见 [jobs](../jobs/index.md#结算与停止)。maxRows 默认 12、范围为 1–30，只限制空闲 Dock 行数，询问独立使用 70% 终端高度上限；timeout 为 0–2147483647 的整数毫秒，表示用户空闲时长，默认 10 分钟；0 不设期限。historyKey 与 jobs 终端视图的 detachKey（离开视图，默认 Ctrl+]）、returnKey（交还模型，默认 Ctrl+G）、transferKey（发送屏幕，默认 Ctrl+T）使用 Pi 的按键标识。默认离开键避开 tmux 的 Ctrl+B 前缀；显式 user/project 键位仍按配置优先级生效，修改后 /reload。公共显示配置接受 status/dock/hidden，不接管 footer。tasks.reminders 控制临时任务提醒，默认 true；任务摘要共用 Dock，见 [任务操作](../tasks/operations.md)。

`/suite` 使用原生 SettingsList 搜索和编辑全部配置字段，展示默认、用户、项目来源与有效值。通用设置保存后 `/reload` 生效，模块和命令另显示当前激活值。`commands.exit` 默认 true，控制 `/exit` 是否注册；其 handler 取消忙碌操作并通过公开 shutdown 进入原生 quit 清理链。字段编辑、继承恢复、复杂 JSON 设置和生效方式见 [设置与退出操作](settings.md)。类型启用、模型与 thinking 也可通过 `/subagents types` 编辑。

jobs.agents 配置 CLI 键对应的 command 与 args，按键和字段合并用户/项目覆盖。job_start 检查参数后直接执行普通命令、CLI 预设与 monitor，规则见 [CLI 预设与直接启动](../jobs/launch.md)。AskManager 按 modules.ask 准入，与 job 启动相互独立。

runtime/text.ts 提供安全字面量文本转换，供任务说明、pipe 日志与 monitor 事件共用；终端回车覆写等 PTY 语义由 jobs 的终端模块处理。

runtime/json-store.ts 为 ConfigStore、TaskStore、ScheduleStore 与 WorkflowStore 提供按目标串行入口、异步 pid:uuid 文件锁、锁内重读、复制后修改、原子保存和快照；领域 schema 与修改规则由具体 Store 定义。Windows 对已有文件的快照也取得同一跨进程锁，避免读取句柄阻止原子替换；缺失文件的快照不创建目录、锁或数据。Windows 删除中的锁文件可能暂时返回 EPERM，仅锁的创建/竞争读取按既有有界等待处理；数据读取、解析和保存错误仍上报。损坏数据保留已有有效缓存并禁止覆盖，锁超时与数据错误使用领域前缀报告。

agents.maxConcurrent 限制后台池，maxConcurrentForeground=0 表示前台不限；maxDepth 为包含顶级的会话层数。persistSessions 控制顶级默认持久化；defaultModel 和 types.<规范类型名>.enabled/model/thinking 提供逐字段覆盖。enabled 覆盖 frontmatter 与默认 true，所有新调用共用 catalog 准入。`/subagents types` 按字段定位写入用户或项目配置，保存后立即更新内存与 @类型/workflow 说明；已准入执行及 workflow 固定 child resume 保留契约。写入复用共享 schema 与最新文件内容，无效文件拒绝覆盖。启用状态、模型来源、认证要求和单 agent 操作见 [类型配置](../agents/models.md)。

agents.packageAgents 接受 boolean 或包名/source 数组，默认加载 Pi 已安装包显式声明的类型；false 和空数组关闭。包根由 Pi 的公共包管理器解析，项目包受父级信任约束，声明与资源范围见 [类型与资源](../agents/resources.md)。

agents.mentions 默认 true，控制 TUI 的 @handle 输入投递与补全。统一 bindSession 在资源与 schema 就绪后直接初始化 mentions，首次补全与后续重绑使用同一路径。类型首次提及由仅持有 agent_start 的内存会话克隆生成任务，结果接入共享通知；已有实例复用 Manager.send。关闭开关时保留 Pi 原生文件补全，操作见 [agents 操作](../agents/operations.md)。

agents.scheduling 默认 true，控制顶级 agent_start 的 schedule 参数、主会话计时器与 Scheduled agents 菜单。绑定时按开关更新工具 schema；关闭后使用 /reload，原调度文件保留。时间和生命周期见 [定时调度](../agents/schedules.md)。

agents.workflows 默认 true，控制主会话 agent_workflow 和 Workflows 菜单；配置或默认工具冲突可撤销本工具，显式启用时报告同名冲突。agents.packageWorkflows 使用 boolean 或包名/source 数组控制包 workflow 发现，项目资源受信任约束。工具、运行控制和恢复见 [Workflow 操作](../agents/workflow/operations.md)。共享 wait 与 goal_wait.waitFor 接受 job_、agent_ 和 wf_ ID，结果消费复用公共通知。

## 宿主加载边界

开发依赖使用官方未修改的 Pi 1.5.0，Pi 包的 `pi` bin 与 `./rpc-entry` 分别为 `dist/bundle/cli.js`、`dist/bundle/rpc-entry.js`。官方 bundle loader 通过虚拟模块向扩展提供宿主使用的类定义，SDK 入口按原版模块解析加载；Suite 不修改宿主或另建模块身份适配层。UI 使用公开 Container、ScrollView、VStack/HStack 与 focused overlay，阅读能力见 [统一界面](../ui/index.md#原生会话查看)。子代理启动通过受守卫的私有结构读取父模型运行时，见 [模型运行时桥接](../agents/models.md#模型运行时桥接)。依赖升级后须重启宿主；`/reload` 只重载扩展，不替换已载入的宿主模块。

Responses 的会话持久化、resume 与跨模型消息转换使用官方 Pi 1.5.0 的协议：同 provider/api/model 的文本签名保留 message ID 与 commentary/final_answer phase；跨模型转换按原版规则移除文本签名和不适用的 thinking，再生成请求。可选的 [Responses 历史 ID 恢复](responses-recovery.md) 在最终 payload 隔离失败历史的上游 item ID；默认关闭，主/child 实例独立，不改写源会话或恢复跨模型 phase，不注册净化命令或 API aliases。

`package.json` 保持 `private: true`；`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 的 peer 与开发依赖均精确固定为 `1.5.0`。支持范围为官方未修改的 Pi 1.5.0，实际 Node bin 的 regular/fullscreen 与 RPC 加载入口已通过。加载入口支持不等于消费者安装链路完成验收：Git/本地包及 tarball 安装尚未验收，本包未实际 npm 发布；其他 Pi 版本不在当前支持声明内。

## 加载与首次就绪

仅加载已准入模块的注册栈；agents 所属 job 查询沿用 jobs 模块能力。Tasks 的 commands.ts 只注册命令和非 TUI 文本查询，viewer.ts 在首次交互 `/tasks` 或 Dock 详情打开时导入；Goal 的 showDetails 在实际详情路径导入，控制命令不依赖阅读组件。Jobs/Subagents 查看器在首次打开、Ask 界面在首次询问、Suite 设置页面在首次命令、PTY 后端在首次 PTY 启动、child 执行栈在首次 agent 启动、workflow Worker 在首次编排启动时加载。异步 Tasks 查看入口捕获 SessionBinding，导入、任务读取和返回选择后复查绑定身份及取消信号；Goal 详情在导入后核对其捕获的绑定。失效调用不挂载旧页面、不改变新绑定的 Dock。共享依赖的模块按顺序导入，首次并发执行共享加载 Promise，避免 Pi 的 Jiti 加载器暴露未完成导出。加载失败向原有命令/工具错误边界报告。

首次准入与绑定共享配置快照；每次绑定为 workflow 描述和 mentions 共用一次类型目录快照，关闭 mentions 或非 TUI 时省去该补全的发现工作。类型保存、显式发送刷新、reload 与会话/分支绑定更新快照；所有启用工具、调度、RPC 和首次补全在 session_start 返回前就绪。UI 时钟只读取 Manager 元数据，不扫描历史文件或日志。

历史工具 renderer 在 factory 提前注册。agents/render.ts 与 wait-render.ts 的名称查询只依赖 agents/registry.ts，读取按 agentDir 隔离的同一进程 owner；无 owner 时保留原 ID，不创建 AgentManager/jobs runtime 或扫描磁盘历史。资源路径展开使用 agents/resources/paths.ts，history 与 runner 共用而不为路径查询加载 child resource loader。runtime/tools.ts 统一持有按 ExtensionAPI 隔离的 WeakMap，提前 renderer 注册、只读 lookup 和执行工具注册共享一份显示映射，主会话与 child 的 Ask 显示可分别登记。

## 会话和通知

SessionBinding 为当前主会话保存上下文、会话 ID 和绑定代次。session_start 建立绑定；session_shutdown 保存目标、取消询问、清除本包 UI 并撤销绑定。quit 按当前 agentDir 查询进程全局注册的既有 jobs、agents 与 workflow owner，并等待真实清理结算；模块全部关闭也适用，不依赖当前模块实例，不创建新的 owner。reload 与普通会话切换只重绑，执行 owner 保活。session_tree 在所选分支恢复目标并更换绑定，不向所选分支写入离开分支的目标。旧绑定的排队询问不得在新会话展示。

Notifications 按主会话 ID 保存消息，以请求 ID 合并尚未投递的通知。询问与目标详情占用阻塞令牌；释放后仅在当前宿主 idle 且没有待处理消息、目标允许自动工作时投递合并 follow-up。非当前会话的通知保留到对应会话绑定。agent_before_settle 先计算 Responses 修复提案，再处理 Goal 与通知；completed 边界把合并消息作为一份 custom_message 请求一次继续，并保留前序 entries；已存在宿主继续或待处理消息时保留批次。agent_settled 确认 Goal 最终结果后检查 idle 投递。Pi 1.5.0 的手动压缩与树切换成功事件先于 busy 标记清除，仅在这些事件存在待投递消息时使用受绑定代次限制的短期 idle 检查。界面查看器没有模型调度或进程控制权。

合并通知使用一条 custom_message 的文本块与一一对应的 `details.notificationVersion=1` segments；各片段记录 requestId/source，不重复保存正文。source 区分 Goal 自动续跑与真实事件，job/agent/workflow 的结果、提问和指定更新由 requestId 保留身份。公开 context_with_system 只过滤结构化 Goal 控制片段，混合批次中的事件与一次送达回调保持；无 provenance 的历史不做文本清洗。纯自动续跑控制消息不可见，混合批次通过原生 message renderer 隐去控制片段并保留真实事件；显式 `/goal resume` 使用单独的一行/展开恢复消息。Goal 的请求合同与五轮自动停跑见 [请求与续跑](../goal/context.md)。

WaitRegistry 按 `(id, runId)` 区分 results 中的执行与其他未读结果；等待同一 agent 的新 run 时，旧 run 的未读结算进入 others，以 reason=other 提前返回，仅消费旧结果，新 run 继续保留在 pending。job/workflow 没有 runId 时沿用 ID 语义，monitor/hands-free 进度仍按独立计数消费。已取消的 signal 在 wait 入口立即拒绝；运行中取消也只结束等待，不取消 child 或进程。

[返回当前文档](../index.md)
