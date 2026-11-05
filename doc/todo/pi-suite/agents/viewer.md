# 子代理原生会话查看

目标：保留执行能力，使用 Pi 消息组件渲染子代理会话。

当前状态：共享原生 Transcript、独立详情、thinking/工具折叠、流式消息和部分结果、底部跟随及历史叶子已接入；组件缓存已扩展，完整流式/窄屏验收及上游快捷控制待完成。

查看期间使用 Manager 的 run retain 引用阻止 Execution 回收，退出后释放；非持久 transcript 的回收边界与完整记录保留见 [类型与回收阶段](../../../finished/pi-suite/agents/types-retention.md)。

workflow 详情使用相同原生详情、阅读与值选择框架；child Transcript、gate 日志、暂停/恢复/停止、跳过/重试和 journal 重放的接入见 [宿主接入阶段](../../../finished/pi-suite/agents/workflow-host.md)，Windows 与真实手机 SSH 由 [扩展专项](extensions.md) 验收。

影响范围：child session、消息组件、工具渲染、流式更新、运行/历史查看、手动停止与常驻摘要。

约束：查看不实际切换主会话；工具使用 child 的渲染定义，历史阅读位置稳定。

相关当前文档：[项目当前状态](../../../current/index.md)、[统一界面](../../../current/ui/index.md)。

## 任务列表

- [x] 复用 user/assistant/tool execution 消息组件
- [ ] 按 toolCallId 关联调用、流式结果和最终结果
- [x] 实现独立查看视图、折叠和底部跟随
- [ ] 缓存消息组件，活动数量注册为状态，常驻详情行交给统一 dock
- [x] 保留已结束 subagent 结果和会话引用，接入手动停止入口

## 验收方式

核对 Markdown、代码块、thinking、工具结果和实时输出；已结束记录同样可查看，查看不影响主运行或触发生命周期切换。手动停止只按选定 child 执行范围取消，历史记录保留。

## 关联计划

- [统一界面](../ui.md)
- [任务引用](../tasks.md)
- [统一框架边界](../architecture.md)
- [子代理运行记录与手动控制](runs.md)
- [主从交互](interaction.md)
- [活动数量状态](../status.md)

## 8. agents：复用主 agent 的消息渲染

保留上游 subagent 执行和会话记录能力，替换查看器的文本提取路径。

- user/assistant 使用 Pi 导出的 UserMessageComponent、AssistantMessageComponent。
- 按 toolCallId 关联工具调用、参数、流式结果和最终结果，使用 ToolExecutionComponent。
- 工具渲染应使用该 child session 的渲染定义；缺少定义时使用标准回退，不能拿主 agent 的同名工具定义假定完全相同。
- 保留 Markdown、代码高亮、thinking 展开策略、工具折叠和错误样式；支持当前流式消息更新。
- 查看历史时固定当前位置；只有在底部时自动跟随新输出，避免一边阅读一边被拉走。
- 按消息和宽度缓存组件；不要每次 token 更新把全部历史拼成一个长字符串再渲染。

第一版采用独立的会话查看视图，复用原生组件，但不调用 switchSession 把主会话实际换成 child。进入/退出查看不会停止主 agent、改变主会话状态或重新触发扩展生命周期。手机默认全屏查看，活动数量默认显示在状态栏，底部 agent 详情行按统一 dock 预算收缩；选择 dock 模式时才在 dock 显示数量汇总。

如果未来必须把 Pi 原有主聊天区直接变成任意 agent 的视角，公共扩展接口目前未提供完整替换入口，再评估一个很小的 Pi 核心扩展点。第一版不先 fork Pi 核心，也不依赖私有字段。

已结束 subagent 可继续读取结果和原生 transcript；完成后从常驻行收起不删除历史。手动停止沿用 child 的实际取消与结算流程，一并停止其嵌套 child 和所属后台 job；具体创建归属、启动竞争与停止结算见 [子代理运行记录与手动控制](runs.md)。

查看器保留上游 conversation-viewer 的操作语义：x 按两次停止当前执行，第一次按下后提示“再按 x 停止”，其他任意按键取消待确认；Enter 打开引导输入，提交后按 agent_send 语义投递；b 将前台执行转为后台。只读历史不提供停止入口。键位与提示文案同步写入操作说明。
