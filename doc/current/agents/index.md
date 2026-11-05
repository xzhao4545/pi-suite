# Pi 子代理

agents 使用同进程 Pi child 会话。执行层、两池队列、类型发现与记录引用由 @tintinweb/pi-subagents 0.23.0 导入改造，来源见 [上游登记](../../../third-party/UPSTREAM.md)。工具、任务、等待、通知和查看器接入公共框架。

- [执行与记录](runtime.md) — 并发、运行标识、取消、持久会话、历史位置与 Execution 回收。
- [持久历史发现与只读查询](history.md) — 默认/配置目录和持久引用、文件缓存、完整分支、合并与操作归属。
- [工具与操作](operations.md) — agent_*、/agents、@handle 提及与补全、父级提问和模型来源。
- [类型、模型与 thinking 配置](models.md) — 启用开关、逐字段写回、单独修改、下一请求与恢复。
- [类型与资源](resources.md) — 包声明、信任、扩展工具范围、技能、上下文和 memory。
- [定时调度](schedules.md) — cron、单次与周期、按会话存储、普通 child 和查看取消。
- [跨扩展 RPC](rpc.md) — 五通道、版本 2、会话与归属、同步消费、cwd 与结构化结果。
- [Workflow 编排](workflow/index.md) — Worker、宿主、保存资源、共享等待、原生控制和 journal 边界。

内置 general-purpose、Explore 和 Plan；后二者使用上游的完整只读提示词及 read/bash/grep/find/ls 白名单。默认后台执行，后台并发上限 10，前台上限 0 表示不限。嵌套 child 不占两池槽位，最大会话层数默认 3（顶级与两层嵌套）。

child 的工具由本包按归属注入，外部扩展和技能通过 Pi 公共包管理器与 DefaultResourceLoader 选择并加载，项目资源继承父级信任。自定义类型支持扩展选择、技能预加载、memory 与父级上下文等 frontmatter，未知字段报错。TUI 的 @handle 使用普通发送/恢复路径；类型首次启动通过父会话内存克隆生成任务。定时调度按主会话保存并生成普通后台 child。外部扩展通过 RPC 启动、停止、引导与消费顶级结果；workflow 使用共享执行、资源、记录和通知，通过 /agents workflows 查看与控制。

[返回当前文档](../index.md)
