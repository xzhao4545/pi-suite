# 类型与资源

类型按内置默认、Pi 已安装包的显式声明、用户 `<agentDir>/agents`、工作区 `.agents/agents`、项目 `.pi/agents` 加载；同名定义由后者覆盖。项目包与两个项目类型目录只在 `ctx.isProjectTrusted()` 为 true 时参与。精确名称优先，大小写匹配必须唯一；`agents.types.<规范类型名>.enabled` 覆盖 frontmatter 的 enabled 与默认 true，最终 enabled=false 禁止新准入，未知字段和无效文件报告错误。类型菜单保留 disabled 类型，写回与操作见 [类型配置](models.md)。

## Frontmatter

支持 name、display_name、color、description、tools、disallowedTools/disallowed_tools、extensions、exclude_extensions、skills、model、thinking、max_turns、persist_session、session_dir、allowed_subagents、prompt_mode、inherit_context、run_in_background、isolated、memory 和 enabled；正文为系统提示。名称中的冒号保留给包作用域标识；memory 类型名只允许以字母或数字开头的字母、数字、点、下划线和短横线，最长 128 字符。

model/thinking 的优先级见 [模型配置](models.md)。max_turns、inherit_context、run_in_background 和 isolated 的 frontmatter 优先于本次调用参数。run_in_background 决定实际前台等待或后台立即返回；persist_session 覆盖默认持久化。session_dir 支持绝对路径、相对 cwd 的路径和 `~`，其次使用 Pi 会话目录环境变量与设置；恢复已有会话沿用其文件。

allowed_subagents 默认为关闭；true、all 或 `*` 开放所有类型，CSV/数组限定类型。false、空名单和 none 关闭嵌套。达到 maxDepth 时不注册嵌套工具；isolated child 在注册与 Manager 启动入口都禁止嵌套。

## 扩展与工具范围

extensions 默认 true，加载 Pi 配置和自动发现的扩展；false 或空名单关闭外部扩展。名单支持不区分大小写的规范名称、包的短名称、相对/绝对路径及 `~`；`*` 包含默认发现的扩展。exclude_extensions 接受规范名称，排除优先于包含，未匹配名称或无效路径报告错误。

父 CLI 通过 `-e` 临时加载的 source 不自动加入 child 默认资源；child 使用该扩展时，需在类型 extensions 声明路径或将其纳入 Pi 配置。跨 cwd 的 child 仍从父级配置目录解析这些声明，目标项目资源遵循自身信任边界。

Pi 的公共 DefaultPackageManager 解析路径与启用状态，筛选后交给 DefaultResourceLoader 加载；本包只注入一次带父级/run 归属的 child 工具。筛选发生在扩展工厂执行前，排除项不执行。Pi 的 `--no-extensions`/`-ne` 与 `--no-mcp` 对应的内置扩展开关得到保留，codemode、tool-search、MCP 使用 Pi 的新工厂。

tools 支持 Pi 工具名、内置名称的大小写别名、Glob→find、MultiEdit→edit 和通配模式。`*`/all 展开全部内置工具；缺省包含内置及本包 task/job/wait，具体模块仍受 modules 开关约束。

- `ext:foo` 允许已加载 foo 的工具；`ext:foo/bar` 只允许其 bar 工具，工具名称区分大小写。出现 ext: 选择器后，外部扩展工具按显式名单选择；扩展加载仍由 extensions 决定。
- `mcp__server` 展开为 `mcp__server__*`，也支持精确名称与通配模式；codemode/tool_search 桥接调用采用同一范围。
- `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 是带 server 参数的通用资源工具，显式 tools 选择独立于 `mcp__` 服务器工具名单；仅选择服务器工具不会自动开放资源工具，disallowed_tools 仍优先。
- disallowed_tools 在所有范围之后应用，支持通配；父级 ask_user、获准嵌套和 memory 需要的注入工具也不能绕过禁用名单。

动态范围从扩展实际工具表派生，包含 session_start 和 before_agent_start 中的晚注册工具。turn_end 在 Pi 快照下一请求之前收窄活动集合；agent.beforeToolCall 检查直接调用，tool_call 检查 ctx.executeTool 的嵌套调用。第一请求中扩展可能扩大声明集合，调用检查仍禁止越界执行。扩展路径与包别名在安装该会话范围时解析一次，工具表随注册更新。

MCP 服务原始工具名按 Pi 规则规范为 `mcp__<server>__<tool>`，不属于字母、数字或下划线的字符转换为下划线；超过 64 字符或规范化后重名时加入哈希后缀。例如 Context7 的 `query-docs` 对应 `mcp__context7__query_docs`，类型选择与禁用名单使用规范名称。Windows Pi 1.5.0 与 Context7 MCP 4.5.0 通过真实 stdio discovery、直接调用、codemode 桥接及 before_agent_start 晚注册，child 结束后服务进程关闭；适用范围见 [Windows Context7 与资源边界](../../finished/pi-suite/agents/windows-context7.md)。

## 技能、提示与隔离

skills 默认 true，使用 Pi 的技能发现、配置与启用规则；false 关闭技能。名字数组从同一目录解析，完整 SKILL.md 按名字预加载一次，缺失名字报告错误，其他技能不进入提示。无需额外扫描技能目录。

prompt_mode=replace 使用该类型提示；append 使用父级稳定提示前缀和该类型提示。父级的 skills、cwd 和请求时扩展段由上游 inheritableParentPrompt 分离，child 的相应内容由 Pi 自己渲染。子会话不自动追加项目 AGENTS.md、模板、主题或 APPEND_SYSTEM.md，类型声明控制提示组成。

inherit_context 将启动时的父级用户/assistant 文本和压缩摘要加入请求，跳过工具结果。isolated 强制关闭外部扩展、技能与嵌套工具；本包的父级提问和选定任务/job 工具仍使用统一归属。

## Memory

memory 接受 user、project、local：目录分别为 `<agentDir>/agent-memory/<类型>`、`<cwd>/.pi/agent-memory/<类型>`、`<cwd>/.pi/agent-memory-local/<类型>`。MEMORY.md 的前 200 行进入提示；详细记忆以索引链接到其他文件。

有效 write 或 edit 工具存在时创建目录并注入可写提示，补充未禁用的 read/write/edit；只读类型仅注入读取提示与 read，不创建缺失目录。读取错误报告给调用方，Pi 的正常文件访问语义保持一致。

## 包声明

只读取 DefaultPackageManager.listConfiguredPackages 返回的已安装根，不安装依赖、不扫描 node_modules，也不按 agents 目录惯例自动纳入。`agents.packageAgents` 缺省/true 接受全部声明包，false/空数组关闭，数组按不区分大小写的完整包名、短名或配置 source 匹配。

优先使用 `pi.subagents`，其次 `pi-subagents`；数组为 agents 简写，对象支持 agents 与 workflows 数组。声明接受目录的直接文件或单文件、`!` 精确路径排除；不支持 glob。每个实际文件必须留在包的真实安装根内，符号链接不能逃逸；文件上限为 1 MiB。类型保留 packageName/sourcePath；workflow 声明同样按指定路径解析，声明单文件时不会纳入同目录的其他脚本。

仅提供类型/workflow 的资源包在标准 Pi manifest 中声明 `pi.extensions: []`；没有 extensions 声明时，Pi 的扩展发现按默认模块入口加载包目录。workflow 名称、512 KiB 脚本上限、项目与用户优先级及 packageWorkflows 门控见 [Workflow 宿主与资源](workflow/host.md)。

[返回 agents](index.md)
