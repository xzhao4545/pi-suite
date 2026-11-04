# 统一界面

Dock 是本包唯一常驻 widget，键为 pi-suite:dock。模块提交稳定 ID、文本和优先级；dock 按优先级分配可见行，末行显示隐藏数量。纯展示截断不会修改原始数据。

## 高度与状态

低于 28 行的终端最多分配 3 行；普通终端最多 6 行且不超过终端高度的 20%。ui.maxRows 可继续收紧预算。本包发布状态时在预算内为 Pi 原生 footer 的额外状态行预留一行。询问与 dock 共用预算；打开独立详情时收起 dock，关闭后恢复。

每行使用 Pi 的 ANSI 安全截断与可见字符宽度，不自动换行。只有展开的 Markdown 详情按宽度换行。第三方 widget 或 footer 的高度由其自身控制。

StatusPublisher 是 goal 与 pi-suite:runtime 两个槽位的唯一写入方，原生 setStatus 更新/清除摘要。活动 ID 使用集合去重；文本不变时不重复写入。status 模式的摘要不在 dock 重复展示，dock 模式清除状态槽位，hidden 不建立常驻摘要。绑定撤销时清除本包的两个槽位。

## 原生会话查看

Transcript 复用 Pi 的 UserMessageComponent、AssistantMessageComponent、ToolExecutionComponent、CustomMessageComponent 和压缩/分支摘要组件。已知内置工具采用 Pi 提供的 renderers；未知扩展工具使用原生通用工具呈现。工具调用与结果按 toolCallId 配对，不执行工具。thinking 与工具详情可切换展开，输出默认不传输终端图片。

ScrollView 为历史与每个选项详情分别保存滚动位置及搜索内容，支持按行、按页、Home/End、搜索和下一匹配。终端支持的鼠标滚轮通过 Pi 的标准事件增强阅读。尺寸改变不初始化回答草稿或勾选集合。

[返回当前文档](../index.md)
