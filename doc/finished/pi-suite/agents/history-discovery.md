# 工作区持久历史发现与只读查询阶段

AgentHistory 使用 Pi 公共会话解析与内存树发现持久记录，仅缓存文件 mtime/size 与解析结果。发现范围包括默认 sessions 下一层工作区目录、当前主会话目录、环境/设置/当前类型配置的 session_dir，以及可达的普通 child、workflow 快照/child 与 SDK parentSession 引用；不承诺未配置、没有持久引用的任意外部归档目录。

workspace 记录汇总完整会话树的全部分支，保留 runId、owner/anchor、handle/alias、configCwd、最终结果、结束叶子与 job 祖先归属。相同 run 按保存时间合并，较新的缺正文 workflow 引用或启动状态不覆盖最终结果/终态；Manager.runs 保持权威，histories 的更新时间保留本地 restore/模型编辑的新事实。

新增异步 discover/lookup；workspace 列表主动发现，未知 ID 的查询、读取、发送和停止先发现并核对当前配置工作区，发送继续使用直接父级/分支准入。/agents 的 Workspace records 与 `/agents workspace [active|queued|finished|all]` 默认显示 all，分页后保留工具 scope，原生选择使用 runId。其他 owner 或当前分支之外的已结算记录菜单只提供 Transcript，查看器隐藏修改动作；当前可见记录保留模型覆盖和遗留 job 清理。

磁盘读取使用 parseSessionEntries 与 SessionManager.inMemory，查询不触发 SDK open 的修复写入；缺失/未来 header、损坏 JSONL、无效记录/时间戳、不可读取的 child 引用与错误结束叶子明确报错。没有本进程 Execution 的保存活动状态规范为 failed，不计入活动数量，不产生或转移通知。显式恢复使用既有 SDK 执行路径，阅读不启动模型。

history.ts 为本项目通过 Pi 公共存储 API 编写的发现能力，不计作上游直接源码导入；来源与适配边界见 [上游登记](../../../../third-party/UPSTREAM.md)。稳定事实维护在 [持久历史](../../../current/agents/history.md) 和 [操作说明](../../../current/agents/operations.md)。更广的启动/停止竞争、平台及综合生命周期继续由 [运行记录专项](runs.md) 与 [扩展专项](../../../todo/pi-suite/index.md) 管理。

Linux（Node 24.22.2）新增 5 项聚合检查通过，覆盖持久 owner/类型目录/目标 cwd 发现、普通与 workflow 引用、历史叶子及分页、父级/分支发送与原生只读控制、只读存储错误和中断 owner、跨工作区缓存引用及本地编辑/真实执行优先。全量 134 项检查通过、耗时 13.00 秒；收尾变更通过 agents 53 项影响范围复核、耗时 6.16 秒，最新类型检查通过。Windows 与更广的生命周期竞争仍按对应专项验收。

[返回已完成专项](../../index.md)
