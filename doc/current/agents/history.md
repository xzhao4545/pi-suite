# 持久历史发现与只读查询

workspace 范围的查询会从 Pi 会话文件中找出当前配置工作区（`configCwd ?? ctx.cwd`）的 agent 历史，并合并到 `AgentManager` 的记录中。`AgentHistory`（`src/agents/history.ts`）只缓存文件解析结果。运行句柄、历史记录、handle/alias、模型覆盖和 job 归属都由 `AgentManager` 与已保存的记录负责。

## 发现范围

扫描以下目录中直接包含的 `.jsonl` 文件。目录不存在时跳过：

| 目录 | 说明 |
| --- | --- |
| `<agentDir>/sessions/*/` | SDK 按工作区编码的会话目录，包括这一层指向目录的符号链接 |
| 当前主会话的 sessionDir | `sessionManager.getSessionDir()` |
| `PI_CODING_AGENT_SESSION_DIR` | 环境变量 |
| Pi settings 的 sessionDir | 按 configCwd 和项目信任状态读取 |
| 类型的 `session_dir` | 当前信任与 `agents.packageAgents` 范围内的全部类型 |

自定义目录按 configCwd 解析，`~` 展开为用户主目录。

除了扫描这些目录，还会读取当前主会话的全部 entries（包括当前分支之外的），并沿持久引用继续读取其他文件：

| 引用 | 读取内容 |
| --- | --- |
| `pi-suite:agent-record` 的 sessionFile | 对应 child 会话文件中的全部 run 记录 |
| `pi-suite:workflow-record` 的 recordPath | workflow 快照中的 children 及各 child 的 sessionFile |
| `pi-suite:workflow-record` 的 children | 父级记录中保存的 child 及其会话文件 |
| 会话 header 的 parentSession | fork 来源的会话文件及其中的引用 |

默认扫描不会深入 `subagents/`。其中的 child、嵌套 child 和 workflow child 会话通过父级记录里的绝对 sessionFile 或 workflow 快照找到，所以不要求与主会话在同一目录。带工作区目录的引用仅在该目录等于当前工作区时跟随。

只保留 `configCwd ?? cwd` 等于当前工作区的记录。child 的工具 cwd 可以是其他目录，归属仍按 configCwd。既没有配置、也没有持久引用指向的目录不会被发现。

## 读取与合并

1. 每个文件按 mtime 和 size 判断是否需要重新解析。缓存按文件保存，不绑定某个工作区；每次查询时再按当前工作区筛选记录和引用。本次扫描未访问到的文件从缓存中移除。
2. 主会话通过 `sessionManager.getEntries()` 读取。磁盘会话文件由 `records.ts` 的 `readAgentSession` 读取：先用 Pi 的 `parseSessionEntries` 解析，再用 `SessionManager.inMemory` 完成版本迁移和树构建。查询不走 SDK 打开磁盘文件时的修复路径，不修改原始 JSONL。显式恢复执行时仍使用 SDK 的正常会话路径。
3. 同一 runId 的多条记录按 custom entry 的 timestamp 合并，较新的字段覆盖较旧的：
   - workflow 快照不含 result 正文，合并时保留已有的 result。
   - 较新的记录是活动状态、较旧的已结束时，保留结束时的 state、endedAt、endLeafId 和 error，避免启动时的引用把终态改回活动状态。
4. 合并进 `AgentManager` 时：本进程中存在 `Execution`（单次 run 的运行对象）的 run 不使用发现结果；已有历史记录只在发现结果的 updatedAt 更新时才被替换。本地恢复或模型编辑写入的记录 updatedAt 为写入时间，因此不会被更早的文件覆盖。

发现只补充记录，不新增会话数据库、handle 注册表或通知 owner。

### 中断的运行

保存的状态仍是活动状态、但本进程没有对应 `Execution` 时，记录改为 failed：

| 情况 | error | endLeafId |
| --- | --- | --- |
| 有 sessionFile | 提示用 agent_read 读取保存的 transcript | 该会话文件当前的叶子 |
| 无 sessionFile | 提示没有保存 transcript，可以新建 agent | 不变 |

这些记录不计入活动数量，不触发完成通知。阅读它们不会改变 ownerSession、anchor、parentRunId 或 ancestors。

## 错误

以下情况报 AGENT_HISTORY，不跳过：

| 情况 | 消息 |
| --- | --- |
| JSONL 中有无法解析的行 | `Malformed session JSONL in <路径>` |
| header 缺失、字段不对，或版本高于当前 SDK 支持的版本 | `Invalid or unsupported session header in <路径>` |
| agent 记录数据不符合 schema | `Invalid agent record version or data in <来源>` |
| suite entry 的 timestamp 无法解析 | `Invalid suite record timestamp in <来源>` |
| 指定 run 的 endLeafId 在会话文件中不存在 | `Missing history leaf <id> in <路径>` |

workflow 父级记录无效时报 WORKFLOW_HISTORY；workflow 快照无效时也会报错。持久引用指向的文件不存在或无法读取时，读取错误直接抛出。

读取指定 run 的 transcript 时，先检查 endLeafId 存在，再读取到该叶子为止的分支；叶子错误时报错，不会改为读取整份文件的最新输出。非持久 transcript 的读取与恢复范围见 [执行引用回收](runtime.md#执行引用回收)。

## 查询与操作归属

- `agent_list({scope:"workspace"})` 和 `/subagents workspace` 先发现历史，再按已有筛选与分页读取。
- agent_get、agent_read、agent_send、agent_stop 遇到本进程不认识的 ID 时，先发现历史，再检查记录属于当前工作区，否则报 NOT_FOUND。agent_send 另外检查调用方是直接父级且记录在当前分支；被发现的历史不会因此获得发送或恢复权限。
- 原生 workspace 菜单中，其他 owner 的记录或当前分支之外的已结算记录只提供 Transcript 和只读 Jobs。查看器保留阅读、Tools/Thinking 展开、Jobs 和 Back。Jobs 复用 job 详情和日志，隐藏 attach 和 stop；无法查询 job 的创建归属时报错。
- 当前 owner 和分支可见的已结束记录仍可修改之后恢复使用的模型覆盖，或在记录菜单中清理遗留 job。
- 本进程的运行句柄保持原有控制方式。agent_stop 工具按当前工作区和运行子树处理，嵌套调用只能操作直接 child。

完整命令、默认筛选和键位见 [工具与操作](operations.md)。

[返回 agents](index.md)
