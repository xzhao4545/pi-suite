# 任务存储与会话

持久会话的任务文件为 `<cwd>/.pi/tasks/tasks-<sessionId>.json`；未持久化的会话只使用进程内存，reload 复用该会话的清单。没有任务写入的会话不创建任务目录或文件。

## 数据与提交

存储版本为 4，封装包含 version、generation、可选 resetReason、nextId、tasks；generation 为清单代次，nextId 仅分配组号。任务记录包含 id、组的 nextChild、title、可选 description、可选 parentId、子任务 status、可选 blockedReason、blockedBy、可选 owner、jobIds、createdAt、updatedAt。父级进度与反向依赖属于查询派生数据。变更回执还报告未直接编辑但有效状态变化的依赖任务，以及跨组受影响进度；不为派生状态新增存储副本。读取 version:2 时保留组 ID 与 nextId，每组子任务按 createdAt、原数字 ID 排序分配 `组.序号`，同步映射全部 blockedBy，并把 nextChild 设为子任务数加一；version:2/3 通过严格历史 schema 校验后补充代次，下一次提交写入 version:4。持久未初始化目标的初始代次按文件路径确定，多个进程读取时一致；清空时生成全新代次。job、agent 和 schedule 的历史 taskId 保留原文本，缺少 taskGeneration 的关联明确失效，不能自动绑定新清单。

同一 Pi 进程通过目标键取得同一个 TaskStore，每个目标的读写串行执行。持久化修改取得 `<file>.lock`，在锁内重读最新文件、复制数据并处理整个批次，再写唯一临时文件和原子重命名；校验失败或提交前取消不修改原文件和缓存。

锁、串行入口、快照与原子提交由公共 runtime/json-store.ts 提供，与 agents ScheduleStore 共用；TaskStore 定义任务 schema、层级校验、整批修改与执行关联。快照加载发生实际变化时广播订阅；TasksModule 与浏览器通过带错误回调的订阅启用目录 fs.watch，原子替换后合并短时间内的事件并串行读取。目录尚未创建时观察现有祖先，首次创建后转为目标目录；没有外部订阅者时释放 watcher 与刷新计时器。文件事件不调用模型，也不持续轮询；解析或监听错误明确显示，保留有效缓存。

Windows 读取已有快照时也取得同一文件锁，使读取句柄在写入方原子替换前关闭；缺失快照直接返回当前状态，不创建任务目录。其他平台的快照继续读取原子发布的完整文件。删除中的 Windows 锁文件暂时不可打开时，竞争方在既有约 5 秒的锁等待范围内重试；取消与锁超时仍明确失败。

锁令牌为 pid:uuid，以排他创建取得。等待使用 50 ms 的异步重试，最多约 5 秒；死进程的锁可回收，空令牌先容忍短暂写入窗口。释放前校验完整令牌，避免删除后继持有者的锁。进程身份按本机 PID 表判定。

读取时校验 schema、ID 唯一、组号小于 nextId、组有 nextChild 且无 status、子任务前缀等于 parentId、子序号小于父组 nextChild、子任务有 status 且无 nextChild，以及两级父子关系；无效 JSON、版本或结构返回 TASK_STORE_INVALID，保留已有有效缓存并禁止覆盖错误文件。文件锁超时返回 TASK_LOCK_TIMEOUT。缺失文件表示当前目标尚无持久数据。

## 会话边界

- new 使用独立会话清单。
- resume/reload 按当前 cwd 和会话 ID 取得原清单；绑定时非空且全部完成的清单原子清空，不重放完成反馈，未完成清单保留 ID 与代次。
- 持久来源的 fork 只读 previousSessionFile 的首个非空 JSONL 会话头，校验有效的 session 类型、cwd 和 id 后，按源头实际 cwd/id 定位父清单；不调用可能初始化或修复源文件的 SessionManager.open。UTF-8 流按 LF 分行，保留跨块字符及 JSON 字符串中的 U+2028/U+2029，接受 EOF 不带 LF 的会话头。读取或解析错误通过 notify 报错，不修复源文件、不播种目标，也不报告继承成功。
- 父清单通过 snapshot 只读取得包含 nextId 与各组 nextChild 的完整快照，播种独立目标；目标使用自己的 generation，即使数值 ID 相同，源任务引用也不能操作目标。seed 使用目标 Store 的串行入口，并在持久目标锁内重读、检查首次使用条件和原子提交。目标绑定时可清空已全部完成的副本，不修改源清单；子清单修改不影响父清单，已经使用或清空过的目标不会重新播种。单纯 delete 清空的源保留计数器，完整快照仍继承该计数器。
- 内存来源的 fork 没有 previousSessionFile，使用独立清单并明确 warning：源任务未复制，当前 fork 使用独立任务列表；不自动继承，也不为继承偷偷落盘。普通内存会话与 reload 仍按实际 cwd/会话 ID 复用清单。
- cwd 改变时重新定位存储，不把另一工作区的清单写入当前文件。
- 会话撤销时解除订阅并清除显示计时器；已经捕获的执行关联仍指向原清单，不能随会话切换转移到另一任务。

agents 的 child 与嵌套 child 按各自实际 cwd、child 会话 ID 与持久化设置取得私有 TaskStore。持久 child 使用同一 `tasks-<childSessionId>.json` 文件协议；非持久 child 使用 `memory:<绝对cwd>:<childSessionId>` 目标键。持久化设置由执行准入确定，不因 SDK 首次会话文件发布时机改变存储目标。TaskStore 注册表仅在目标键相同时复用存储与串行入口，空私有清单不创建文件；私有清单的订阅与提醒归属 child，不进入主会话 Dock。

带 taskId 的 child 另行捕获直接父级的私有清单及 taskGeneration（顶级 child 则为主会话清单），仅通过 scope:assigned 读取或更新被分配任务的进度；默认 scope:local 不触及父级。主会话 reload 或 fork 时，存活 child 的分配任务引用仍指向原父级清单与代次，fork 清单独立。回到原 owner 后，稳定 agent ID 的恢复复用原 child 会话 ID、私有清单、taskId 与 taskGeneration，并校验分配任务仍存在且代次有效；过期关联明确拒绝恢复，不隐式重新分配。清单没有执行重新关联系统或额外存储副本。

## 清空与引用有效性

非空清单的全部有效任务完成时，TaskStore 在同一编辑事务内自动清空 tasks、依赖和执行关联，重置 nextId=1 并轮换 generation；空组不算完成，空清单不触发自动清空。owner 的 task_edit clear 使用同一锁内替换，空清单也轮换代次；不保存任务历史或归档。delete 仅删除指定项并移除相应依赖，保留递增计数器。

引用任务的 get/edit、按组或 cursor 翻页、执行准入/link 都须携带源 generation；清空等待锁期间再次校验，过期返回 TASK_STALE，缺少代次返回 TASK_GENERATION_REQUIRED（工具 schema 缺参也会在参数边界拒绝）。task_list({}) 是发现当前代次的入口。clear 不停止 child/job，也不完成 Goal；已捕获执行继续运行，但过期任务写入不能命中重新使用的 1.1。reload 遇到进程内无代次 Store 时先撤销其写入口并等待已接纳事务，再发布当前 Store，避免迟到写入覆盖重用编号。

持久数据只保留 resetReason，不保存已删除任务。真实完成后的 5 秒 UI 反馈只使用当前绑定内的短期显示行，代次包含在 Dock/浏览器选择键中；过期选择不能打开新同名任务。绑定恢复只清理当前目标的已完成数据，不扫描其他会话或工作区，不更改 fork 源。

[返回任务索引](index.md)
