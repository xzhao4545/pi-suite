# 公共运行时与配置

扩展入口是 `src/index.ts`，`src/runtime` 提供各模块共用的配置、会话绑定、通知、等待、工具注册和 JSON 存储。

| 页面 | 内容 |
| --- | --- |
| [模型工具契约](tools.md) | 共享 ID、列表、读取、等待、停止的参数与返回，工具显示，错误码 |
| [设置与退出操作](settings.md) | `/suite` 设置页与 `/exit` |
| [Responses 历史 ID 恢复](responses-recovery.md) | `runtime.openAIResponsesAutoRecovery` |

## 入口与注册

1. `src/index.ts` 在扩展工厂中注册 CLI 提示参数（`runtime/cli-prompt.ts`）和全部工具/消息 renderer（`runtime/renderers.ts`）。
2. 首次 `session_start` 导入 `runtime/suite.ts`，`createSuite` 按该会话的 cwd 读取配置，注册已开启模块的工具、命令和事件处理器，然后返回 `bindSession`。
3. 之后每次 `session_start`（reload 除外，见下）都等待同一个 `createSuite` 结果，再调用 `bindSession` 重新绑定。

模型工具：ask_user、goal_complete、goal_blocked、goal_wait、task_list、task_get、task_edit、job_start、job_list、job_get、job_read、job_write、job_stop、agent_start、agent_list、agent_get、agent_read、agent_send、agent_stop、agent_workflow 和共享的 wait。命令：/goal、/tasks、/jobs、/subagents、/suite 和 /exit（`commands.exit`，默认开启）。

`runtime/tools.ts` 的 `registerBoundTool` 是所有模块注册工具的入口：

- 首次加载（`'initial'`）直接注册。
- 绑定时刷新描述或 schema 会先读取当前活动工具，重新注册后恢复该选择；只有显式要求启用时才把本工具加入活动列表。
- agent_start 的调度 schema 和 agent_workflow 的类型列表描述都通过它刷新。

## 配置

配置按三层逐节、逐字段合并，后者覆盖前者：

| 层 | 路径 |
| --- | --- |
| 内置默认 | `runtime/config.ts` 的 `defaults` |
| 用户 | `<agentDir>/pi-suite.json`；agentDir 为 Pi 的 `getAgentDir()`，遵循 `PI_CODING_AGENT_DIR` |
| 项目 | `<会话 cwd>/.pi/pi-suite.json`，不向父目录查找 |

`jobs.agents` 按 CLI 键、`agents.types` 按类型名再逐字段合并。文件不存在表示该层无覆盖。JSON 无效、出现未知字段、数值越界或读取失败（如权限错误）时报错，不静默忽略。

```json
{
  "commands": { "exit": true },
  "modules": { "ask": true, "tasks": true, "jobs": true, "goal": true, "agents": true },
  "runtime": { "openAIResponsesAutoRecovery": false },
  "ui": { "maxRows": 12, "highlightBuiltinCommands": true },
  "ask": { "timeout": 600000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "tasks": { "reminders": true },
  "agents": { "display": "status", "maxConcurrent": 10, "maxConcurrentForeground": 0, "maxDepth": 3, "persistSessions": true,
    "types": {}, "mentions": true, "scheduling": true, "workflows": true },
  "jobs": { "display": "status", "detachKey": "ctrl+]", "returnKey": "ctrl+g", "transferKey": "ctrl+t" }
}
```

### 生效时机

- `createSuite` 用首次 `session_start` 的 `modules.*` 决定注册哪些模块。修改后需 `/reload`；new、resume、fork 和树切换只重新绑定，模块集合不变。
- 重新绑定时按当前 cwd 重读配置。设置如何应用，见[设置与退出操作](settings.md)。
- StatusPublisher（状态栏发布器）的 goal 状态键只在本次实际创建了 GoalManager 时由本扩展写入和清除，重新绑定时配置值变化不改变这一点。
- `modules.jobs=false` 只撤销 job 工具、/jobs 和 Dock 入口。agents 仍需要查询和查看自己创建的 job，所以 `modules.agents` 开启时照样加载 jobs 代码；quit 清理也不依赖该开关，见 [jobs 结算与停止](../jobs/index.md#结算与停止)。

### 字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `commands.exit` | true | 注册 /exit，见 [设置与退出操作](settings.md) |
| `modules.ask/tasks/jobs/goal/agents` | true | 模块开关 |
| `runtime.openAIResponsesAutoRecovery` | false | 见 [Responses 历史 ID 恢复](responses-recovery.md) |
| `ui.maxRows` | 12 | 空闲 Dock 最多行数，1–30；询问另用 70% 终端高度上限，见 [统一界面](../ui/index.md#高度与状态) |
| `ui.highlightBuiltinCommands` | true | 内置 bash/powershell 调用区的命令高亮，见 [设置与退出操作](settings.md) |
| `ask.timeout` | 600000 | 用户空闲多久后询问超时，整数毫秒 0–2147483647；0 不设期限 |
| `ask.historyKey` | ctrl+h | 询问历史键 |
| `goal.display`、`agents.display`、`jobs.display` | status | status、dock 或 hidden；不接管 footer |
| `tasks.reminders` | true | 任务提醒，见 [任务操作](../tasks/operations.md) |
| `jobs.detachKey` | ctrl+] | 终端视图：离开视图。默认避开 tmux 前缀 Ctrl+B |
| `jobs.returnKey` | ctrl+g | 终端视图：把输入交还模型 |
| `jobs.transferKey` | ctrl+t | 终端视图：把屏幕发送给模型 |
| `jobs.agents` | 内置预设 | CLI 键对应的 command 与 args，见 [CLI 预设与直接启动](../jobs/launch.md) |
| `agents.maxConcurrent` | 10 | 后台 child 并发上限，≥1 |
| `agents.maxConcurrentForeground` | 0 | 前台并发上限，0 为不限 |
| `agents.maxDepth` | 3 | 包含顶级在内的会话层数，≥1 |
| `agents.persistSessions` | true | 顶级 child 是否保存会话到磁盘 |
| `agents.defaultModel` | 无 | 默认模型 |
| `agents.types.<类型名>` | {} | `enabled`、`model`、`thinking` 覆盖，见 [类型配置](../agents/models.md) |
| `agents.packageAgents` | 无（全部声明包） | boolean 或包名/source 数组；false 或空数组关闭，见 [类型与资源](../agents/resources.md) |
| `agents.mentions` | true | TUI 的 @handle 投递与补全，见 [agents 操作](../agents/operations.md) |
| `agents.scheduling` | true | agent_start 的 schedule 参数、计时器和 Scheduled agents 菜单，见 [定时调度](../agents/schedules.md) |
| `agents.workflows` | true | agent_workflow 和 Workflows 菜单，见 [Workflow 操作](../agents/workflow/operations.md) |
| `agents.packageWorkflows` | 无（全部声明包） | boolean 或包名/source 数组 |

按键字段使用 Pi 的按键标识（`ctrl`/`alt`/`shift`/`super` 修饰加按键名），修改后 `/reload`。`/subagents types` 也能编辑 `agents.types`，保存后立即生效，见 [类型配置](../agents/models.md)。

### JSON 存储

`runtime/json-store.ts` 的 `JsonStore` 是 ConfigStore、TaskStore、GoalStore、ScheduleStore 和 WorkflowStore 的基类。各 Store 自己定义 schema 和修改规则。

每次修改（`mutate`）的步骤：

1. 进入本实例的串行队列。
2. 以 `wx` 创建跨进程锁 `<文件>.lock`（权限 0600），写入 `pid:uuid`。最多尝试 100 次；持有者仍存活时等待 50 ms。持有者进程已退出，或到第三次尝试仍读不到有效 PID 时，核对内容后回收锁。仍拿不到锁时报 `<前缀>_LOCK_TIMEOUT`。
3. 在锁内重新读取文件，复制一份后应用修改并校验。
4. 写入 `<文件>.<uuid>.tmp`（权限 0600），再原子重命名为目标文件。
5. 只删除内容仍为自己 token 的锁文件。

其他规则：

- 文件缺失时默认使用当前内存值，Store 可以提供空值工厂（`missing`）。设置 `skipUnchanged` 后，修改没有改变文件内容时跳过写盘，只有内存值变化才通知订阅者。GoalStore 同时使用两项，见 [Goal 存储](../goal/storage.md)。
- 快照（`snapshot`）在 Windows 上也取同一把锁，因为读句柄未关闭时目标文件不能被原子替换；文件缺失时不创建目录、锁或数据。
- Windows 上正在删除的锁文件会短暂返回 EPERM；只有锁的创建和读取把它当作等待。数据的读取、解析和保存错误照常上报。
- 文件无法解析时报 `<前缀>_STORE_INVALID`，保留内存中已有的有效数据，不覆盖文件。
- 订阅外部变化时监视父目录（目标文件每次提交都会换 inode），目录尚未创建时监视最近的已存在祖先目录；变化后 25 ms 重新快照。

其他 JSON 文件（jobs 的 job.json、terminal.json 等）同样先写临时文件再重命名，但不取跨进程锁。

## 宿主加载边界

| 项 | 当前值 |
| --- | --- |
| 支持的宿主 | 官方未修改的 Pi 1.5.0 及更高版本；插件随 Pi 版本更新跟进适配 |
| 依赖 | `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui` 的 peer 依赖为 `>=1.5.0`；开发依赖精确为 `1.5.0`，作为开发与测试基线 |
| 加载入口 | Pi 包的 `pi` bin 为 `dist/bundle/cli.js`，`./rpc-entry` 为 `dist/bundle/rpc-entry.js`；regular/fullscreen 与 RPC 均可加载 |
| 发布 | `package.json` 为 `private: true`，未发布到 npm |
| 未验收 | Git、本地路径和 tarball 安装；开发基线以外的 Pi 版本 |

- 官方 bundle loader 通过虚拟模块向扩展提供宿主的类定义，SDK 入口按原版模块解析加载。Suite 不修改宿主，也不做模块身份适配。
- UI 只用公开的 Container、ScrollView、VStack/HStack 和 focused overlay，见 [统一界面](../ui/index.md#原生会话查看)。
- 子代理启动时通过带守卫的私有结构读取父模型运行时，见 [模型运行时桥接](../agents/models.md#模型运行时桥接)。
- `/reload` 只重载扩展，不替换已载入的宿主模块；依赖升级后要重启 Pi。
- Responses 会话的持久化、resume 和跨模型消息转换都使用 Pi 1.5.0 原版协议：同 provider/api/model 的文本签名保留 message ID 与 commentary/final_answer phase；跨模型时按原版规则移除文本签名和不适用的 thinking。可选的恢复功能见 [Responses 历史 ID 恢复](responses-recovery.md)。

## 加载与首次就绪

`createSuite` 只导入已开启模块的代码，并按顺序逐个导入：Pi 用 Jiti 加载扩展，共享依赖被并发导入时可能暴露未完成的导出。注册在 `session_start` 返回前全部完成，所以首次请求就能用到全部工具、调度、RPC 和补全。

以下部分在首次使用时才导入：

| 部分 | 首次导入时机 |
| --- | --- |
| Tasks 查看器（tasks/viewer.ts） | 首次交互 `/tasks` 或打开 Dock 任务详情；tasks/commands.ts 只注册命令和非 TUI 文本查询 |
| Goal 详情（ui/details.ts） | 首次打开详情；/goal 控制命令不依赖它 |
| Jobs、Subagents 查看器 | 首次打开 |
| Ask 界面 | 首次询问 |
| `/suite` 设置页 | 首次执行命令 |
| PTY 后端 | 首次启动 PTY job |
| child 执行代码（agents/runner.ts、child.ts） | 首次启动 agent |
| workflow 运行代码 | 首次启动 workflow |
| Responses 恢复 | 配置开启时在 `createSuite` 中导入；关闭时不导入 |

异步打开的入口先记下当前 `Binding`（`SessionBinding` 的一次绑定），导入完成、任务读取完成和用户返回选择后再检查它是否仍是当前绑定，Tasks 还检查取消信号。绑定已变时不挂载页面，也不改动新绑定的 Dock。导入失败从原命令或工具的错误路径报告。

每次绑定为 workflow 描述和 mentions 共用一份类型目录快照；mentions 关闭或非 TUI 时不为补全做类型发现。类型保存、显式发送刷新、reload 和会话/分支绑定会刷新这份快照。UI 时钟只读取 Manager 的内存元数据，不扫描历史文件或日志。

### renderer 提前注册

会话历史在 `session_start` 之前就会重绘，所以 `registerSuiteRenderers` 在扩展工厂中注册全部工具 renderer，不等模块注册：

- `runtime/tools.ts` 的 `registerToolRenderers` 按 ExtensionAPI 保存一份 WeakMap 显示映射。提前注册、只读查询（`toolRenderer`）和 `registerBoundTool` 共用它；主会话和 child 的 ask_user 可分别登记不同的 renderer。
- agents/render.ts 和 wait-render.ts 只依赖 agents/registry.ts 查询 agent 名称：读取本 agentDir 已有的进程内 owner，没有 owner 时显示原 ID，不创建 AgentManager 或 jobs 运行时，也不扫描磁盘。
- 资源路径展开使用 agents/resources/paths.ts，history 与 runner 共用，不为查路径加载 child 资源加载器。

## 会话和通知

### 会话绑定

`SessionBinding`（`runtime/binding.ts`）保存当前主会话的 ctx、会话 ID 和递增的绑定序号。各模块用 `isCurrent` 判断异步结果是否仍属于当前绑定。

| 事件 | 处理 |
| --- | --- |
| `session_start` | 先撤销旧的读取器、计时器和询问，重读配置（首次除外），再建立新绑定并依次绑定各模块，最后尝试投递通知 |
| `session_tree` | 与重新绑定相同，但不向所选分支写入离开分支的状态；Goal 重新读取该会话唯一的当前目标，不按分支恢复。然后检查 idle 投递 |
| `session_shutdown` | 保存目标、取消询问、清除本扩展的 UI、撤销绑定。reason 为 quit 时，按当前 agentDir 查找进程中已有的 jobs、agents 和 workflow owner 并等待它们真正清理完毕；模块全部关闭时也执行，且不创建新 owner |

旧绑定排队的询问不会在新会话中显示。

### reload 与执行 owner

agents 和 workflow 的 owner（持有运行中 child 和 workflow 的对象）按 agentDir 保存在进程全局槽位，`/reload` 后仍在。`runtime/owner.ts` 给每次模块加载一个独立的实现标识 `implementation`，新代码调用 `acquireOwner` 时：

| 已有 owner | 结果 |
| --- | --- |
| 同一次加载创建 | 直接复用 |
| 其他加载创建且空闲 | 关闭它，用当前代码新建 |
| 其他加载创建且忙碌（含依赖它的 workflow 在运行） | 保留，原有执行和通知继续；每次绑定提示一次，新执行返回 `RUNTIME_UNAVAILABLE`。等工作结束、结果送达后再 `/reload` |
| 没有实现标识或无法报告是否忙碌 | 同忙碌处理，提示需要重启 Pi |

旧 owner 带着旧代码的闭包，所以不能直接复用。Jobs 有独立的协议版本与控制桥，见 [jobs](../jobs/index.md#协议升级与控制桥)。

### 通知投递

`Notifications`（`runtime/notifications.ts`）汇总 job、agent、workflow 的结果和 Goal 自动续跑消息。只读界面不发送模型 follow-up。

- 消息按主会话 ID 排队，同一请求 ID 的未投递消息被新消息替换。非当前会话的消息保留到该会话重新绑定。
- 询问与目标详情打开期间持有阻塞令牌（`hold()`），暂不投递。
- Goal 通过 `setAdmission` 根据队列中的请求 ID 决定本批能否唤醒模型。只有自动运行中的目标会暂缓通知（等待用户，或 `goal_wait` 指定的对象尚未结算）；目标暂停、完成或不存在时通知照常投递，唤醒轮的目标 `access` 为 `none`，不恢复目标。

投递时机：

1. 空闲投递（`flush`）：当前绑定存在、无阻塞令牌、宿主 idle 且没有待处理消息、Goal 允许时，以 followUp 发送一条消息并触发新一轮。
2. 轮次结算（`agent_before_settle`）：先计算 Responses 修复，再交给 Goal，最后由通知处理。outcome 为 completed、宿主没有已安排的继续、也没有待处理消息时，把合并消息追加到原有 entries 之后，请求继续一次；否则留到下一个边界。
3. `agent_settled`：Goal 确认最终结果后再尝试空闲投递。
4. 手动压缩和树切换：Pi 1.5.0 在 busy 标记清除前就发出这两个成功事件，所以此时若有待投递消息，每 25 ms 检查一次 idle，绑定变化后停止。

### 通知消息格式

一次投递是一条 customType 为 `pi-suite:notification` 的 custom_message：

- content 是文本块列表；`details` 为 `{ notificationVersion: 1, segments }`，segments 与文本块一一对应，每项记录 requestId、source 和可选的显示视图 `view`（`{title, state?, meta?, body?}`），不重复保存给模型的正文。job 的 quiet 投递保留字符串 content 与 nextTurn 投递方式，只附加同样的 details。
- 提供 view 的来源：agent 结果（`Agent result`）与提问（`Agent question`）、job 结果（`Job result`）、job 更新（`Job update`）、监控事件（`Job events`）、workflow 结果（`Workflow result`）和 schedule 失败（`Schedule failed`）。
- source 取值：`event`（真实结果、提问、更新）、`goal-continuation`（Goal 自动续跑）、`reminder`（不唤醒模型的提醒）。
- 一批中既有真实事件又有 Goal 续跑时，只发送真实事件的正文；Goal 的交付回调仍执行一次。只有 Goal 续跑时消息不显示。
- 已交付的正文保留在会话中，不通过 context 事件删除旧的 Goal 控制文本；没有 segments 的历史消息不做文本清洗。
- 显式 `/goal resume` 的显示条目只保存短结果，完整状态看当前 Goal。Goal 的说明文本、续跑规则和五轮自动停跑见 [请求与续跑](../goal/context.md)。
- Tasks 提醒在自然的 turn_end 以同一格式追加，source 为 reminder，不请求模型继续。

`notification-render.ts` 渲染这类消息：

- segments 缺失、版本不符或数量与文本块不一致时交给 Pi 默认渲染；含非文本块（如图片）时同样交给 Pi，不丢弃图片。
- Goal 续跑段不显示；全部为续跑时显示空容器。
- 有 view 的段折叠时占一行：标题、按状态着色的 state 和 meta；展开后在该行下显示 body 字面量。没有 view 的段按清理后的原文显示。

### 共享等待

`WaitRegistry`（`runtime/wait.ts`）为 wait 和 goal_wait.waitFor 提供等待，接受 job_、agent_ 和 wf_ ID，参数见 [模型工具契约](tools.md#共享参数与返回)。

- 结果按 `(id, runId)` 区分。等待同一 agent 的新 run 时，旧 run 未读的结算放入 others，以 reason=other 提前返回，只消费旧结果，新 run 留在 pending。
- job 与 workflow 没有 runId，按 ID 区分；monitor 事件和 hands-free 更新按各自计数消费，不消费结果本身。
- wait 把返回的结果标为已读，并撤销其待投递通知。
- 用户插话（非扩展来源的 steer 输入）结束等待；在等待开始前已排队的插话也会让等待立即返回。
- 已取消的 signal 在入口直接拒绝；等待中取消只结束等待，不停止 child 或进程。

### 其他公共工具

- `runtime/text.ts` 的 `sanitizeText` 去除终端控制序列和控制字符，保留换行和制表符；任务说明、pipe 日志和 monitor 事件共用。PTY 的回车覆写等语义由 jobs 终端模块处理。
- `runtime/clipboard.ts`：在 tmux 内的 TUI 会话中，绑定时把 tmux 的 `set-clipboard` 设为 on，使 Pi 的 OSC 52 复制生效；tmux 客户端不支持 clipboard 特性时发出警告。
- `runtime/cli-prompt.ts`：`--suite-prompt` 参数携带原文初始提示。只在 startup 时生效；交互输入以 `pi-suite:cli-prompt` 结尾时，把该标记替换为参数原文，保留前面的 @file 附件文本。这样绕过 Pi 1.5 在输入钩子之前对 @file 的解析。

[返回当前文档](../index.md)
