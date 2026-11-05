# 统一界面

Dock 是本包唯一常驻 widget，键为 pi-suite:dock。模块提交稳定 ID、文本和优先级；dock 按优先级分配可见行，末行显示隐藏数量。纯展示截断不会修改原始数据。

## 高度与状态

低于 28 行的终端最多分配 3 行；普通终端最多 6 行且不超过终端高度的 20%。ui.maxRows 可继续收紧预算。本包发布状态时在预算内为 Pi 原生 footer 的额外状态行预留一行。询问与 dock 共用预算；打开独立详情时收起 dock，关闭后恢复。

每行使用 Pi 的 ANSI 安全截断与可见字符宽度，不自动换行。展开的 Markdown 详情与字面量日志详情按宽度换行。第三方 widget 或 footer 的高度由其自身控制。

StatusPublisher 是 goal 与 pi-suite:runtime 两个槽位的唯一写入方，原生 setStatus 更新/清除摘要。活动 ID 使用集合去重；文本不变时不重复写入。status 模式的摘要不在 dock 重复展示，dock 模式清除状态槽位，hidden 不建立常驻摘要。绑定撤销时清除本包的两个槽位。

goal 摘要从目标与调度状态派生；完成反馈显示 5 秒后清除，回调同时校验绑定与目标 ID。暂停、阻塞、请求失败与预算耗尽持续可见。Pi 原生 footer 读取 goal 键；pi-starship 0.65.2 使用 extension_status 模块读取同一键，其格式和数量上限由外部 footer 配置控制。目标详情通过 /goal 打开，复用 Markdown 与 ScrollView，并提供搜索和显式翻页操作。

## 原生会话查看

Transcript 复用 Pi 的 UserMessageComponent、AssistantMessageComponent、ToolExecutionComponent、CustomMessageComponent 和压缩/分支摘要组件。已知内置工具采用 Pi 提供的 renderers；未知扩展工具使用原生通用工具呈现。工具调用与结果按 toolCallId 配对，不执行工具。thinking 与工具详情可切换展开，输出默认不传输终端图片。

ScrollView 为历史与每个选项详情分别保存滚动位置及搜索内容，支持按行、按页、Home/End、搜索和下一匹配。终端支持的鼠标滚轮通过 Pi 的标准事件增强阅读。尺寸改变不初始化回答草稿或勾选集合。

DetailsView 提供统一标题、滚动正文、搜索与可配置操作栏；静态 Markdown 与 jobs 动态日志使用同一框架。ScrollView 支持替换正文并保留阅读状态，调用方可要求下次渲染跟随底部；用户在渲染前滚动或开始搜索会取消该次跟随。日志只缓存当前字节窗口，具体操作见 [执行任务](../jobs/index.md#用户操作)。

[返回当前文档](../index.md)
