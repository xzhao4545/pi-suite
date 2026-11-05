# 持久历史发现与只读查询

AgentManager 的 workspace 查询从 Pi 会话文件和既有 suite 记录发现当前配置工作区的历史。AgentHistory 只缓存文件解析结果；运行句柄、历史记录、handle/alias、模型覆盖与 job 归属仍由公共 Manager 和既有记录承载。

## 发现范围

默认扫描 `<agentDir>/sessions` 下一层 SDK 工作区编码目录中的 `.jsonl`，包括该层指向会话目录的符号链接。额外扫描当前打开主会话的 sessionDir、`PI_CODING_AGENT_SESSION_DIR`、SettingsManager 的 sessionDir 配置，以及当前信任/包门控范围内 catalog 类型的 `session_dir`；各配置目录读取其直接子级 `.jsonl`，自定义目录按当前 configCwd 解析。

扫描主会话的全部 entries，包含当前分支之外的记录，并沿以下持久引用继续发现：

| 引用 | 读取范围 |
| --- | --- |
| pi-suite:agent-record.sessionFile | 对应 child SDK 会话中的全部 run 记录 |
| pi-suite:workflow-record.recordPath | 既有 workflow 快照中的 children，以及各 child.sessionFile |
| pi-suite:workflow-record.children | 保存于父级记录的 child 引用及其 SDK 会话 |
| SDK session header.parentSession | fork 的父会话文件及其引用 |

最终记录按 `configCwd ?? cwd` 归入当前配置工作区。child 的实际工具 cwd 可以是其他目标目录，查询仍按 configCwd 归属。发现范围是默认目录、当前配置目录及上述可达引用；未配置且没有持久引用的外部归档目录不参与发现。

## 读取与合并

发现扫描以文件 mtime 和 size 判断是否重新解析，缓存归属于文件，查询时再按工作区筛选记录和引用。主会话使用公共 getEntries；磁盘会话使用公共 parseSessionEntries 和 SessionManager.inMemory 完成版本迁移、树构建和分支读取。查询不会调用 SDK 的磁盘 open 修复路径，也不修复或重写原始 JSONL；显式恢复开始新执行仍使用 SDK 的执行会话路径。

同一 runId 的保存记录按 custom entry timestamp 合并。workflow 引用或快照没有 result 正文时保留已有最终结果，较新的启动引用不能把终态退回活动状态。Manager.runs 中的真实 Execution 始终优先；已有 histories 附 updatedAt，使本地 restore 或模型编辑的新事实不会被更早文件覆盖。发现只补充记录，不新增会话数据库、独立 handle 注册表或通知 owner。

没有本进程 Execution 的保存活动状态规范为 failed，错误说明运行 owner 已中断；保存的 transcript 仍可读取，其结束位置绑定持久文件的叶子。这些记录不计入活动数量，不触发完成通知，也不因阅读转移 ownerSession、anchor、parentRunId 或 ancestors。

## 数据与叶子边界

缺失或未来版本的会话 header、损坏 JSONL、无效 agent/workflow 记录数据与 suite entry timestamp、不可读取的持久 child 引用均明确报错。读取指定 run 的 transcript 时验证 endLeafId 存在，再读取该分支；错误叶子不能回退为整份文件的最新输出。非持久 transcript 的读取与恢复范围遵循 [Execution 回收规则](runtime.md#执行引用回收)。

## 查询与操作归属

`agent_list({scope:"workspace"})` 和 `/agents workspace` 先发现历史，再按既有筛选与分页读取。未知 ID 的 agent_list、agent_read、agent_send 和 agent_stop 使用公共 lookup 发现，并核对当前 configCwd；agent_send 继续核对直接父级与当前分支，发现历史不赋予发送或恢复权限。

原生 workspace 菜单中，其他 owner 或当前分支之外的已结算记录提供 Transcript 和只读 Jobs；其查看器保留阅读、Tools/Thinking 展开、Jobs 和 Back。Jobs 复用 job 详情和日志，隐藏 attach 与 stop，创建归属查询不可用时明确报错。当前 owner/分支可见的结束记录仍可修改之后恢复使用的模型覆盖，或通过记录菜单清理遗留 job。真实运行句柄保留既有控制契约；工具 agent_stop 仍按当前工作区和运行子树处理，嵌套调用保持直接 child 准入。

完整命令、默认筛选和键位见 [工具与操作](operations.md)。

[返回 agents](index.md)
