# 子代理类型与资源基础阶段

按职责导入 @tintinweb/pi-subagents 0.23.0 的扩展选择、动态工具范围、包声明解析、父级上下文、memory 提示和父提示前缀分离，接入 Pi 公共包管理器与 DefaultResourceLoader。技能使用同一 Pi 发现目录预加载，支持完整保留 frontmatter、session_dir 和 frontmatter 优先的运行选项。

必要改造：扩展在工厂运行前按启用、包含/排除与本包身份筛选；项目信任通过父 ctx 传递，包发现不安装、不扫描依赖目录；动态范围复用同一 SDK 会话，在直接调用和 ctx.executeTool 嵌套调用处检查；晚注册工具保持可用，名称别名只解析一次。本包工具使用归属注入，隔离与深度限制不注册不可用嵌套工具。

4 项 Linux 真实 SDK/faux 检查覆盖 Pi 配置包、manifest 拼写与优先级、精确排除与目录/单文件、项目不信任、路径及符号链接逃逸、扩展工厂不重复/不执行排除项、晚注册与主动扩大工具范围、直接与嵌套调用、MCP 服务器通配与桥接、技能预加载一次、memory 截断/读写与不建只读目录、父级上下文不含工具输出，以及前台与会话目录选项。

Windows、实际 MCP 服务与更完整资源组合仍在 [扩展专项](../../../todo/pi-suite/agents/extensions.md) 验收；@handle、调度、workflow/RPC 与类型开关继续按原计划导入。稳定规则见 [类型与资源](../../../current/agents/resources.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。
