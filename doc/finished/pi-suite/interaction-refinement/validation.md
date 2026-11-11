# 七项逐条验收

## 结果与范围

七项需求全部实现并通过审计。验证使用 Node.js 24.22.2、官方未修改 Pi 1.5.0 的 SDK、发布 CLI/RPC、受控 faux Provider 与本地 Responses SSE；`pnpm typecheck` 通过，完整 `pnpm test` **222/222** 通过，约一分钟内完成，`git diff --check` 通过。

没有宿主补丁、消费者安装或 npm 发布；三个 Pi peer/dev 仍精确 1.5.0、private:true 保持。未修改用户源会话、任务/执行数据、shell 或全局 Pi，也未转移执行 owner。运行状态通过正常目标 append、任务锁内事务及公开 overlay 生命周期实现。

## 逐项证据

| 需求 | 实现与审计证据 |
| --- | --- |
| 1. Ask 简短回传 | `src/ask/result.ts` 统一状态、题号、≤24 Unicode 码点短题与答案；重名选项用原列表 #N，真实答案/评论/自定义输入不截断。`tests/ask/contracts.test.ts` 核对单题/批量、多选与同名、Unicode、完整 details 与 Responses wire output 不含 details，四种结算及 parent 来源保留；实际 SDK 子父交互同步验证新的正文格式。 |
| 2. 仅删除题目 context | 单题/批量 schema 与显式 normalize 投影拒绝 context；布局、表单与父级提问不再读取该字段，options.description 和 schema 参数文档保留。契约检查非法 context 与选项说明；历史 renderer 只读展示原 context，不改写旧 JSONL。 |
| 3. 非 active Goal 结案 | Manager 区分 execute/complete；用户审计轮可关闭 failed/paused/blocked/budget_limited/stopped，无需 resume。`tests/goal/ownership.test.ts`、`lifecycle.test.ts` 覆盖精确 ID/revision/Binding、所属会话、请求 signal 与控制取消代次、旧调用/迟到结算拒绝、completed 幂等原证据/时间/反馈，以及审计不授予自动许可/不启动预算门/不累计 running。官方 RPC 从 stopped 直接审计完成。 |
| 4. stop、quit 与手动恢复 | `/goal stop` 保留目标，clear 删除。quit 将全部未完成状态保存为 stopped，保留 stoppedFrom/错误/进度/用量/耗时并撤销期限；completed 保持完成。Manager 聚合覆盖状态范围及同 ID 权限元数据对旧分支/tree/reload 的限制。`tests/runtime/cli-host.test.ts` 在两种原生终端模式验证正常退出码 0、冷启动零 Provider 请求、普通输入不恢复、显式 resume；随后对隔离 RPC 子进程真实 SIGKILL，核对源 active 快照字节未变，再冷加载转 stopped 并直接完成审计。 |
| 5. Tasks 清空与重新编号 | Store v4 在同一事务中对非空全部完成或 owner clear 清空任务/依赖/执行关联，nextId=1、轮换 generation，不保留任务历史；空组不视为完成。`tests/tasks/store.test.ts` 核对排队旧新增/link 的 TASK_STALE、清空/重用/自动完成、空清单 clear 与持久结果；`child-scope.test.ts` 核对 assigned 禁止 clear、存活 child 不被停止、过期读/写/恢复拒绝且新 1.1 不变。UI 聚合验证当前绑定恢复静默清理、真实反馈恰好 5 秒、旧 Store/Binding/计时器隔离。官方 RPC 完成→清空→重建 1.1→旧 get/agent_start/job_start 拒绝→owner clear，fork 源字节不变；fork 使用独立 generation。 |
| 6. Subagents 连续导航 | root 使用共享 withReadingSession，done 前冻结自身最后一帧/输入，新页 onHandle 挂载后释放；消息链内部 withReadingScreen 只决定尺寸。`tests/ui/reading-screen.test.ts` 使用实际原生 TUI/xterm 同步 ANSI 帧覆盖快速 tabs、延迟页面/历史/选择器、live/冻结 resize、提前 done、构造失败及最终输入/焦点恢复。官方 CLI 将 PTY 同步提交分帧，逐帧检查 Runs/Types 往返、列表进入历史与返回，不出现根会话或空白闪回。 |
| 7. 信息栏动态高度 | DetailsView 按实际一/两行与分隔线分配预算，正文只测量一次，updateLayout 结算位置后最多一次行数校正，再切片并填足总预算。`tests/ui/viewer.test.ts` 与 `tests/agents/reader-position.test.ts` 覆盖单次正文测量、follow/clamp/End、暂停、搜索/Editor、resize 及共享 reader 的新旧回调 owner。官方 CLI 的 120 列单行信息后直接显示操作，无保留空行；80/120 列往返、搜索、工具展开和真实活动 child 中文 Editor 通过。 |

## 文档与边界

- 当前事实局部沉淀到 Ask、Goal、Tasks、Agents、Jobs、公共工具、UI 和终端操作文档；原分析细节保留在本专项的对应文件中。
- U1 的键盘/公开组件范围、T1 的持久来源 LF/UTF-8 只读首头及内存 fork 警告、M1 的受守卫私有父 runtime 和原版 Responses 同源/跨模型行为保持；相关原有测试纳入完整套件。
- 本次不证明实体人工终端、Windows 人工交互、外网账号/组织权限或中转粘性；复杂阅读区域鼠标焦点、嵌套工具命中、scrollbar 拖动不新增保证。
- [消费者安装](../../../todo/official-pi-installation.md) 继续按用户明确指示延期，不计为本次通过，不执行 npm publish。

[返回专项](index.md) · [当前验证](../../../current/validation.md)
