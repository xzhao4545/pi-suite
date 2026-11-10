# 任务存储与会话

持久会话的任务文件为 `<cwd>/.pi/tasks/tasks-<sessionId>.json`；未持久化的会话只使用进程内存，reload 复用该会话的清单。没有任务写入的会话不创建任务目录或文件。

## 数据与提交

存储版本为 3，封装包含 version、nextId、tasks；nextId 仅分配组号。任务记录包含 id、组的 nextChild、title、可选 description、可选 parentId、子任务 status、可选 blockedReason、blockedBy、可选 owner、jobIds、createdAt、updatedAt。父级进度与反向依赖属于查询派生数据。变更回执还报告未直接编辑但有效状态变化的依赖任务，以及跨组受影响进度；不为派生状态新增存储副本。读取 version:2 时保留组 ID 与 nextId，每组子任务按 createdAt、原数字 ID 排序分配 `组.序号`，同步映射全部 blockedBy，并把 nextChild 设为子任务数加一。转换只发生在内存，下一次编辑写入 version:3；job、agent 和 schedule 的历史 taskId 保留原文本。

同一 Pi 进程通过目标键取得同一个 TaskStore，每个目标的读写串行执行。持久化修改取得 `<file>.lock`，在锁内重读最新文件、复制数据并处理整个批次，再写唯一临时文件和原子重命名；校验失败或提交前取消不修改原文件和缓存。

锁、串行入口、快照与原子提交由公共 runtime/json-store.ts 提供，与 agents ScheduleStore 共用；TaskStore 定义任务 schema、层级校验、整批修改与执行关联。快照加载发生实际变化时广播订阅；TasksModule 与浏览器通过带错误回调的订阅启用目录 fs.watch，原子替换后合并短时间内的事件并串行读取。目录尚未创建时观察现有祖先，首次创建后转为目标目录；没有外部订阅者时释放 watcher 与刷新计时器。文件事件不调用模型，也不持续轮询；解析或监听错误明确显示，保留有效缓存。

Windows 读取已有快照时也取得同一文件锁，使读取句柄在写入方原子替换前关闭；缺失快照直接返回当前状态，不创建任务目录。其他平台的快照继续读取原子发布的完整文件。删除中的 Windows 锁文件暂时不可打开时，竞争方在既有约 5 秒的锁等待范围内重试；取消与锁超时仍明确失败。

锁令牌为 pid:uuid，以排他创建取得。等待使用 50 ms 的异步重试，最多约 5 秒；死进程的锁可回收，空令牌先容忍短暂写入窗口。释放前校验完整令牌，避免删除后继持有者的锁。进程身份按本机 PID 表判定。

读取时校验 schema、ID 唯一、组号小于 nextId、组有 nextChild 且无 status、子任务前缀等于 parentId、子序号小于父组 nextChild、子任务有 status 且无 nextChild，以及两级父子关系；无效 JSON、版本或结构返回 TASK_STORE_INVALID，保留已有有效缓存并禁止覆盖错误文件。文件锁超时返回 TASK_LOCK_TIMEOUT。缺失文件表示当前目标尚无持久数据。

## 会话边界

- new 使用独立会话清单。
- resume/reload 按当前 cwd 和会话 ID 取得原清单，不重新分配 ID。
- 持久来源的 fork 只读 previousSessionFile 的首个非空 JSONL 会话头，校验有效的 session 类型、cwd 和 id 后，按源头实际 cwd/id 定位父清单；不调用可能初始化或修复源文件的 SessionManager.open。UTF-8 流按 LF 分行，保留跨块字符及 JSON 字符串中的 U+2028/U+2029，接受 EOF 不带 LF 的会话头。读取或解析错误通过 notify 报错，不修复源文件、不播种目标，也不报告继承成功。
- 父清单通过 snapshot 读取，以包含 nextId 与各组 nextChild 的完整快照播种独立目标，即使原任务已全部删除也保留编号计数器；seed 使用目标 Store 的串行入口，并在持久目标锁内重读、检查首次使用条件和原子提交。子清单修改不影响父清单，已经使用过的目标不会重新播种。
- 内存来源的 fork 没有 previousSessionFile，使用独立清单并明确 warning：任务未从内存来源继承；不自动继承，也不为继承偷偷落盘。普通内存会话与 reload 仍按实际 cwd/会话 ID 复用清单。
- cwd 改变时重新定位存储，不把另一工作区的清单写入当前文件。
- 会话撤销时解除订阅并清除显示计时器；已经捕获的执行关联仍指向原清单，不能随会话切换转移到另一任务。

agents 的 child 与嵌套 child 按各自实际 cwd、child 会话 ID 与持久化设置取得私有 TaskStore。持久 child 使用同一 `tasks-<childSessionId>.json` 文件协议；非持久 child 使用 `memory:<绝对cwd>:<childSessionId>` 目标键。持久化设置由执行准入确定，不因 SDK 首次会话文件发布时机改变存储目标。TaskStore 注册表仅在目标键相同时复用存储与串行入口，空私有清单不创建文件；私有清单的订阅与提醒归属 child，不进入主会话 Dock。

带 taskId 的 child 另行捕获直接父级的私有清单（顶级 child 则为主会话清单），仅通过 scope:assigned 读取或更新被分配任务的进度；默认 scope:local 不触及父级。主会话 reload 或 fork 时，存活 child 的分配任务引用仍指向原父级清单，fork 清单独立。回到原 owner 后，稳定 agent ID 的恢复复用原 child 会话 ID、私有清单和 taskId，并校验分配任务仍存在；清单没有执行重新关联系统或额外存储副本。

任务完成、折叠和查询不会删除文件或清单。任务清理由明确 task_edit 删除操作执行，nextId 和各组 nextChild 保持递增。

[返回任务索引](index.md)
