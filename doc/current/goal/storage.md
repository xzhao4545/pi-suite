# 单一当前状态存储

[返回目标管理](index.md)

## 作用域与文件

GoalStore 按 `getAgentDir()` 与主会话 ID 隔离，使用 `<getAgentDir()>/pi-suite/goals/session-<编码后的sessionId>/state.json`。会话 ID 由 `encodeURIComponent` 编码并加固定目录前缀，支持 SDK 自定义 ID，不能通过 `.`、`..` 或路径分隔符离开所属目录。无持久会话只使用该会话的内存 Store。

每会话只保存一份当前文件：`version: 1`、`sessionId`、单调 `control` 和 `goal`。目标字段、三态和运行许可见 [生命周期](lifecycle.md)。替换目标覆盖同一文件；clear 写入 `goal: null`，不保留被清除目标。UI、用量和状态恢复都使用这份当前状态，不建立快照集合、计量日志或权限副本。

同会话所有 tree 叶子共用当前目标、修订、用量、进度、预算与暂停许可。树选择只撤销出站 Binding、待交付继续请求与等待资源，再绑定当前 Store；不会按所选历史恢复过去目标。new/fork 使用独立会话 ID，默认没有 Goal；复制的历史目标说明不提供执行许可。child 不继承父 Goal 控制权。

## 原子修改与计量

复用公共 JsonStore 的串行入口、文件锁、锁内重读、复制修改、原子替换与目录观察。控制操作在锁内检查目标 ID、正文 revision、control 及 Binding，基于最新状态执行；过期控制返回 `GOAL_STALE`，不能覆盖较新的 pause、clear、edit、replace 或 resume。

响应计量只在所属 Binding 有效且目标 ID 仍相同时累加 `usedTokens` 与 `turns`，不写生命周期或恢复许可。文本修改后的在途响应用量保留；暂停后的计量不能复活目标，替换或 clear 后不能计入新目标。跨宿主累计与控制更新共享同一文件锁。Store 订阅发现 ID/revision/control 变化时撤销过期运行与等待资源，不自动授予新许可。

创建、修改、暂停、恢复、等待、完成与退出均等待必要提交后返回成功或交付新工作。无变化不写文件；UI 时钟只读当前有效运行片段。损坏 JSON/schema、会话归属错误、读取、锁和写入失败明确上报，不覆盖坏文件，不从历史回退，也不启动自动续跑。原子保存的临时文件和锁在公共机制中回收。

缺失文件读取为空的未初始化状态，不把缓存中的旧 Goal 当作磁盘现状。恢复在同一锁内完成首次初始化；已有当前文件（包括 clear 的空状态）始终优先于历史。

## 一次性导入

首次恢复且没有当前文件时，通过公开 `getEntries()` 取全会话物理追加顺序最后一条 `pi-suite:goal`，不使用所选分支。最新条目损坏时拒绝导入，不挑更早的有效目标掩盖错误。没有旧条目或最新条目为 `goal: null` 时写当前空状态。

旧 snapshot version 1/2 在解析出口迁移为当前三态与许可，保留 ID、revision、用量、耗时、进度、完成证据及暂停诊断。导入后的未完成目标在冷启动仍要求显式 resume。new/fork 不导入复制历史；初始化提交成功后才完成迁移。

原始 JSONL 的旧快照、恢复回执、parentId、compaction 与 context_edit 保持原样。它们只作为历史记录展示，不是状态或权限来源；Goal 不追加状态快照或计量条目，也不通过 compact 物理删除历史文件。
