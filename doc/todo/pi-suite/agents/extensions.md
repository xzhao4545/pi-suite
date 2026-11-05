# agents 扩展能力

目标：保留上游 pi-subagents 的自定义 agent 类型、@handle 提及、定时调度、SubagentWorkflow 和跨扩展 RPC，接入本包统一工具、配置与界面。

当前状态：完整保留 frontmatter、类型与包发现、扩展选择/动态工具范围、技能预加载、memory、父级上下文与会话目录已接入，4 项 Linux SDK 契约检查通过，见 [资源基础阶段](../../../finished/pi-suite/agents/resources-core.md)。@handle 输入、补全与会话克隆启动通过 3 项 Linux 检查，见 [提及基础阶段](../../../finished/pi-suite/agents/mentions-core.md)。定时调度与查看取消已接入，见 [调度基础阶段](../../../finished/pi-suite/agents/schedules-core.md)。RPC 五通道、会话归属与结果消费已接入，见 [RPC 基础阶段](../../../finished/pi-suite/agents/rpc-core.md)。workflow 与类型开关待导入，Windows、真实 MCP 和资源组合继续验收。保留范围已由用户确认，不保留 git worktree 隔离。导入文件与改造边界见 [上游导入](../upstream-import.md)。

影响范围：agents 类型注册、输入拦截、调度存储、workflow worker、pi.events 通道、/agents 菜单、配置 agents 节。

约束：工具名与参数按 [统一工具设计](../tool-design.md)；配置并入共享配置，不保留上游独立设置界面；调度与 workflow 启动的 child 与普通 child 使用同一记录、停止和通知路径。

相关当前文档：[公共运行时与配置](../../../current/runtime/index.md)。

## 任务列表

- [x] 加载自定义 agent 类型，删除 isolation 与 output_transcript 字段
- [x] 实现 @handle 输入拦截与补全，按 agent_send 语义投递
- [x] 实现 agent_start 的 schedule 参数、调度存储与 /agents 调度列表
- [ ] 实现 agent_workflow 及其查看界面，gate 在 cwd 执行
- [x] 注册 subagents:rpc:* 通道并保持协议版本 2
- [ ] /agents 菜单汇总记录、类型开关、按类型的模型与 thinking 配置（见 [模型与 thinking 配置](models.md)）、调度与 workflow，同步操作说明
- [ ] Windows 与实际外部扩展组合复核 RPC 注册、启动/停止/引导/消费、生命周期与目录/结构化结果
- [ ] Windows 与实际 MCP 服务复核资源组合、晚注册与 MCP 桥接、包根/符号链接及类型/技能目录的信任边界
- [ ] Windows 与真实手机 SSH 复核 @handle/文件补全、活动引导、结束恢复、克隆启动与会话切换
- [ ] Windows、实际 CLI 与手机 SSH 复核本地时区的 cron/周期/单次、切换与退出、调度详情和取消

## 验收方式

项目与用户目录的 agent 定义按优先级覆盖，禁用类型不可启动；@名字 消息投递到运行中或已结束的 agent；cron、间隔和单次调度按时启动并在 /new 后不继承；workflow 的 parallel/pipeline、暂停/恢复与 journal 恢复可用，其 child 不出现在普通列表；外部扩展经 RPC 启动、引导、停止和消费结果。各功能的开关关闭时对应工具或参数不注册。

## 关联计划

- [运行记录与手动控制](runs.md)
- [主从交互](interaction.md)
- [上游导入](../upstream-import.md)

## 自定义 agent 类型

类型来自内置默认、已安装 pi 包声明的 agent、用户目录与项目 `.pi/agents/*.md`、工作区 `.agents/agents/`，后者覆盖前者；包提供的类型优先级最低，项目资源受 Pi 的项目信任判断约束。文件名或 frontmatter 的 name 为类型名。

保留的 frontmatter：name、display_name、color、description、tools、disallowed_tools、extensions/exclude_extensions、skills、model、thinking、max_turns、persist_session、session_dir、allowed_subagents、prompt_mode、inherit_context、run_in_background、isolated、memory、enabled。正文为系统提示。frontmatter 优先于工具参数，model 与 thinking 除外：二者按 agent_start 参数、TUI 类型配置、frontmatter 的顺序取值，见 [模型与 thinking 配置](models.md)。allowed_subagents 为空时不注入嵌套工具，maxDepth 默认 3，包含顶级及两层嵌套。

删除 isolation（worktree 隔离不保留）与 output_transcript（不另写 JSONL 副本）。文件中出现这两个字段时报告未支持字段，不静默忽略。

当前加载规则与字段事实见 [类型与资源](../../../current/agents/resources.md)。extensions/skills 使用 Pi 公共加载器，项目资源继承父级信任；包类型仅来自已安装且显式声明的资源，packageAgents 提供包门控。直接与嵌套工具调用使用同一动态范围，前台与 isolated 按 frontmatter 优先规则决定，达到深度上限时不注入不可用的嵌套工具。

## @handle 提及

用户输入 `@名字 消息` 时，消息按 agent_send 语义投递给对应 agent：运行中为引导，已结束为恢复。提及尚无实例的已知类型时，按上游 mention-clone 以当前会话克隆启动该类型。输入框提供活动 agent、最近结束 agent 与类型的补全。该能力只处理用户输入，不注册模型工具。当前实现和开关见 [操作说明](../../../current/agents/operations.md)，Linux 验收见 [提及基础阶段](../../../finished/pi-suite/agents/mentions-core.md)。

## 定时调度

agent_start 的 schedule 接受 cron 表达式、`+10m`/`5m` 间隔或 ISO 单次时间；带 schedule 时登记调度并立即返回，不能与 background:false、inheritContext 同用。调度按主会话保存在本包目录，/new 不继承；触发时重新解析类型与模型，绕过队列启动并走普通后台完成通知。/agents 的调度列表可查看和取消。由 agents.scheduling 配置开关，关闭时 schedule 参数不出现在工具 schema。当前时间、存储、准入、通知与操作见 [定时调度](../../../current/agents/schedules.md)。

## agent_workflow

在 worker 线程运行编排脚本，脚本只能通过宿主调用启动 agent，支持 parallel/pipeline、阶段、结构化输出、gate 命令、暂停/恢复/跳过/重试和按 journal 恢复未改变的前序调用。保留上游上限：单次运行 agent 1000、条目 4096、嵌套 256、脚本 512 KiB、并发 max(1, min(16, CPU-2))。

参数：script、scriptPath 或已保存的 name 三选一，args?、resumeFromRunId?。始终后台运行并返回 workflow 运行 ID；完成走统一通知。workflow 内的 child 带 workflowId，不出现在普通 agents 列表与状态计数，由 workflow 详情查看。gate 命令在 cwd 执行，默认期限 10 分钟。工具描述保留上游的使用前提：用户明确要求编排、调用要求编排的技能或指定已保存 workflow。由 agents.workflows 配置开关。

## 跨扩展 RPC

在 pi.events 上保留 subagents:rpc:ping/spawn/stop/consume/steer 五个通道、`{ success, data | error }` 信封和协议版本 2，供外部扩展调用；通道在第一次绑定的 session_start 注册，会话关闭时撤销。只对顶层 agent 生效，workflow 与嵌套 child 拒绝外部停止和引导。生命周期事件 subagents:created/started/completed/failed 等继续发出。当前协议、参数边界、cwd 信任与结构化结果见 [跨扩展 RPC](../../../current/agents/rpc.md)，Linux 验收见 [RPC 基础阶段](../../../finished/pi-suite/agents/rpc-core.md)。

[返回 agents 待办](index.md)
