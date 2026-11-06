# 子代理原生会话查看

目标：保留执行能力，使用 Pi 消息组件渲染子代理会话。

当前状态：共享原生 Transcript、独立详情、thinking/工具折叠、流式消息和部分结果、底部跟随及历史叶子已接入；消息输入、两次停止与真实前台转后台接入统一 DetailsView，组件身份更新和流式/窄屏离线验收通过。[Windows 原生阶段](windows-workflow-viewer.md) 补充实际 CLI 的流式阅读、输入往返、前台转后台、停止、所属 Jobs 与只读入口。

查看、消息输入与模型选择往返期间使用 Manager 的 run retain 引用阻止 Execution 回收，最终退出后释放；非持久 transcript 的回收边界与完整记录保留见 [类型与回收阶段](types-retention.md)。

workflow 详情使用相同原生详情、阅读与值选择框架；child Transcript、gate 日志、暂停/恢复/停止、跳过/重试和 journal 重放的接入见 [宿主接入阶段](workflow-host.md)，实际 CLI 操作与 gate 清理见 [Windows 原生阶段](windows-workflow-viewer.md)。

影响范围：child session、消息组件、工具渲染、流式更新、运行/历史查看、手动停止与常驻摘要。

约束：查看不实际切换主会话；工具使用 child 的渲染定义，历史阅读位置稳定。

相关当前文档：[项目当前状态](../../../current/index.md)、[统一界面](../../../current/ui/index.md)。

## 任务列表

- [x] 复用 user/assistant/tool execution 消息组件
- [x] 按 toolCallId 关联调用、流式结果和最终结果
- [x] 实现独立查看视图、折叠和底部跟随
- [x] 缓存消息组件，活动数量注册为状态，常驻详情行交给统一 dock
- [x] 保留已结束 subagent 结果和会话引用，接入手动停止入口

## 验收方式

核对 Markdown、代码块、thinking、工具结果和实时输出；已结束记录同样可查看，查看不影响主运行或触发生命周期切换。手动停止只按选定 child 执行范围取消，历史记录保留。

Linux（Node 24.22.2）新增 4 项检查覆盖真实前台转后台的调用释放、收费池转移、父级后续取消与结果通知，以及 workflow 问题回答、两次停止/搜索隔离、阅读状态、实际 child.cwd、中间并发部分结果与 assistant 更新、旧 run 延迟输入拒绝。扩展既有 Transcript 聚合检查，验证 toolCallId 配对、partial/final 更新、稳定组件和 40/60/120 列缓存/位置。类型检查与 129 项全量检查通过，全量耗时 12.77 秒；既有模型选择取消、持久历史叶子与状态契约同时通过。Windows 原生输入与所属 Jobs 组合见 [Windows 原生阶段](windows-workflow-viewer.md)。

## 关联计划

- [统一界面](../design/ui.md)
- [任务引用](../design/tasks.md)
- [统一框架边界](../architecture.md)
- [子代理运行记录与手动控制](runs.md)
- [主从交互](interaction.md)
- [活动数量状态](../design/status.md)

## 8. agents：复用主 agent 的消息渲染

保留上游 subagent 执行和会话记录能力，替换查看器的文本提取路径。

- user/assistant 使用 Pi 导出的 UserMessageComponent、AssistantMessageComponent。
- 按 toolCallId 关联工具调用、参数、流式结果和最终结果，使用 ToolExecutionComponent。
- 工具渲染应使用该 child session 的渲染定义；缺少定义时使用标准回退，不能拿主 agent 的同名工具定义假定完全相同。
- 保留 Markdown、代码高亮、thinking 展开策略、工具折叠和错误样式；支持当前流式消息更新。
- 查看历史时固定当前位置；只有在底部时自动跟随新输出，避免一边阅读一边被拉走。
- 按消息和宽度缓存组件；不要每次 token 更新把全部历史拼成一个长字符串再渲染。

第一版采用独立的会话查看视图，复用原生组件，但不调用 switchSession 把主会话实际换成 child。进入/退出查看不会停止主 agent、改变主会话状态或重新触发扩展生命周期。窄屏终端默认全屏查看，活动数量默认显示在状态栏，底部 agent 详情行按统一 dock 预算收缩；选择 dock 模式时才在 dock 显示数量汇总。

如果未来必须把 Pi 原有主聊天区直接变成任意 agent 的视角，公共扩展接口目前未提供完整替换入口，再评估一个很小的 Pi 核心扩展点。第一版不先 fork Pi 核心，也不依赖私有字段。

已结束 subagent 可继续读取结果和原生 transcript；完成后从常驻行收起不删除历史。手动停止沿用 child 的实际取消与结算流程，一并停止其嵌套 child 和所属后台 job；具体创建归属、启动竞争与停止结算见 [子代理运行记录与手动控制](runs.md)。

查看器保留上游 conversation-viewer 的操作语义：x 按两次停止所选 runId，第一次按下后提示“再按 x 停止”，其他任意按键取消待确认；可接收消息的 run 默认选中 Message，Enter 关闭详情并打开输入，提交后按 agent_send 语义投递，返回时保留滚动、搜索与展开状态。已结束、结算中或同一 agent 的旧 run 不发送消息，不因延迟提交恢复会话；workflow 只回答当前可见的挂起问题。搜索与输入拥有文字按键。只读历史不提供快捷停止入口。键位与提示文案维护在 [操作说明](../../../current/agents/operations.md)。

b 将正在等待真实 agent_start 前台调用的顶级普通 child 转为后台；排队、停止中、已结束、嵌套、workflow、RPC 和普通恢复运行不提供此操作。转入时将前台 chargedPool 释放并计入后台实际数量，即使后台池已满也允许既有执行继续，后续启动仍按池上限排队。前台工具以 backgrounded:true 返回，释放等待及 abort 绑定；后续父级 Esc 不停止该 child，结果继续通过统一通知送达。background 更新参与既有记录持久化。

流式刷新按全部 entry 的身份比较，支持中间工具的部分结果变化和并发工具更新；稳定消息继续使用共享 Transcript 的组件与宽度缓存。实际 child.cwd 传给原生消息与工具渲染，工具调用、部分输出与最终结果按 toolCallId 配对。

[返回已完成专项](../../index.md)
