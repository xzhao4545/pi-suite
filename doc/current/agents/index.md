# Pi 子代理

agents 使用同进程 Pi child 会话。执行层、两池队列、类型发现与记录引用由 @tintinweb/pi-subagents 0.23.0 导入改造，来源见 [上游登记](../../../third-party/UPSTREAM.md)。工具、任务、等待、通知和查看器接入公共框架。

- [执行与记录](runtime.md) — 并发、运行标识、取消、持久会话与历史位置。
- [工具与操作](operations.md) — agent_*、/agents、父级提问和模型来源。
- [模型与 thinking 配置](models.md) — 类型写回、单独修改、下一请求与恢复。
- [类型与资源](resources.md) — 包声明、信任、扩展工具范围、技能、上下文和 memory。

内置 general-purpose、Explore 和 Plan；后二者使用上游的完整只读提示词及 read/bash/grep/find/ls 白名单。默认后台执行，后台并发上限 10，前台上限 0 表示不限。嵌套 child 不占两池槽位，最大会话层数默认 3（顶级与两层嵌套）。

child 的工具由本包按归属注入，外部扩展和技能通过 Pi 公共包管理器与 DefaultResourceLoader 选择并加载，项目资源继承父级信任。自定义类型支持扩展选择、技能预加载、memory 与父级上下文等 frontmatter，未知字段报错。调度、workflow、@handle 与 RPC 的计划维护在 [agents 待办](../../todo/pi-suite/agents/index.md)。

[返回当前文档](../index.md)
