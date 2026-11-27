# 类型与资源

## 类型发现

类型按以下顺序加载（`catalog.ts`），同名时后加载的覆盖先加载的：

1. 内置类型（`defaults.ts`），见 [内置类型](index.md#内置类型)。
2. Pi 已安装包声明的类型，见 [包声明](#包声明)。
3. 用户目录 `<agentDir>/agents/*.md`。
4. 项目目录 `.agents/agents/*.md`。
5. 项目目录 `.pi/agents/*.md`。

- 项目包和两个项目目录只在 `ctx.isProjectTrusted()` 为 true 时参与。
- 目录只读取直接包含的 `.md` 文件，按文件名排序；文件开头的 BOM 会被去掉。
- 类型名取 frontmatter 的 name（去掉首尾空白），缺省为文件名。名称不能含 `:`，冒号保留给包作用域。
- 按名称查找时先精确匹配；没有精确匹配时不区分大小写匹配，结果必须唯一。
- 字段名或值无效、或包含未知字段时，报 AGENT_CONFIG，并给出文件路径。
- 启用状态及禁用类型的处理见 [类型启用状态](models.md#类型启用状态)。未知或匹配不唯一的类型报 AGENT_TYPE。

## Frontmatter

只从内置、包和 Markdown 文件中发现类型；正文去掉首尾空白后成为该类型的系统提示。字段：

| 字段 | 取值 | 作用 |
| --- | --- | --- |
| name | 字符串 | 类型名，缺省为文件名 |
| display_name | 字符串 | 记录名称的缺省值 |
| description | 字符串 | 类型说明 |
| color | 字符串 | 显示颜色 |
| tools | CSV 或数组；`none` 表示空 | 工具范围，见 [扩展与工具范围](#扩展与工具范围) |
| disallowedTools / disallowed_tools | CSV 或数组 | 禁用工具；两者同时存在时用 disallowed_tools |
| extensions | true、false、CSV 或数组 | 加载的扩展，默认 true |
| exclude_extensions | CSV 或数组 | 排除的扩展，只接受规范名称 |
| skills | true、false、CSV 或数组 | 技能，默认 true，见 [技能与提示](#技能与提示) |
| model、thinking | 字符串；off、minimal、low、medium、high、xhigh、max | 优先级见 [解析与来源](models.md#解析与来源) |
| max_turns | ≥0 的整数 | 回合上限，0 表示不限 |
| persist_session | boolean | 是否保存会话文件 |
| session_dir | 字符串 | 会话文件目录 |
| allowed_subagents | true、false、CSV 或数组 | 允许嵌套启动的类型，见 [嵌套](#嵌套) |
| prompt_mode | append 或 replace | 提示组成，自定义类型默认 replace |
| inherit_context | boolean | 附加父会话上下文 |
| run_in_background | boolean | 前台或后台执行 |
| isolated | boolean | 隔离模式 |
| memory | user、project、local | 持久记忆目录，见 [Memory](#memory) |
| enabled | boolean | 启用状态 |

字段规则：

- max_turns、inherit_context、run_in_background、isolated 在 frontmatter 中设置时，优先于本次调用参数。run_in_background 决定调用是等待结果还是立即返回；调度触发的 run 总是后台。
- persist_session 覆盖 `agents.persistSessions`，对嵌套 child 也有效（嵌套 child 默认不保存）。恢复已有 agent 时沿用记录中的持久状态。
- session_dir 中的 `~` 展开为用户主目录，相对路径按 child 的 cwd 解析。未设置时的位置见 [会话文件](runtime.md#会话文件)。
- 设置了 memory 的类型，名称必须以字母或数字开头，只含字母、数字、`.`、`_`、`-`，最长 128 字符；否则报 AGENT_CONFIG。
- exclude_extensions 的名称含 `/`、`\`、`*` 或 `~` 时报 AGENT_CONFIG。

### 嵌套

- allowed_subagents 缺省时不允许嵌套。true，或名单中含 `*`、`all`（不区分大小写）时允许所有类型；其他名单只允许列出的类型。false、空名单和 `none` 不允许嵌套。
- 嵌套工具为 agent_start、agent_list、agent_get、agent_read、agent_send、agent_stop。只有类型允许嵌套、child 不是 isolated、当前层数小于 `agents.maxDepth` 时才注册。顶级 child 算第 1 层。满足这些条件时，wait 也自动加入工具范围；否则由 tools 决定是否可用。
- `AgentManager.start` 启动嵌套 child 时再次检查：isolated child 报 AGENT_TYPE（`An isolated child cannot start nested agents`）；类型不在名单中报 AGENT_TYPE（`<父类型> cannot start <类型>`）；达到层数上限报 AGENT_DEPTH。
- 嵌套启动读取 child 配置目录（configCwd）的当前配置，所以运行中修改类型启用状态会影响之后的嵌套启动。

## 扩展与工具范围

### 扩展

扩展加载由 `resources/loader.ts` 处理：

1. Pi 的 `DefaultPackageManager` 解析已配置的扩展路径和启用状态。extensions 名单中的路径项作为临时 source 一起解析。
2. 按类型声明筛选路径，交给 `DefaultResourceLoader` 加载。筛选在扩展工厂执行之前完成，被排除的扩展不会执行。
3. 另外注入 Pi 的 codemode、tool-search、mcp 扩展工厂，本包的 child 工具（`child.ts`）和工具范围检查扩展。本包自身（规范名含 `pi-suite`）总是从发现结果中排除，child 工具只注入一次。

extensions 取值：

| 值 | 加载 |
| --- | --- |
| true（默认） | Pi 配置和自动发现的全部已启用扩展 |
| false、空名单、`none` | 不加载外部扩展 |
| 名单 | 列出的扩展；`*` 表示包含全部默认发现的扩展 |

- 名单项含 `/`、`\` 或以 `~` 开头时是路径：`~` 展开，相对路径按 configCwd 解析。其他项是名称，不区分大小写。
- 名称匹配扩展的规范名，或声明该入口的 Pi 包的短名称（`@scope/foo` 匹配 `foo`）。
- exclude_extensions 优先于 extensions。
- extensions 名单或 `ext:` 选择器中的名称没有匹配到已启用扩展时报 AGENT_CONFIG（`extension <名称> is not enabled or available`）；exclude_extensions 的名称没有匹配时同样报错（`excluded extension <名称> ...`）。
- 父进程带 `--no-extensions` 或 `-ne` 时，child 不加载 codemode、tool-search、mcp；带 `--no-mcp` 时不加载 mcp。
- 父 CLI 用 `-e` 临时加载的 source 不会自动进入 child。child 需要该扩展时，在类型的 extensions 中写它的路径，或把它加入 Pi 配置。
- 扩展、技能和 memory 都从 configCwd 解析。child 的 cwd 与 configCwd 不同时（RPC 可指定），传给 child 会话的 SettingsManager 把项目视为未信任，目标目录的项目配置（如 MCP 配置）不参与。

### 工具

tools 取值：

| 写法 | 含义 |
| --- | --- |
| 缺省 | 全部内置工具，加 task_list、task_get、task_edit、job_start、job_list、job_get、job_read、job_write、job_stop、wait |
| `*` 或 `all` | 全部内置工具：read、write、edit、bash、grep、find、ls、powershell |
| 内置工具名 | 不区分大小写；`Glob` 对应 find，`MultiEdit` 对应 edit |
| 其他工具名 | 区分大小写，可用 `*` 通配 |
| `ext:foo` | 扩展 foo 的全部工具 |
| `ext:foo/bar` | 扩展 foo 的 bar 工具；工具名区分大小写 |
| `mcp__server` | 等同 `mcp__server__*` |
| `mcp__server__tool` 或含 `*` 的模式 | 匹配的 MCP 工具 |

规则：

- task 和 job 工具只在 `modules.tasks`、`modules.jobs` 开启时存在。
- `scope.ts` 先加入 tools 中直接匹配的工具，再按扩展选择器加入工具。出现任一 `ext:` 选择器时，第二步只加入点名的扩展及工具。扩展是否加载仍由 extensions 决定，未被选中的扩展也可执行事件处理。
- 出现 `mcp__` 项后，`mcp__` 开头的工具只保留匹配的。匹配的 MCP 工具来自任何扩展都会保留，包括 `ext:` 选择器没有列出的扩展；codemode 和 tool_search 也会保留，用来调用这些 MCP 工具。
- list_mcp_resources、list_mcp_resource_templates、read_mcp_resource 通过 server 参数访问资源。使用 `mcp__` 筛选时，要在 tools 中另选这些通用工具；只列服务器工具不会开放它们。
- disallowed_tools 支持 `*` 通配，在所有规则之后应用，任何工具都不能绕过。
- 以下工具自动加入（仍受 disallowed_tools 限制）：
  - ask_user（向父级提问）：tools 为空（`none` 或空数组）时不加入。
  - 嵌套工具：满足 [嵌套](#嵌套) 的条件时加入。
  - memory 需要的 read/write/edit，见 [Memory](#memory)。
  - StructuredOutput：要求结构化输出时加入。

### 运行时检查

工具范围在 child 会话建立后由 `resources/scope.ts` 的 `installExtensionToolScope` 安装：

1. 允许集合从会话当前的全部工具计算，包括扩展在 session_start 和 before_agent_start 中晚注册的工具。扩展路径的别名在安装时解析一次。
2. 安装时和每个 turn_end 重新计算活动工具，在 Pi 生成下一次请求之前生效。只激活向模型声明的工具（exposure 为 direct 或 model-only），且是显式列出的工具或没有设置 `defaultActive: false` 的工具；已经激活的工具保持激活。活动集合没有变化时不重设，避免重建系统提示。
3. 模型直接调用的工具由 `agent.beforeToolCall` 检查；工具通过 `ctx.executeTool` 发起的调用（如 codemode 脚本调用 MCP 工具）由 tool_call 事件检查。超出范围时拒绝调用，并提示使用已列出的工具。
4. 第一次请求时扩展可能扩大了声明给模型的工具，但第 3 步的检查仍会拒绝越界调用。

### MCP 工具名

Pi 把 MCP 服务的原始工具名规范为 `mcp__<server>__<tool>`：字母、数字、下划线以外的字符换成下划线；超过 64 字符或规范化后重名时加哈希后缀。例如 Context7 的 `query-docs` 对应 `mcp__context7__query_docs`。tools 和 disallowed_tools 使用规范名。

Windows 上 Pi 1.5.0 与 Context7 MCP 4.5.0 支持 stdio 发现、直接调用、codemode 调用及晚注册；child 结束时关闭服务进程。见 [集成验证范围](../../finished/pi-suite/agents/windows-context7.md)。

## 技能与提示

skills 取值：

| 值 | 效果 |
| --- | --- |
| true（默认） | 使用 Pi 的技能发现、配置与启用规则 |
| false | 不加载技能 |
| 名单 | 从 Pi 发现的技能中按名称精确选择，完整 SKILL.md 以 `# Preloaded Skill: <名称>` 写入系统提示；其他技能不进入提示。名称不存在时报 AGENT_CONFIG（`skill <名称> is not enabled or available`） |

系统提示按顺序由以下部分组成，空段省略：

1. prompt_mode=append 时，父会话当前系统提示的稳定前缀：截掉最后的 `<cwd>` 段及紧邻其前的 `<skills>` 段（`resources/prompts.ts` 的 `inheritableParentPrompt`，来自上游）。
2. `<active_agent name="<类型>"/>`。
3. 类型正文。
4. memory 段。
5. 预加载的技能。

child 自己的技能、cwd 和扩展段由 Pi 渲染。child 不加载项目 AGENTS.md 等上下文文件、提示模板、主题或 APPEND_SYSTEM.md。

inherit_context 为 true 时，把启动时父会话当前分支中的用户和 assistant 文本、压缩摘要拼成 `# Parent Conversation Context` 段，放在本次任务之前；工具结果不包含。调度触发的 run 和 workflow 的固定 child resume 不附加。

isolated 为 true 时：不加载外部扩展和技能，忽略 `ext:` 选择器和 exclude_extensions，不注册嵌套工具。ask_user、task 和 job 工具仍按 [工具规则](#工具) 选择。

## Memory

memory 目录：

| 值 | 目录 |
| --- | --- |
| user | `<agentDir>/agent-memory/<类型>` |
| project | `<configCwd>/.pi/agent-memory/<类型>` |
| local | `<configCwd>/.pi/agent-memory-local/<类型>` |

- `MEMORY.md` 的前 200 行写入系统提示，超出部分截断并注明。提示要求把详细记忆写在目录中的其他文件，从 MEMORY.md 链接。
- 有效工具中有 write 或 edit（未被 disallowed_tools 禁用）时：创建目录，写入可写提示，并自动加入未被禁用的 read、write、edit。
- 否则：写入只读提示，只自动加入 read，不创建目录。
- MEMORY.md 不存在时提示中说明尚无记忆；其他读取错误会让启动失败。

## 包声明

`resources/packages.ts` 只读取 Pi `DefaultPackageManager.listConfiguredPackages` 返回的已安装包根目录，不安装依赖、不扫描 node_modules，也不按 `agents/` 目录惯例自动纳入。

`agents.packageAgents` 控制哪些包参与：

| 值 | 效果 |
| --- | --- |
| 缺省或 true | 全部声明了资源的包 |
| false 或空数组 | 不读取包 |
| 数组 | 按完整包名、短名或配置中的 source 匹配，不区分大小写 |

声明格式：

- 读取 `package.json` 的 `pi.subagents`，没有时读取 `pi-subagents`。
- 数组等同 `{ "agents": [...] }`；对象可含 `agents` 和 `workflows` 两个字符串数组。格式不对时报 AGENT_CONFIG。
- 每项是相对包根的文件或目录。目录只取直接包含的文件（类型取 `.md`，workflow 取 `.js`），按文件名排序。以 `!` 开头的项按精确路径排除。不支持 glob。
- 每个文件按真实路径检查必须位于包的安装根内，符号链接不能逃出；必须是普通文件且不超过 1 MiB。违反时报 AGENT_CONFIG。
- 包类型记录 packageName（manifest 的 name，缺省为 source）和 sourcePath。
- workflow 只纳入声明的路径；声明单个文件时，同目录的其他脚本不会纳入。workflow 名称、512 KiB 脚本上限、项目与用户优先级和 `agents.packageWorkflows` 见 [Workflow 宿主与资源](workflow/host.md)。

只提供类型或 workflow 的包应在 manifest 中声明 `pi.extensions: []`。没有 extensions 声明时，Pi 的扩展发现会按默认模块入口把包目录当作扩展加载。

[返回 agents](index.md)
