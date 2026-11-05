# 任务存储与会话

持久会话的任务文件为 `<cwd>/.pi/tasks/tasks-<sessionId>.json`；未持久化的会话只使用进程内存，reload 复用该会话的清单。没有任务写入的会话不创建任务目录或文件。

## 数据与提交

存储版本为 1，封装包含 version、nextId、tasks。任务记录包含 id、title、可选 description、可选 parentId、子任务 status、blockedBy、可选 owner、jobIds、createdAt、updatedAt。父级进度与反向依赖属于查询派生数据。

同一 Pi 进程通过目标键取得同一个 TaskStore，每个目标的读写串行执行。持久化修改取得 `<file>.lock`，在锁内重读最新文件、复制数据并处理整个批次，再写唯一临时文件和原子重命名；校验失败或提交前取消不修改原文件和缓存。

锁令牌为 pid:uuid，以排他创建取得。等待使用 50 ms 的异步重试，最多约 5 秒；死进程的锁可回收，空令牌先容忍短暂写入窗口。释放前校验完整令牌，避免删除后继持有者的锁。进程身份按本机 PID 表判定。

读取时校验 schema、唯一短 ID、nextId 与两级父子关系；无效 JSON、版本或结构返回 TASK_STORE_INVALID，保留已有有效缓存并禁止覆盖错误文件。文件锁超时返回 TASK_LOCK_TIMEOUT。缺失文件表示当前目标尚无持久数据。

## 会话边界

- new 使用独立会话清单。
- resume/reload 按当前 cwd 和会话 ID 取得原清单，不重新分配 ID。
- fork 从 previousSessionFile 的会话头定位父清单，以包含 nextId 的完整快照播种新清单；子清单修改不影响父清单。已经使用过的新清单不会重新播种。
- cwd 改变时重新定位存储，不把另一工作区的清单写入当前文件。
- 会话撤销时解除订阅并清除显示计时器；已经捕获的执行关联仍指向原清单，不能随会话切换转移到另一任务。

任务完成、折叠和查询不会删除文件或清单。任务清理由明确 task_edit 删除操作执行，nextId 保持递增。

[返回任务索引](index.md)
