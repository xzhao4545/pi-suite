# Pi 原文初始任务与生命周期阶段

Pi 预设支持前导 `@` 原文，调用方保持 agent.prompt 请求契约。Pi 1.5.0 原生附件解析先于 input hook，本包用单个等号值 string flag 传递正文，显式加载规范入口；src/runtime/cli-prompt.ts 最先注册，仅在 startup 保存待消费正文，在原生初始 input 中替换触发后缀并保留附件文本/图片。消费一次，reload/new/UI fork 不重放；CLI fork 是新的启动。恢复正文继续经过普通 input 链，TUI 已知类型/handle 保持启用后的提及分派，路径/未知 handle 透传，print/JSON 不分派提及。该桥为本项目实现，使用 Pi 公共 API，不修改上游 CLI 或另建执行器。

参数构造复用公开 parseArgs 判断实际选项边界，保留 node cli.js 包装与其他选项的字面值，包括 `--system-prompt '-e'` 和 `--append-system-prompt '--'`，完整生成命令再由现有 launchPolicy 授权。默认 Pi pipe 复用 closeInput 提供 EOF；PTY 保持后续输入。Pi RPC 预设初始 prompt 明确返回 INVALID_ARGS。

Linux 实际 Pi 1.5.0 的 7 种组合、10 次模型请求通过：复杂前导 `@` 逐字入模，同名文件存在也不读取；print、JSON、默认 pipe 与 fork 各执行一次并自然 exit 0。fork 保留源上下文、使用新 session ID，源文件字节不变；自动发现与显式加载去重，原生附件和 JSON 事件保留。真实 PTY 中初始正文、后续输入、reload 后输入与 new 后输入恰好产生四次请求，reload 不重放，new 使用新 session ID，quit 自然 completed/exit 0。既有 7 项 launch 聚合同时通过实际模型 job_start 默认 pipe、精确 allow、附件与原文及 PTY 用户/模型输入，未新增永久测试条目。

适用范围为上述版本的 Linux CLI、公共参数解析与现有 JobManager；Windows、其他 CLI 与未验收工具继续由 [监督专项](../../../todo/pi-suite/index.md) 管理。当前请求、输入与授权见 [CLI 预设](../../../current/jobs/launch.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

[返回完成索引](../../index.md)
