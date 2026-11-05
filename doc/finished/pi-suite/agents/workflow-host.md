# 子代理 Workflow 宿主接入阶段

接入 agent_workflow、保存资源、脚本/journal/快照/结果持久化、共享 wait/goal_wait、父级记录与通知、Dock 和 /agents workflows。运行始终后台，源码三选一；child 与 gate 使用公共 AgentManager、JobManager，普通列表与状态不重复显示。宿主按 @tintinweb/pi-subagents 0.23.0 host/saved/collisions 与后台生命周期适配；工具/通知按本包规范编写，存储复用 JsonStore，原生界面按上游展示与控制范围重构，按文件来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

准入捕获父级事实和 owner，reload/new/resume 后的排队与 workflow 后续执行不使用失效 ExtensionContext。child resume 保留会话、类型、模型、thinking、工具/config 和 CompiledSchema；返回值携带有效结构化标志，在 Worker 脚本 realm 内解析。metadata 由运行时单次校验后交给宿主，运行中即可显示名称和阶段。gate 在 cwd 执行、关闭 stdin，短退出与 EOF 使用公共执行生命周期；停止与 quit 等待真实 child/gate 清理和结果保存后结算。

原生查看复用 Text、DetailsView、ScrollView 和值选择，保留阶段、实际模型/thinking、尝试、日志/结果、暂停/恢复/停止、child Transcript、当前或持久 gate 日志、跳过/重试与 journal 重放。阶段标题精确匹配，unphased agent 保留独立分组；返回控制和 child 查看保留阅读与搜索位置。资源仅使用 Pi 公共已安装包根、声明与信任；仅提供资源的包使用标准 `pi.extensions: []` 声明无扩展。

5 项 Linux（Node 24.22.2）真实 SDK/faux 与进程检查通过：后台启动、结构化 child、cwd gate/快速退出/EOF、普通 child/gate 隐藏、共享等待与消费、journal 重放和 SDK child 引用恢复；续接保留 schema/model/type/tools 并通过实际父模型 wait/agent_send 回答问题；reload/new/resume 保持 workflow 与排队 agent owner，quit 等待真实 gate 清理；保存资源优先级、信任、包门控、源码互斥、无效高优先级资源、truncated/损坏 journal 和持久化失败可见，工具撤销/恢复与手动禁用保持、模型使用当前动态类型描述通过；40/60/120 列原生内容、精确阶段/未分组行与暂停返回后的阅读/搜索状态通过。6 项 Worker 核心检查与类型检查通过。

Windows、真实手机 SSH、shell/资源/MCP 组合和类型菜单、回收继续由 [agents 扩展专项](../../../todo/pi-suite/agents/extensions.md) 与 [agents 待办](../../../todo/pi-suite/agents/index.md) 管理。当前实现与操作维护在 [Workflow](../../../current/agents/workflow/index.md)。
