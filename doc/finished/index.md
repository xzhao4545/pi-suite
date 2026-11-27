# 已完成专项

本目录保存已完成专项及阶段性归档记录。形成的稳定实现与规则维护在 [当前文档](../current/index.md)，活跃需求维护在 [待办索引](../todo/index.md)。阶段性归档不代表未验证的条目已通过。

已实施模块的完整设计与原验收契约见 [设计与实施记录](./pi-suite/design/index.md)；平台证据按各专项的实际范围读取，Windows 本轮状态见 [Windows 验收收尾](./pi-suite/windows-completion.md)。

以下 patched 宿主 UI/入口记录保留迁移前开发依赖组合的审计与验收细节，不作为现状或消费者安装证明。U1/T1/M1、净化及三组补丁清理已实施，当前官方未修改 Pi 1.5.0 的加载/运行范围见 [官方 Pi 插件兼容实施](./pi-suite/official-pi-compatibility/index.md)；消费者安装按用户指示 [延期](./pi-suite/official-pi-compatibility/index.md#状态与执行权限)，未实际 npm 发布。

- [工具与通知渲染完善](./pi-suite/ui/render-coverage.md) — 通知按来源折叠、job 屏幕共用渲染、Transcript 使用注册的渲染器、StructuredOutput 与错误折叠、展开只显示 details 字段、workflow 快照回放、Details 着色；全量 260/260 与 typecheck 通过。
- [Agent UX 改进](./pi-suite/agents/agent-ux-improvements.md) — Runs 页恢复已结束的 agent、同一 agent 只占一行、网络或上游错误自动恢复同一 agent、wait 显示等待时长。
- [Goal 暂停与用户轮](./pi-suite/goal/goal-pause.md) — 暂停只停止自动续跑，按暂停原因决定用户消息是否恢复。
- [用户文档首版与审查修正](./pi-suite/user-docs-review.md) — README 与 docs 中英文、MIT 许可，独立模型审查及代码与文档修正。

- [Subagent 与 Workflow 执行 owner 跨加载替换](./pi-suite/agents/execution-owner-reload.md) — 忙时保留执行与控制、空闲替换和持久记录恢复，官方 Pi CLI 启动与同进程 `/reload` 验证。
- [Goal 单一当前状态与缓存友好上下文](./pi-suite/goal/goal-state-context/index.md) — 每会话一份当前状态、tree 分支不回滚、稳定持久说明/控制与自然边界提醒；官方 Pi 1.5.0 SDK/CLI、本地 Responses 完整前缀及存储/绑定链路验证，不追加收费请求。
- [UI 文案、Goal 状态与 Responses 跨资源恢复](./pi-suite/goal/goal-responses-recovery.md) — 三态、恢复展示和跨资源 ID 隔离已实施，保留 Linux 官方 Pi 1.5.0 的验收结果；真实上游密文解密及 Windows 新交互未验证。
- [源码入口启动性能优化](./pi-suite/interaction-improvements/source-startup-performance.md) — 按需加载实现与测量结果阶段性归档；冷首次 Tasks 命令等待增加，性能验收未达成，剩余复测暂缓。

- [Goal 上下文与自动续跑优化](./pi-suite/goal/context-optimization.md) — 请求级权威合同、短唤醒与分段来源、有界控制投影；五个自动轮无工具/相同活动停跑、持久原因与显式恢复，官方 Pi 1.5.0 SDK/CLI 与代表性 Provider 序列化验证。

- [PTY 底部快捷键提示](./pi-suite/ui/pty-shortcut-footer.md) — 直接接管共享阅读窗口、退出优先的两行提示与独立反馈预算；官方 CLI 普通／全屏三宽度、原生焦点恢复、命令区离开及隔离 tmux 嵌套输入／离开通过，复杂子程序退出另留待办。

- [命令结构高亮与语法配色优化](./pi-suite/ui/command-highlighting.md) — 共享 code/command 模式、Bash／PowerShell 词法区间与原生角色配色；历史／child、官方 CLI 三宽度、主题／配置 reload 验证及全量 226/226 通过，用户确认实际预览配色。用户消息亮灰背景／纯白文字与 tmux 安全默认离开键同步。

- [交互与生命周期细化](./pi-suite/interaction-refinement/index.md) — 七项实施与逐项审计：Ask 24 码点短题与仅删除 context、Goal 非 active 结案/stop 与 quit/冷恢复、Tasks 原子清空与 generation、Subagents 连续交接与动态信息高度；官方 CLI 逐帧、真实 SIGKILL 冷恢复和 RPC 过期引用验收通过，完整套件 222/222、typecheck 通过。

- [官方 Pi 插件兼容实施](./pi-suite/official-pi-compatibility/index.md) — 公开组件键盘阅读、持久 fork 首头只读与内存独立提示、统一私有 parentModelRuntime、原版 Responses 行为及三组补丁清理；三个 Pi peer/dev 精确 1.5.0、private:true 保持；stock U1 18/18、T1 16/16、全量 215/215 与 typecheck、官方原有 bin/RPC 三项及新增真实 CLI Dock/搜索/合法 child 中文 Editor 补验通过，实施与文档已提交；消费者安装按指示延期。

- [Patched Node 宿主入口验收](./pi-suite/ui/cli-host-entry.md) — 定制开发依赖的 CLI bin、RPC 与 SDK 共用实际 patched 模块，真实 PTY/xterm 页面、原生工具点击及返回/resize 通过；历史全量 220/220 不作为官方兼容证据。
- [工具外观、任务 Dock 与原生会话阅读接入](./pi-suite/ui/ui-native-integration/index.md) — 六项已实现已验证：Pi 原生工具外壳、任务恢复基线与等宽选中、首开末尾定位、偏移后工具点击及原生滚动条；真实 TuiAltScreen/SDK 与 Jobs、PTY、Ask History、workflow 共享消费者通过，failed/stopped 阅读为终态夹具，非实体失败流程验收。
- [Subagent 全屏、Dock 默认展开与文本精简](./pi-suite/ui/viewer-and-dock-polish/index.md) — 三项已实现已验证：真实 TuiAltScreen/TuiMainScreen 与 xterm ANSI 输出下 100% height、子页间隙 footer 覆盖及退出/构造失败恢复；未选优先 Tasks、选中源优先、无 Tasks 沿 priority；去除冗余 readonly，保留权限、完整错误与原文。未进行实体人工终端或 Windows 验收。
- [执行界面与查看器优化](./pi-suite/ui/execution-ui/index.md) — 八项需求完整实施：名称/状态/选择、统一执行外框与命令配置、Jobs 直接查看/逐流阅读/终态快照、Subagents 底部信息/原生 Editor、显式整链退出；Linux 实际 Pi CLI 16 组合与深度验收。
- [导航焦点、Dock 只读任务与问题标题](./pi-suite/ui/navigation-details.md) — 活动区域高亮、分区切换与双向折叠、英文提示、模型筛选及 Ask 短标题；SDK/组件验证。
- [浏览界面可发现性与配色](./pi-suite/ui/browser-discoverability.md) — 默认 All、最近活动排序、固定导航/动作行与共享配色角色；实际 CLI 两尺寸验收。
- [Subagent 内联消息与持续跟随](./pi-suite/ui/agent-viewer-input.md) — Transcript/Runs 内输入、底部持续跟随和当前 run 发送边界。
- [Subagent 会话目录与可选参数根因](./pi-suite/agents/child-sessions-and-arguments.md) — child 会话存入 subagents/、持久引用发现和 provider strict 配置核实。
- [Oh My Pi 参考主题](./pi-suite/ui/oh-my-pi-theme.md) — Titanium 蓝灰/电蓝配色、Pi 原生 56 色角色、包主题加载与正文/次要文字面板对比度。
- [底部布局：Dock、询问与输入区](./pi-suite/ui/dock-ask-layout.md) — 半屏 Dock 分区、独立询问高度、任务顺序与裁剪、展开与全文、多行鼠标映射；Linux 实际 Pi CLI 十二尺寸与紧凑布局验收。
- [Tasks 两级编号与紧凑反馈](./pi-suite/tasks-display.md) — version 3/依赖迁移、统一任务行与完成样式、询问父子两行、默认 All 与工具一行摘要；Linux 三尺寸实际 Pi CLI 验收。
- [公共工具显示精简](./pi-suite/tool-display.md) — 所有 Suite 工具共用状态行、折叠/展开、敏感输入隐藏与完整错误，Ask History/child Transcript 接入；Linux 三尺寸实际 Pi CLI 验收。
- [Ask 空闲计时与交互](./pi-suite/ask/interaction.md) — 默认 10 分钟空闲、草稿/推荐/首项自动答案、题型标记、循环页签与 Review、Esc 跳过时模型继续；Linux 三尺寸实际 Pi CLI PTY 验收。
- [删除 job 启动确认](./pi-suite/jobs/launch-confirmation.md) — 普通命令、CLI 预设、monitor 与 detector 直接执行，严格配置与设置入口同步；Linux 实际 Pi CLI PTY 验收。
- [Tasks 交互与 Goal 实时计时](./pi-suite/tasks-goal-interaction.md) — 8 项需求、统一任务显示/浏览器、原子短操作与状态同步、原生 Esc 和 resume 交错、有效运行时间。
- [模型工具参数与精简返回](./pi-suite/tool-protocol/index.md) — list/get 查询拆分、字节预算、关键结果/问题/清理保留、全文读取与固定 schema 开销比较。
- [交互、命令与启动优化](./pi-suite/interaction-improvements/index.md) — /subagents、可筛选详情列表、Types 模型/思考强度、/suite 编辑、/exit 原生清理与真实加载性能，以及 tmux 原生通道与用户本机粘贴验收。
- [扩展包架构与发布](./pi-suite/architecture.md) — 单包入口、真实会话目录模块准入、共享绑定/通知/配置、来源登记与既有 owner 退出清理。
- [统一工具设计规范](./pi-suite/tool-design.md) — 命名、公共参数/schema、返回类型、读取/等待/停止与稳定模型工具错误。
- [Ask 自由回复与部分答案](./pi-suite/ask/freeform.md) — 所有题型文字入口、显式编辑与切题、跳过保留部分答案；Linux 实际 CLI 验收。
- [ask 默认答案与预选项](./pi-suite/ask/default-answers.md) — 默认初始化、参数冲突和明确提交。
- [ask 批量提问、多选与推荐](./pi-suite/ask/batch-selection.md) — 独立题型、稳定选项 ID 和整批确认。
- [询问与后台通知协调阶段](./pi-suite/ask/coordination.md) — 原生问答三种结算、两个 child 父级问题、真实 job 暂存与 goal 一次合并恢复；Linux SDK 验收。
- [Windows 原生询问、界面与通知组合](./pi-suite/ask/windows-combination.md) — 三尺寸与最低回答行、鼠标/焦点/草稿、回答/超时/取消、两个 child 问题及真实 job 一次合并恢复。
- [统一 Dock 与任务显示协调阶段](./pi-suite/ui-coordination.md) — 必要 agent/job 详情、父子预算、选中/阻塞任务和询问压缩摘要；Linux SDK/组件验收。
- [完整 Starship footer 联动阶段](./pi-suite/footer-integration.md) — 实际发布入口、真实模块并存、三尺寸、数量槽位、缺失模块与显式 Dock 显示；Linux SDK 验收。
- [状态栏图标与 simple 布局](./pi-suite/ui/icons/index.md) — goal 动态图标、子代理/job 数量、Git 方向箭头与命名配置独立应用；Linux SDK 与 pi-starship 0.66.0 渲染验收。
- [Subagents 统一浏览布局](./pi-suite/ui/subagents/index.md) — 顶部导航、状态/范围筛选、纯记录列表、Types 详情与共享操作栏；Linux SDK 三尺寸及运行控制验收。
- [目标生命周期与状态摘要基础阶段](./pi-suite/goal-core.md) — 宿主恢复、用户控制、预算、分支归属与状态发布。
- [PTY hands-free 与 dispatch 基础阶段](./pi-suite/jobs/hands-free-core.md) — 增量预算、静默终止、用户接管、共享等待与 reload 后目标唤醒；Linux 离线验收。
- [CLI 预设与启动授权基础阶段](./pi-suite/jobs/cli-launch-core.md) — 内置/自定义预设、Pi fork 参数、字面量 prompt、用户级 launchPolicy 与共享 ask；Linux 离线验收。
- [实际 Pi CLI 与终端接管阶段](./pi-suite/jobs/pi-cli.md) — 真实离线 Pi fork、复杂 prompt、公共 PTY 接管/交还/离开及上游 @ 边界。
- [Pi 原文初始任务与生命周期阶段](./pi-suite/jobs/literal-prompt.md) — 原生 flag/input 桥保留前导 @ 和附件、默认 pipe EOF、fork 新身份、reload/new 不重放与自然 quit；Linux CLI 验收。
- [实际 Pi CLI 终端缩放与重新接管阶段](./pi-suite/jobs/terminal-resize.md) — 实际 /jobs attach、内核尺寸和 SIGWINCH、接管/交还、关闭后继续及重新 attach；Linux CLI 验收。
- [Windows 运行时与实际 CLI 阶段](./pi-suite/jobs/windows-runtime.md) — 常驻 CIM、ConPTY 密码隐藏、OSC 轮次、共享存储竞争、Pi 缩放/模型/调度/RPC/workflow，以及实际 Codex/Claude 工具执行与清理；平台剩余范围保留待办。
- [Windows CLI 文本 PTY 与原生 footer 阶段](./pi-suite/jobs/windows-cli-ui.md) — 实际 Codex/Claude 主对话输入接管与停止、Pi reload/new 生命周期、Starship/Pi 原生 footer 三尺寸与用户配置边界；未覆盖的操作组合保留待办。
- [Windows Pi CLI 预设契约](./pi-suite/jobs/windows-pi-presets.md) — 默认 pipe、print/JSON、参数边界、普通正文和附件、CLI fork 新身份与源文件保持。
- [Windows 终端监督、输出与启动策略](./pi-suite/jobs/windows-supervision-output.md) — 三种 monitor、hands-free/dispatch、原生允许/拒绝/取消、大日志/UTF-8/搜索、密码隐藏与当前/最后屏幕及历史边界。
- [Windows 上游问题与当前实现证据](./pi-suite/windows-baseline.md) — 固定版本上游静态结论与当前真实 SDK/进程/CLI 的逐项证据和适用范围。
- [Windows 验收收尾](./pi-suite/windows-completion.md) — 本轮验收证据索引与范围，Cursor CLI 验收按用户要求移除。
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
- [Windows 模型与 @handle 原生入口](./pi-suite/agents/windows-models.md) — 运行中下一请求修改、持久恢复、类型与文件补全、会话切换、配置来源与认证目录错误。
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
- [Windows 原生 CLI 跨扩展 RPC](./pi-suite/agents/windows-rpc.md) — 独立 consumer 五通道、cwd/trust/结构化与清理，真实 pi-tasks 业务启动/结果/停止及两种加载次序与 reload。
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
- [模型工具上下文精简](./pi-suite/tool-protocol/context-budget.md) — ask_user 文本结果只含状态与回答、agent_workflow 约 1 KB 短描述与 pi-suite-workflow skill；Linux 类型检查与全量测试通过。
- [浏览界面交互重构](./pi-suite/ui/browser-interaction.md) — 页面标签、控件热键、list/details/filter 三态焦点、按键动作与状态行，Types 未配置显示；/subagents、/tasks、/jobs 统一。
- [Subagent 快捷进入与全屏查看](./pi-suite/ui/agent-viewer.md) — 空提示符 ← 进入 Dock 选择，阅读视图全屏 overlay，capturesViewportInput 接管 PgUp/PgDn。
- [Subagent 名称显示与 Dock Agents 分区](./pi-suite/ui/agent-display-names.md) — 工具与 wait 显示名称优先，Dock 行显示状态、时间、token 与工具次数，标题右侧显示数量。
- [Subagent 任务清单隔离](./pi-suite/tasks/child-task-scope.md) — child 会话私有目标、scope:assigned 受限进度、同名 ID 显式分流、嵌套与稳定会话恢复；Linux 相关 SDK/任务测试及类型检查通过。
- [子代理共享任务清单与执行恢复集成](./pi-suite/tasks/agents-integration.md) — 多 child 并发、reload/fork 清单边界、回收后稳定执行引用与实际任务状态；Linux SDK 验收。
- [Windows 原生两级任务与并发 child](./pi-suite/tasks/windows-combination.md) — 三尺寸详情、折叠/筛选/blocked、并发更新、owner reload/fork 与回收后恢复。
