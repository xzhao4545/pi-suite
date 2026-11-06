# 实施顺序与验收

目标：按照依赖关系分阶段落地，并记录必要验收结论。

当前状态：基线元数据、共享界面、ask、目标与两级任务基础能力已落地；默认答案、批量专项和目标生命周期基础阶段通过两平台离线检查，两级任务基础阶段通过 Linux 检查。单包架构与统一工具规范、完整 session job 可见集和活动投影已通过 Linux 验收；真实询问/goal/child/job 通知协调、统一 Dock 必要详情/任务优先级、完整 Starship 发布入口与历史主动清理通过 Linux 验收；手机 SSH、用户实际 footer 配置、任务执行恢复关联的跨平台组合、执行任务与子代理平台综合验收仍按本计划实施。

共享输出预算/原始范围/续读提示、密码回显隐藏与横向 PTY 重绘、有限完成预览、实际 Pi CLI 的原样前导 `@`/附件/默认 pipe 与 fork/PTY 生命周期、Codex exec_command/Claude Bash/Read 的受控执行与停止、包技能已通过 Linux 分阶段验收；超长逻辑行的线性组装/正则资源错误和垂直/全屏支持范围已验证，其他 CLI 与未验收工具范围、Cursor 环境及 Windows/真实手机组合继续按 jobs 专项推进。

影响范围：全部功能模块、两平台及手机 SSH 场景。

约束：静态核对不替代运行验收；此处记录计划，不长期归档临时产物或流水账。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [ ] 完成宿主与上游基线的两平台原问题复现，已登记来源与 Linux 结论见对应专项
- [x] 实现统一 dock 与 ask，完成已记录范围的 Linux 通知与布局组合验收
- [x] 修正 goal 状态与续跑（真实 jobs/agents 综合通知在对应模块接入后验收）
- [x] 接入 goal 状态栏摘要，完成原生 footer 与完整 pi-starship 发布入口的 Linux 布局验收
- [ ] 复核 Windows、真实手机 SSH 与用户实际 footer 配置的询问、Dock 和状态栏组合，见 [界面待办](ui.md) 与 [状态栏待办](goal-status.md)
- [x] 统一工具规范：改名 ask/goal 已有参数，抽取共享 schema/返回类型与 wait
- [x] 注册 agent/job 活动数量，接入活动与已结束记录查看及手动停止（实现与 Linux 验收完成，平台组合见状态栏/模块待办）
- [ ] 完成已导入 jobs 的实际 CLI 剩余能力、终端及平台组合验收，见 jobs 对应专项
- [ ] 完成已导入两级 tasks、agents 的主从交互、扩展资源与原生查看平台组合验收，见对应专项
- [x] 确认 Pi 退出终止原任务与 PTY，不实施跨进程保活，见 [范围决策](../../finished/pi-suite/jobs/exit-scope.md)

## 验收方式

执行原设计列出的必要场景，只记录结论、适用范围及未通过项；完成专项迁至 finished，并把稳定事实写入 current。

## 关联计划

- [基线核对](upstream-baseline.md)
- [上游导入](upstream-import.md)
- [统一工具设计](../../finished/pi-suite/tool-design.md)
- [用户询问](ask/index.md)
- [执行任务](jobs/index.md)
- [子代理](agents/index.md)

## 10. 实施顺序与验收

1. **建立基线。** 核对 Windows/Linux 实际 Pi 和扩展版本；记录源码来源、许可证；在两平台复现原问题，确定要保留的现有工具契约。Linux 不设发行版专项，不安装新的发行版。
2. **统一 dock + ask。** 先解决手机显示挤压、聊天查阅和默认/禁用超时；这也是后续 tasks/agents/jobs 的 UI 基础。
3. **goal 状态修正。** 区分目标状态和运行状态，验证 retry、compact、reload 的事件顺序和续跑次数；从同一状态派生 footer 摘要，验证原生状态栏与 pi-starship 联动。
4. **统一工具规范。** 按 [统一工具设计](../../finished/pi-suite/tool-design.md) 改名已注册的 ask/goal 参数，抽取共享 ID、列表、读取、等待和停止 schema，实现共享 wait 的接口与通知撤销规则。
5. **融合 jobs。** 按 [上游导入](upstream-import.md) 导入 pi-background-jobs 与 pi-interactive-shell 的保留文件；先完成同进程 reload/resume 保活和 Windows/Linux 两种后端，再统一通知、运行/历史查询、输入输出、读取搜索与截断、监视与委派、耗时与手动停止，并提供活动数量。
6. **两级 tasks + agents。** 任务提供查询与批量增删改、父级完成比例和自动折叠；agents 导入上游执行与扩展能力，增加提问转交与进度读取，保留已结束记录和手动停止，改用原生消息渲染并提供活动数量。
7. **退出清理。** Pi 退出时终止原任务与 PTY，保留持久历史和日志供后续读取；不实施独立 supervisor 或跨 Pi 进程重新 attach，见 [范围决策](../../finished/pi-suite/jobs/exit-scope.md)。

必要验收场景：

- 40×24、60×30、120×40 终端；中文长标题、多个 agent、多个 job；同时存在 tasks、goal、询问。
- 询问默认超时、指定时长、timeout=0；查阅历史、切换焦点和输入草稿；回答与计时结束同时发生只结算一次。
- 两级任务批量增删改查、子任务移动/删除/完成后重新打开、父级比例重算、多个 child 并发更新、自动折叠与完成项显示筛选；不接受第三层。
- 真正运行受控长任务，在同一 Pi 进程执行 reload/new/resume/fork 后确认仍是原进程、日志继续且通知不串会话。
- pipe/PTY 输入、终端缩放、attach/detach、退出码；Windows 和 Linux 分别验证。
- job 运行/已结束记录、输入输出分页、耗时、停止请求与退出/清理结算、历史只读；agent 已结束结果与 transcript、手动停止、恢复后新执行，以及级联停止嵌套 child 和所属后台 job。核对已 detach/创建 child 已结束的 job、停止与启动竞争、重复请求及非目标创建归属。
- goal 在正常结束、请求错误、宿主重试成功/耗尽、手动/自动 compact、Esc、reload 时状态正确；不重复发起模型请求。
- goal 状态栏同步运行、等待与终态；无目标和会话切换时清除旧摘要；status/dock 不重复展示。分别核对原生 footer 额外状态行，以及 pi-starship 的 extension_status 配置、数量上限和窄屏换行。
- 用离线 faux provider 或可控桩验证模型生命周期，避免验收依赖付费模型和网络偶发行为。
- subagent Markdown、代码块、thinking、工具调用/结果、折叠和实时输出；阅读位置稳定。
- agent/job 活动数量按当前可见集合去重；等待、排队、停止中、清理未确认和已结束状态的口径一致，status/dock 不重复汇总，旧绑定不能覆盖新摘要。
- 已注册工具的名称、参数、默认值、互斥规则与返回首行符合统一规范；上游旧工具名不再注册。
- job 默认读取的头尾与关键行、偏移分页、正则搜索与上下文、PTY 可见文本；大日志与中文跨页边界。
- wait 的 any/all、超时、取消与通知撤销；goal_wait 的 waitFor 只在指定对象结算后继续。
- child 向父 agent 提问、agent_send 回答/引导/恢复、等待中提前返回问题、提问超时与嵌套不越级。
- monitor 三种策略的触发、冷却与生命周期通知；hands-free 更新预算、dispatch 静默结束、用户接管与交还。
- 自定义 agent 类型、@handle、定时调度、agent_workflow 与跨扩展 RPC 的开关和基本流程。
- TUI 按类型与按单个 subagent 配置模型和 thinking：列表只含已认证模型，类型配置不需 /reload 即作用于新启动的执行且不影响已运行的，单个修改从下一次模型请求生效；优先级为参数、类型配置、frontmatter。

设计阶段的静态源码核对不替代以上运行验收。
