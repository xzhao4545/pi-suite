# Pi 子代理

agents 使用同进程 Pi child 会话。执行层、两池队列、类型发现与记录引用由 @tintinweb/pi-subagents 0.23.0 导入改造，来源见 [上游登记](../../../third-party/UPSTREAM.md)。工具、任务、等待、通知和查看器接入公共框架。

- [执行与记录](runtime.md) — 并发、运行标识、取消、持久会话与历史位置。
- [工具与操作](operations.md) — agent_*、/agents、父级提问和模型来源。

内置 general-purpose、Explore 和 Plan；后二者使用上游的完整只读提示词及 read/bash/grep/find/ls 白名单。默认后台执行，后台并发上限 10，前台上限 0 表示不限。嵌套 child 不占两池槽位，最大会话层数默认 3（顶级与两层嵌套）。

当前 child 的扩展工具由本包明确注入；资源加载复用 DefaultResourceLoader 的项目上下文、技能和模板。自定义类型支持当前的核心 frontmatter 字段，未知字段报错。完整扩展与包资源选择器、模型配置界面、调度、workflow、@handle 与 RPC 的计划维护在 [agents 待办](../../todo/pi-suite/agents/index.md)。

[返回当前文档](../index.md)
