# 真实 MCP 传输与资源组合阶段

Linux Pi 1.5.0 使用原生 createMcpExtension 连接实际 stdio MCP 子进程，复用现有工具范围与原生调用管线。`mcp__` 名单筛选服务器工具；通用资源 helper 按显式 tools 选择，不因服务器名单被删除，也不会仅因选择一个服务器而自动开放，disallowed_tools 保持优先。

新增 1 项真实传输聚合，验证 discovery、服务器工具与显式 list/read 资源并存、非选择服务器/禁用工具不执行、只选服务器或禁用资源时不读取，以及 child 结束关闭全部 stdio 进程。

受控真实服务另验证原生 codemode 嵌套调用、tool_search 激活、tools/list_changed 后晚注册工具在下一请求执行、isolated 与不可信项目不连接。跨 cwd RPC 仅加载用户 MCP，父项目与目标项目 MCP 均不加载；各服务进程及临时配置完成后清理。本阶段服务为本机协议夹具，不代表任意业务服务、OAuth 或 Windows 组合验收。

稳定规则见 [类型与资源](../../../current/agents/resources.md)。Windows、实际业务服务及资源组合见 [扩展待办](../../../todo/pi-suite/index.md)。

[返回完成索引](../../index.md)
