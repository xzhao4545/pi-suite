# 已完成专项

本目录保存已完成专项记录。形成的稳定实现与规则维护在 [当前文档](../current/index.md)，未完成需求维护在 [待办索引](../todo/index.md)。

已实施模块的完整设计与原验收契约见 [设计与实施记录](./pi-suite/design/index.md)；这些记录归档不表示剩余平台验收已通过，活跃 Windows 项统一见 [Windows 待办](../todo/pi-suite/index.md)。

- [扩展包架构与发布](./pi-suite/architecture.md) — 单包入口、真实会话目录模块准入、共享绑定/通知/配置、来源登记与既有 owner 退出清理。
- [统一工具设计规范](./pi-suite/tool-design.md) — 命名、公共参数/schema、返回类型、读取/等待/停止与稳定模型工具错误。
- [ask 默认答案与预选项](./pi-suite/ask/default-answers.md) — 默认初始化、参数冲突和明确提交。
- [ask 批量提问、多选与推荐](./pi-suite/ask/batch-selection.md) — 独立题型、稳定选项 ID 和整批确认。
- [询问与后台通知协调阶段](./pi-suite/ask/coordination.md) — 原生问答三种结算、两个 child 父级问题、真实 job 暂存与 goal 一次合并恢复；Linux SDK 验收。
- [Windows 原生询问、界面与通知组合](./pi-suite/ask/windows-combination.md) — 三尺寸与最低回答行、鼠标/焦点/草稿、回答/超时/取消、两个 child 问题及真实 job 一次合并恢复。
- [统一 Dock 与任务显示协调阶段](./pi-suite/ui-coordination.md) — 必要 agent/job 详情、父子预算、选中/阻塞任务和询问压缩摘要；Linux SDK/组件验收。
- [完整 Starship footer 联动阶段](./pi-suite/footer-integration.md) — 实际发布入口、真实模块并存、三尺寸、数量槽位、缺失模块与显式 Dock 显示；Linux SDK 验收。
- [目标生命周期与状态摘要基础阶段](./pi-suite/goal-core.md) — 宿主恢复、用户控制、预算、分支归属与状态发布。
- [PTY hands-free 与 dispatch 基础阶段](./pi-suite/jobs/hands-free-core.md) — 增量预算、静默终止、用户接管、共享等待与 reload 后目标唤醒；Linux 离线验收。
- [CLI 预设与启动授权基础阶段](./pi-suite/jobs/cli-launch-core.md) — 内置/自定义预设、Pi fork 参数、字面量 prompt、用户级 launchPolicy 与共享 ask；Linux 离线验收。
- [实际 Pi CLI 与终端接管阶段](./pi-suite/jobs/pi-cli.md) — 真实离线 Pi fork、复杂 prompt、公共 PTY 接管/交还/离开及上游 @ 边界。
- [Pi 原文初始任务与生命周期阶段](./pi-suite/jobs/literal-prompt.md) — 原生 flag/input 桥保留前导 @ 和附件、默认 pipe EOF、fork 新身份、reload/new 不重放与自然 quit；Linux CLI 验收。
- [实际 Pi CLI 终端缩放与重新接管阶段](./pi-suite/jobs/terminal-resize.md) — 实际 /jobs attach、内核尺寸和 SIGWINCH、接管/交还、关闭后继续及重新 attach；Linux CLI 验收。
- [Windows 运行时与实际 CLI 阶段](./pi-suite/jobs/windows-runtime.md) — 常驻 CIM、ConPTY 密码隐藏、OSC 轮次、共享存储竞争、Pi 缩放/模型/调度/RPC/workflow，以及实际 Codex/Claude 工具执行与清理；平台剩余范围保留待办。
- [Windows CLI 文本 PTY 与原生 footer 阶段](./pi-suite/jobs/windows-cli-ui.md) — 实际 Codex/Claude 主对话输入接管与停止、Pi reload/new 生命周期、Starship/Pi 原生 footer 三尺寸与用户配置边界；未覆盖的操作组合保留待办。
- [Windows Pi CLI 预设契约](./pi-suite/jobs/windows-pi-presets.md) — 默认 pipe、print/JSON、参数边界、普通正文和附件、CLI fork 新身份与源文件保持。
- [实际 Codex/Claude 文本 PTY 阶段](./pi-suite/jobs/cli-pty.md) — Linux 真实 CLI、本地主对话 SSE、复杂 prompt、用户接管/交还和确认停止；工具执行见后续阶段，平台组合保留待办。
- [实际 CLI 工具执行与 Linux 后代清理阶段](./pi-suite/jobs/cli-tools.md) — Codex exec_command、Claude Bash/Read，独立工具进程组的身份捕获与真实停止；Linux 受控验收。
- [jobs 技能发布阶段](./pi-suite/jobs/skill.md) — 包声明、实际 Pi 资源发现/加载、原生调用与模块关闭行为。
- [输出读取与真实 PTY 组合阶段](./pi-suite/jobs/output-core.md) — 预算、原始范围与续读提示，密码回显隐藏、横向重绘、全屏提示及同条完成预览；Linux 验收。
- [PTY 线性输出与屏幕支持范围](./pi-suite/jobs/screen-range.md) — 横向物理行、垂直/全屏日志片段、同 owner 当前/最后屏幕与重启历史边界；Linux 真实 PTY 验证。
- [超长逻辑行读取与正则资源边界](./pi-suite/jobs/long-line.md) — 一次合并、完整匹配、有限上下文、100 MiB 单行与明确的 V8 资源失败；Linux 验证。
- [日志实时查看与历史分页基础阶段](./pi-suite/jobs/log-viewer-core.md) — 有界字节窗口、底部跟随、搜索位置保留、最终输出与列表游标；Linux 离线验收。
- [同进程升级控制基础阶段](./pi-suite/jobs/runtime-control-core.md) — 独立版本控制桥、受限查询与停止、quit、空闲替换与自然退出竞争；Linux 离线验收。
- [同一 Pi 进程内保活](./pi-suite/jobs/session-lifecycle.md) — 两平台真实 SDK/进程验证会话重绑、受限控制桥、空闲替换与升级期间 quit 清理。
- [Pi 退出清理与保活范围决策](./pi-suite/jobs/exit-scope.md) — Pi 退出终止原任务与 PTY，仅保留同进程内保活，不实施跨进程 supervisor。
- [job 历史主动清理阶段](./pi-suite/jobs/history-clear.md) — 原生确认、终态磁盘复核、写入队列、通知撤销和只读边界；Linux SDK/进程验收。
- [子代理执行与交互基础阶段](./pi-suite/agents/core.md) — 同进程会话、两池队列、父级提问、持久 run 记录、任务共享与 job 清理；Linux 离线验收。
- [子代理模型配置基础阶段](./pi-suite/agents/models-core.md) — 类型逐字段写回、单 agent 下一请求切换与持久恢复、原生选择与阅读状态；Linux 离线验收。
- [类型模型配置与启动入口组合阶段](./pi-suite/agents/models-entrypoints.md) — 调度、workflow 与 @handle 的实际模型请求、参数来源、固定续接及回收后恢复；Linux SDK 验收。
- [子代理类型与资源基础阶段](./pi-suite/agents/resources-core.md) — 扩展动态工具范围、技能、包声明与信任、memory、父级上下文与会话目录；Linux 离线验收。
- [真实 MCP 传输与资源组合阶段](./pi-suite/agents/mcp-transport.md) — 原生 stdio 发现、资源显式选择、桥接与晚注册、信任和进程清理；Linux 受控服务验收。
- [Windows Context7 MCP 与资源边界](./pi-suite/agents/windows-context7.md) — 官方外部服务真实查询、直接/桥接/晚注册、禁用与隔离、服务进程退出；通用资源边界由组件检查覆盖。
- [子代理 @handle 基础阶段](./pi-suite/agents/mentions-core.md) — 持久 handle/alias、原生补全、会话克隆启动与普通发送/恢复、取消和前台通知；Linux 离线验收。
- [子代理定时调度基础阶段](./pi-suite/agents/schedules-core.md) — cron/周期/单次、会话存储、普通运行与通知、工具开关和查看取消；Linux 离线验收。
- [调度期限与本地时区组合阶段](./pi-suite/agents/schedule-timezone.md) — 同一 UTC 期限、跨时区恢复、日历夏令时、固定周期与错过周期相位；Linux SDK 验收。
- [实际 Pi CLI 调度与退出组合阶段](./pi-suite/agents/schedules-cli.md) — 三种真实触发、原生详情和取消、reload/new/resume 及 quit 的 child/job 清理；Linux CLI 验收。
- [Windows 原生 CLI 调度组合](./pi-suite/agents/windows-schedules.md) — 本地 UTC+08:00、cron/interval/once、详情确认、会话恢复、过期与错过周期、退出清理。
- [子代理 RPC 基础阶段](./pi-suite/agents/rpc-core.md) — 五通道与版本 2、启动与归属、同步消费和公共通知、cwd 与结构化结果；Linux 离线验收。
- [实际 Pi CLI 独立扩展 RPC 组合阶段](./pi-suite/agents/rpc-cli.md) — 独立 consumer、两种加载次序、reload、目标目录信任、结构化结果与真实清理；Linux CLI 验收。
- [子代理 Workflow 编排核心阶段](./pi-suite/agents/workflow-core.md) — 上游 Worker、流水线、嵌套共享并发、控制与预算、journal 前缀恢复；Linux 离线验收。
- [子代理 Workflow 宿主接入阶段](./pi-suite/agents/workflow-host.md) — 保存资源、共享执行/存储/等待/通知、固定 child 续接与原生控制；Linux SDK/进程验收。
- [子代理类型开关与执行引用回收阶段](./pi-suite/agents/types-retention.md) — 统一 enabled 准入、原生类型菜单、完整历史与通知/reader/workflow 引用保留。
- [子代理原生会话查看与快捷控制](./pi-suite/agents/viewer-controls.md) — toolCallId 流式配对与组件缓存、消息输入、两次停止、真实前台转后台和阅读状态；Linux 离线验收。
- [Windows workflow 与 child 原生查看](./pi-suite/agents/windows-workflow-viewer.md) — 动态详情动作、暂停/重试/跳过/重放、流式阅读、前台转后台、停止清理与所属 Jobs 只读入口。
- [工作区持久历史发现与只读查询阶段](./pi-suite/agents/history-discovery.md) — Pi 默认/配置目录与持久引用、完整分支、文件缓存、记录合并和原生只读边界；Linux 离线验收。
- [Windows 持久历史与主从交互](./pi-suite/agents/windows-history.md) — 默认/自定义 junction、fork/workflow 引用、分页与只读、嵌套提问、同步停止、级联 job 清理与 run 通知消费。
- [子代理停止竞争与主从交互生命周期阶段](./pi-suite/agents/lifecycle.md) — 同范围重入、排队取消、清理期间恢复准入、直接 child 最终结算和 run 级通知；Linux SDK/进程验收。
- [子代理运行记录与手动控制](./pi-suite/agents/runs.md) — 完整 run 历史、真实级联停止、所属活动 jobs、日志与单独控制；Linux SDK/进程和原生界面验收。
- [主 agent 与 subagent 交互](./pi-suite/agents/interaction.md) — 父级提问、共享等待、完整进度、并发工具参数摘要、用量/错误通知与 run 级消费；Linux SDK 验收。
- [两级任务基础阶段](./pi-suite/tasks/core.md) — 原子批量编辑、派生进度、统一存储、会话与提醒、共享详情和 job 引用；Linux 离线验收。
- [子代理共享任务清单与执行恢复集成](./pi-suite/tasks/agents-integration.md) — 多 child 并发、reload/fork 清单边界、回收后稳定执行引用与实际任务状态；Linux SDK 验收。
- [Windows 原生两级任务与并发 child](./pi-suite/tasks/windows-combination.md) — 三尺寸详情、折叠/筛选/blocked、并发更新、owner reload/fork 与回收后恢复。
