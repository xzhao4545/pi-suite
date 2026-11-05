# 公共运行时与配置

唯一扩展入口为 src/index.ts；工具、命令和宿主事件由入口与对应模块注册。当前工具为 ask_user、goal_complete、goal_blocked、goal_wait、task_list、task_edit、job_start、job_list、job_read、job_write、job_stop、agent_start、agent_list、agent_read、agent_send、agent_stop、agent_workflow 和共享 wait，命令为 /goal、/tasks、/jobs、/agents、/suite。

runtime/tools.ts 的 registerBoundTool 共用 Pi 公开工具注册，刷新描述/schema 时保留当前 active-tool 选择；首次晚注册只按该入口的启用规则加入本工具。agent_start 调度 schema 与 workflow 动态类型描述复用此入口。

## 配置

配置按内置默认、用户文件 `<getAgentDir()>/pi-suite.json`、项目 `.pi/pi-suite.json` 的顺序覆盖，各节逐字段合并。getAgentDir() 遵循 Pi 的 PI_CODING_AGENT_DIR。缺失文件表示无覆盖；无效 JSON、未知字段、数值范围错误及读取失败会报告错误。

```json
{
  "modules": { "ask": true },
  "ui": { "maxRows": 6 },
  "ask": { "timeout": 120000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "tasks": { "reminders": true },
  "agents": { "display": "status", "maxConcurrent": 10, "maxConcurrentForeground": 0, "maxDepth": 3, "persistSessions": true, "workflows": true, "types": {} },
  "jobs": { "display": "status", "detachKey": "ctrl+b", "returnKey": "ctrl+g", "transferKey": "ctrl+t" }
}
```

modules.ask、modules.goal、modules.tasks、modules.jobs 与 modules.agents 在扩展加载时决定是否注册对应模块；改变开关后使用 /reload。会话绑定时重新读取配置。maxRows 范围为 1–6；timeout 为 0–2147483647 的整数毫秒，0 不设期限。historyKey 与 jobs 终端视图的 detachKey（离开视图）、returnKey（交还模型）、transferKey（发送屏幕）使用 Pi 的按键标识。公共显示配置接受 status/dock/hidden，不接管 footer。tasks.reminders 控制临时任务提醒，默认 true；任务摘要共用 Dock，见 [任务操作](../tasks/operations.md)。

jobs.agents 配置 CLI 键对应的 command 与 args，按键和字段合并用户/项目覆盖。jobs.launchPolicy 为 `{command, decision}` 数组，仅用户文件可设置，project 文件出现该字段时报错；精确命令未匹配时默认询问，即使未设置规则也如此。规则与操作见 [CLI 预设与启动授权](../jobs/launch.md)。启动授权复用内部 AskManager，不受 modules.ask 是否注册 ask_user 工具影响。

runtime/text.ts 提供安全字面量文本转换，供任务说明、pipe 日志与 monitor 事件共用；终端回车覆写等 PTY 语义由 jobs 的终端模块处理。

runtime/json-store.ts 为 TaskStore、ScheduleStore 与 WorkflowStore 提供按目标串行入口、异步 pid:uuid 文件锁、锁内重读、复制后修改、原子保存和快照；领域 schema 与修改规则由具体 Store 定义。损坏数据保留已有有效缓存并禁止覆盖，锁超时与数据错误使用领域前缀报告。

agents.maxConcurrent 限制后台池，maxConcurrentForeground=0 表示前台不限；maxDepth 为包含顶级的会话层数。persistSessions 控制顶级默认持久化；defaultModel 和 types.<规范类型名>.enabled/model/thinking 提供逐字段覆盖。enabled 覆盖 frontmatter 与默认 true，所有新调用共用 catalog 准入。`/agents types` 按字段定位写入用户或项目配置，保存后立即更新内存与 @类型/workflow 说明；已准入执行及 workflow 固定 child resume 保留契约。写入复用共享 schema 与最新文件内容，无效文件拒绝覆盖。启用状态、模型来源、认证要求和单 agent 操作见 [类型配置](../agents/models.md)。

agents.packageAgents 接受 boolean 或包名/source 数组，默认加载 Pi 已安装包显式声明的类型；false 和空数组关闭。包根由 Pi 的公共包管理器解析，项目包受父级信任约束，声明与资源范围见 [类型与资源](../agents/resources.md)。

agents.mentions 默认 true，控制 TUI 的 @handle 输入投递与补全。类型首次提及由仅持有 agent_start 的内存会话克隆生成任务，结果接入共享通知；已有实例复用 Manager.send。关闭开关时保留 Pi 原生文件补全，操作见 [agents 操作](../agents/operations.md)。

agents.scheduling 默认 true，控制顶级 agent_start 的 schedule 参数、主会话计时器与 Scheduled agents 菜单。绑定时按开关更新工具 schema；关闭后使用 /reload，原调度文件保留。时间和生命周期见 [定时调度](../agents/schedules.md)。

agents.workflows 默认 true，控制主会话 agent_workflow 和 Workflows 菜单；配置或默认工具冲突可撤销本工具，显式启用时报告同名冲突。agents.packageWorkflows 使用 boolean 或包名/source 数组控制包 workflow 发现，项目资源受信任约束。工具、运行控制和恢复见 [Workflow 操作](../agents/workflow/operations.md)。共享 wait 与 goal_wait.waitFor 接受 job_、agent_ 和 wf_ ID，结果消费复用公共通知。

## 会话和通知

SessionBinding 为当前主会话保存上下文、会话 ID 和绑定代次。session_start 建立绑定；session_shutdown 保存目标、取消询问、清除本包 UI 并撤销绑定。session_tree 在所选分支恢复目标并更换绑定，不向所选分支写入离开分支的目标。旧绑定的排队询问不得在新会话展示。

Notifications 按主会话 ID 保存消息，以请求 ID 合并尚未投递的通知。询问与目标详情占用阻塞令牌；释放后仅在当前宿主 idle 且没有待处理消息、目标允许自动工作时投递合并 follow-up。非当前会话的通知保留到对应会话绑定。agent_before_settle 的 completed 边界把合并消息作为一份 custom_message 请求一次继续；已存在宿主继续或待处理消息时保留批次。agent_settled 检查 idle 投递。Pi 1.5.0 的手动压缩与树切换成功事件先于 busy 标记清除，仅在这些事件存在待投递消息时使用受绑定代次限制的短期 idle 检查。界面查看器没有模型调度或进程控制权。

WaitRegistry 按 `(id, runId)` 区分 results 中的执行与其他未读结果；等待同一 agent 的新 run 时，旧 run 的未读结算进入 others，以 reason=other 提前返回，仅消费旧结果，新 run 继续保留在 pending。job/workflow 没有 runId 时沿用 ID 语义，monitor/hands-free 进度仍按独立计数消费。已取消的 signal 在 wait 入口立即拒绝；运行中取消也只结束等待，不取消 child 或进程。

[返回当前文档](../index.md)
