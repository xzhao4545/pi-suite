# Windows Context7 MCP 与资源边界

Windows Node 24.22.2、Pi SDK 1.5.0 使用实际发布包 `@upstash/context7-mcp` 4.5.0，通过现有 child 资源加载器、Pi MCP 工厂和 AgentManager 验收。Context7 仅临时安装到隔离目录，stdio 启动官方发布入口；子进程清除继承的 `CONTEXT7_` 环境项，不使用用户 API key、用户 MCP 配置或付费模型。模型调度使用 SDK 离线 provider，MCP 工具仍真实请求 Context7 外部服务。

## 实际外部内容与调用路径

- direct exposure 在 child session_start 后完成 discovery，实际 `resolve-library-id` 返回 Node.js 候选及 `/nodejs/node`；不是本地固定文本。类型仅选择 `mcp__context7`，禁用 `query_docs` 后直接调用被拒绝。
- codemode exposure 通过 Pi 原生 searchTools 找到 `mcp__context7__query_docs`，经共享工具桥调用，返回 Node.js 文档中的 fsPromises.readFile、UTF-8 示例及 `github.com/nodejs/node` 的 `doc/api/fs.md` 来源。MCP CallToolResult 未标记 isError，codemode 正常完成；禁用的 resolve_library_id 不进入桥接可调用表，调用被拒绝。
- 临时扩展在 before_agent_start 才调用 registerMcpServer。注册前工具表没有 Context7 工具，同一 child 的首轮 codemode 调用仍等待真实连接并返回相同外部文档。该证据覆盖晚注册服务与动态工具范围，不把预先注册的固定工具当作晚注册成功。

Pi 将服务原始工具名的短横线规范为下划线：`resolve-library-id`、`query-docs` 分别对应 `mcp__context7__resolve_library_id`、`mcp__context7__query_docs`；类型 tools/disallowed_tools 使用规范名称。

三个实际 Context7 stdio 进程分别属于 direct、codemode、晚注册 child。各 child 完成后，记录的进程 PID 均查询为 ESRCH；后续 child 不复用已结束服务进程。isolated、extensions=false、未信任项目 `.pi/mcp.json` 三种 child 均无法调用 Context7 工具，也未增加服务进程。

## 资源与信任边界的补充证据

现有 Windows `tests/agents/resources.test.ts` 五项在本专项再次通过，约 4 秒，覆盖实际 stdio MCP 资源帮助工具与命名空间并存、显式资源工具和禁用名单、直接及嵌套越权拦截、包的已配置根和精确排除、junction 逃逸拒绝、项目类型信任、技能预加载及隔离。Context7 提供文档查询工具；通用 MCP resources/list/read 契约由该受控 stdio 服务检查证明，不声称 Context7 返回了不存在的资源 URI。

实际 Context7 调用、进程生命周期与组件资源边界共同构成 Windows 本轮 MCP/资源组合证据；不推断任意第三方 MCP 服务、OAuth 或其他版本均已验收。此专项无需修改实现。

[返回完成索引](../../index.md)
