# 上游来源

下表记录核对过的版本。npm 发布元数据、tarball integrity 和已提供的 gitHead 固定在 [sources.json](./sources.json)；没有 gitHead 或 repository 的来源保持空值，不推测其提交或仓库。

| 包 | 核对版本 | 源仓库 |
| --- | --- | --- |
| pi-ask-user | 0.17.2 | https://github.com/edlsh/pi-ask-user |
| @tintinweb/pi-tasks | 0.9.1 | https://github.com/tintinweb/pi-tasks |
| pi-interactive-shell | 0.18.0 | https://github.com/nicobailon/pi-interactive-shell |
| @narumitw/pi-goal | 0.54.15 | https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal |
| @tintinweb/pi-subagents | 0.23.0 | https://github.com/tintinweb/pi-subagents |
| pi-background-jobs | 0.1.3 | npm 发布元数据未提供仓库，以发布包为核对来源 |

## 实现来源与更新

ask_user 以 pi-ask-user 0.17.2 的参数与 response/details 契约为来源，交互在 src/ask 与共享 src/ui 中重构；保留其 [完整 MIT 许可证](./licenses/pi-ask-user.txt)。没有串联加载其独立 UI、设置或旧作用域兼容逻辑。

goal 参考 @narumitw/pi-goal 0.54.15 的目标工具契约与控制语义；src/goal 重构持久目标、运行归属和宿主最终结算，继续请求、状态与详情复用公共 runtime/ui，保留其 [完整 MIT 许可证](./licenses/pi-goal.txt)。自动限制只使用用户明确配置的预算。

jobs 导入 pi-background-jobs 0.1.3 与 pi-interactive-shell 0.18.0 的部分源文件，均保留 MIT 许可证（[pi-background-jobs](./licenses/pi-background-jobs.txt)、[pi-interactive-shell](./licenses/pi-interactive-shell.txt)），每个导入文件头注明原路径与改动：

| 本包文件 | 来源 | 改动 |
| --- | --- | --- |
| src/jobs/backends/windows-tree.ts | pi-background-jobs src/windows-process.ts | 改为作用于与后端无关的进程句柄，供 pipe 与 PTY 共用 |
| src/jobs/backends/pipe.ts | pi-background-jobs src/process.ts | stdin 保持打开供输入；POSIX 子进程为进程组组长 |
| src/jobs/manager.ts | pi-background-jobs src/jobs.ts | 增加 PTY、单一 job.json、单调耗时、输入记录、创建归属与级联停止；workflow gate 共用关闭 stdin 和结算等待，本次停止只匹配传入 creator 范围，累计关闭集合用于未来准入；去掉工作区独占锁 |
| src/jobs/store.ts、runtime.ts、state.ts、types.ts、workspace.ts | pi-background-jobs 同名文件 | 目录与 ID 改为本包格式；runtime 注册键与协议改为本包，增加独立版本的查询/停止控制桥 |
| src/jobs/backends/pty.ts、terminal/protocol.ts、terminal/keys.ts、terminal/shell.ts | pi-interactive-shell pty-process.ts、pty-protocol.ts、key-encoding.ts、shell-resolution.ts | 删除语义动作编码；Windows 停止接入 windows-tree |
| src/jobs/terminal/session.ts、render.ts | pi-interactive-shell pty-session.ts | 输出写入 job 日志而非内存缓冲；渲染纯函数拆出 |
| src/jobs/terminal/visible-text.ts | pi-interactive-shell output-selection-runtime.ts 的 normalizeSelectorVisibleText | 单独摘出 |
| src/jobs/monitors/compile.ts | pi-interactive-shell index.ts 的 trigger 编译、poll-diff 循环与 file-watch 命令生成 | 触发模式与 job_read search 共用语法；阈值增加 eq；删除 semantic 策略 |
| src/jobs/monitors/runtime.ts | pi-interactive-shell headless-monitor.ts 的匹配、冷却、去重与 poll-diff 摘要，index.ts 的 detector 协议 | 改为读取 job 自身日志，pipe 与 PTY 共用；detector 失败时附错误投递候选事件；删除语义挂钩与 dispatch 状态机 |
| src/jobs/monitors/hands-free.ts | pi-interactive-shell headless-monitor.ts 的静默/宽限期生命周期与 overlay-component.ts 的增量更新/预算状态机 | 由长期 JobManager 持有；实际退出才结算；接管暂停更新与静默终止；预算生成时扣除，更新走共享通知；删除语义监督 |
| src/jobs/launch/config.ts | pi-interactive-shell config.ts 的默认预设与 launch-policy.ts 的精确匹配/优先级 | schema 与加载并入共享配置，逐键和字段合并；用户级规则，未设置也默认 ask |
| src/jobs/launch/presets.ts | pi-interactive-shell spawn.ts 的 CLI 参数拼装与 Bash 转义 | 结构化 job_start.agent；删除 worktree 与 /spawn；prompt 前结束选项解析；Pi fork 复用宿主会话文件 |

tasks 导入改造 @tintinweb/pi-tasks 0.9.1 的存储、依赖、会话与提醒机制，保留 [完整 MIT 许可证](./licenses/pi-tasks.txt)：

| 本包文件 | 来源 | 改动 |
| --- | --- | --- |
| src/tasks/store.ts、src/runtime/json-store.ts | src/task-store.ts | 保留 pid:uuid 锁、锁内重读、原子保存、快照与播种；锁等待改为异步，增加版本校验、同目标串行入口与复制后整批提交；文件协议供 TaskStore 和 ScheduleStore 共用 |
| src/tasks/model.ts | src/task-store.ts 的 CRUD 与依赖规则 | 两级 parentId，父级进度与反向边派生，保留自引用/不存在/二元环及未完成阻塞项警告，删除清理依赖 |
| src/tasks/types.ts | src/types.ts | 状态统一为 todo/doing/done，增加两级结构、版本化 schema 与批量 changes |
| src/tasks/index.ts | src/index.ts、task-paths.ts、reminder-cadence.ts | 按 cwd/会话定位存储，保留 fork 清单与计数器继承、内存模式、临时提醒；显示和反馈接入统一 Dock，执行引用通过 TaskStore.link |

agents 以 @tintinweb/pi-subagents 0.23.0 的源码与契约为来源，分别登记直接导入、按职责适配与公共框架重构，保留 [完整 MIT 许可证](./licenses/pi-subagents.txt)：

| 本包文件 | 来源 | 改动 |
| --- | --- | --- |
| src/agents/defaults.ts | src/default-agents.ts | 保留内置类型的完整描述、提示词与只读工具集合，配置类型并入本包 |
| src/agents/catalog.ts、models.ts | src/custom-agents.ts、agent-types.ts、model-resolver.ts、invocation-config.ts | 核心 frontmatter、来源优先级和精确/唯一大小写匹配；调用参数优先的 model/thinking，显式不可用模型报错，复用 Pi 认证目录；类型 enabled 由共享配置逐类型覆盖，普通/恢复/嵌套/调度/workflow/RPC 新调用共用 catalog 准入 |
| src/agents/manager.ts、runtime.ts | src/agent-manager.ts | 按上游机制重构：拆分同进程生命周期、两池共享 FIFO 与 chargedPool；增加 run ID、父级准入关闭与 job 级联，reload 保持执行 owner；适配上游每 60 秒、结束 10 分钟的回收，完整 record/result 移入已有 histories，以通知/reader/workflow 引用保留 Execution；不复制 tombstone 记录系统，停止只合并进行中请求；前台转后台保留单向交接，按真实调用契约转移 chargedPool、释放等待并继续通知；停止先登记共享操作并整批转换目标状态，同步重入不重复清理/启动排队后代，清理期间拒绝新 run，父级等待全部直接 child 最终结算 |
| src/agents/viewer.ts、src/ui/details.ts 的动作扩展 | src/ui/conversation-viewer.ts 的操作语义 | 按机制适配 x 两次停止、Enter 消息输入、b 转后台；复用公共原生 Transcript/DetailsView、选中 runId 与直接父级准入，搜索/输入拥有文字键，输入和模型往返保留 reader 与执行引用；不导入上游文本渲染实现 |
| src/agents/runner.ts、records.ts | src/agent-runner.ts、agent-record-entry.ts | 按上游机制重构：Pi SDK 会话创建、绑定、prompt/abort/dispose 与 custom entry；删除 worktree，记录按 run 的结束叶子，使用父级 ModelRuntime |
| src/agents/history.ts；records.ts 的只读解析、Manager 的 discover/lookup | 本项目实现，使用 Pi 公共会话存储 API | 默认/配置会话目录与 child/workflow/parentSession 引用发现；按 mtime/size 缓存文件解析，完整分支及保存时间合并回既有 histories，Manager.runs 保持权威；parseSessionEntries/inMemory 读取不修复重写 JSONL，workspace/owner/branch 边界与错误叶子显式验证；不计作上游源码直接导入 |
| src/agents/child.ts、questions.ts | src/nested-tools.ts 的嵌套范围 | 工具改为 agent_*；共享 TaskStore、wait、Notifications 与 ask schema，新增只交直接父级的挂起提问 |
| src/agents/resources/selectors.ts、scope.ts、loader.ts | src/agent-runner.ts 的扩展分类、工具范围与资源加载 | 保留名称/包别名、晚注册、exposure/defaultActive、MCP 模式与直接/嵌套检查；公共包管理器先筛选路径，再用 Pi loader 加载，避免排除工厂和重复 suite；作用域统一接入本包工具与禁用通配 |
| src/agents/resources/packages.ts | src/package-resources.ts 的 manifest、目录/单文件、精确排除、真实根与包门控 | 使用 Pi 已安装根；去掉旧 API 探测、全局 trust/cache 与静默异常，信任/门控通过上下文传递；保留声明优先、文件上限与来源 |
| src/agents/resources/context.ts、memory.ts、prompts.ts | src/context.ts、memory.ts 的提示正文与目录、prompts.ts 的 inheritableParentPrompt | 保留父文本/压缩摘要、200 行记忆索引和完整读写提示、稳定父级前缀；名字在 frontmatter 边界验证，去掉 legacy memory 与独立符号链接读取政策，I/O 错误可见 |
| src/agents/mentions/grammar.ts、provider.ts、clone.ts、index.ts；manager.ts 的 handle 分配 | src/mention.ts、ui/agent-mention.ts、mention-clone.ts、index.ts 的输入分发；agent-manager.ts 的 handle/alias 分配 | 按职责保留语法、名称空间、补全叠加和当前分支内存克隆；本包 run 记录承载身份与恢复，复用注册 agent_start 与 Manager.send，取消跟随绑定生命周期；只开放一个启动工具，前台结果交给真实父级通知，启动失败明确报告；删除旧 SDK 探测、tombstone 并行记录与直接启动兜底 |
| src/agents/schedules/parse.ts、store.ts、index.ts、menu.ts；tools.ts/viewer.ts 的调度入口 | src/schedule.ts、schedule-store.ts、ui/schedule-menu.ts、index.ts 的调度接入 | 保留六字段 cron、相对/ISO 单次、周期、主会话存储、满池绕过排队与普通通知；提取 tasks 文件协议共用，删除忙等/损坏文件覆盖/模型静默替换；期限在锁内准入，长延时分段、结算不覆盖较新运行；原生值选择取消、绑定开关同步 schema、quit 等待落盘；croner 10.0.1 |
| src/agents/rpc/handlers.ts、options.ts、index.ts；manager.ts/runner.ts 的事件与启动就绪 | src/cross-extension-rpc.ts、index.ts 的 session_start/RPC 与生命周期接入、agent-manager.ts 的 awaitStartup | 按职责导入改造五通道与版本 2；参数映射复用类型/模型解析，注册与归属接入公共 Binding/Manager，消费先于通知；保留 cwd 配置根/目标信任分离、信号取消、分离运行与池归属；未知/内部选项明确报错，活动追踪与 invocation 由公共记录派生，删除 worktree 钩子 |
| src/agents/output/schema.ts、tool.ts | src/workflow/json-schema.ts、structured-output.ts | 直接导入后局部调整错误报告、字符串参数解析与 Pi 1.5 参数归一化/校验说明；执行器保留工具验证与一次纠正提示，公共动态范围准入，JSON 写入普通 run 记录 |
| src/agents/workflow/runtime/types.ts、helpers.ts、run.ts、index.ts | src/workflow/runtime.ts | 按职责拆分导入，保留 Worker 与共享闭包、并发/暂停/跳过/重试、嵌套和 journal 前缀；脚本限制按 UTF-8 字节，重试与 gate 异常保留用量，事件/落盘失败明确结算；metadata 单次校验后交给宿主，child 续接沿用原 CompiledSchema 与有效结构化标记；删除 worktree 字段与 gate 提前执行钩子 |
| src/agents/workflow/worker/bootstrap.ts、scope.ts、flow.ts、index.ts | src/workflow/worker-source.ts | 三段源码拼接为同一个 Worker 词法作用域；保留 JSON/确定性边界、parallel/pipeline、阶段/日志、预算、单层嵌套和选项校验，isolation 明确拒绝；结构化与原 schema 续接返回由公共 schema 验证，在脚本 realm 内按有效结构化标志解析 |
| src/agents/workflow/progress/types.ts、model.ts、format.ts、index.ts | src/workflow/progress.ts | 按类型、数据派生与格式拆分，保留追加日志、按 index 折叠、阶段组与显示状态；删除 worktree 字段 |
| src/agents/workflow/meta.ts | src/workflow/meta.ts | 直接导入后增加纯字面量语法验证，保留 metadata 扫描、JavaScript 字符串/注释、100 ms VM 解析与调用名称缓存 |
| src/agents/workflow/journal.ts | src/workflow/journal.ts | 直接导入后删除 worktree key，schema 使用固定槽位；文件读写失败、中间损坏和重复 index 报错，仅未完成末行返回显式 truncated 标记 |
| src/agents/workflow/task.ts、entry.ts、tool-description.ts | src/workflow/task.ts、entry.ts、tool-description.ts | 直接导入后删除独立通知，暂停记录拒绝 journal 恢复；entry 类型改为 pi-suite:workflow-record，扩展归属、版本、消费与 SDK child 引用快照；描述保留完整编排指引及明确使用前提，工具名、cwd gate、并发下界按本包范围局部调整 |
| src/agents/workflow/host.ts | src/workflow/host.ts | 按职责适配到共享 AgentManager 与 JobManager；保留实际 model/thinking 与早期 record ID、固定 child resume 契约，gate 在 cwd 使用 pipe、关闭 stdin、默认 10 分钟；停止与 quit 等待真实 child/job 清理 |
| src/agents/workflow/saved.ts、collisions.ts | src/workflow/saved.ts、collisions.ts | 适配保存脚本、命名与冲突规则；项目信任和包 roots 复用 packageResources，script/scriptPath/name 三选一，读取错误可见；工具名与嵌套配置示例按本包规范调整 |
| src/agents/workflow/manager.ts | src/index.ts 的后台 workflow 生命周期 | 按机制适配为无 ExtensionAPI 的进程级 owner；准入前持久化脚本/journal/快照，终态等待实际清理与保存，父级记录恢复按 owner/branch 和 SDK 引用；通知与绑定由公共框架处理 |
| src/agents/workflow/ui/progress.ts、menu.ts | src/ui/workflow-card.ts、workflow-dialog.ts、workflow-menu.ts 的展示字段与控制范围 | 按职责重构，非逐行导入；使用原生 Text、公共 DetailsView/ScrollView/SelectList，child Transcript 与 gate 日志调用已有查看器；保留阶段/日志/结果、暂停/恢复/停止、跳过/重试、journal 重放与稳定选择/阅读位置 |

工具与通知不导入上游实现，按本包规范重写。src/agents/workflow/tools.ts、index.ts 使用公共注册、WaitRegistry、Notifications、Dock 和原生 entry/tool renderer；store.ts 使用公共 JsonStore，不计作上游存储导入。runtime/tools.ts 的 registerBoundTool 为描述/schema 刷新和晚注册共用的 active-tool 选择保持入口，不计作上游导入。src/agents/parent.ts 为适配 Pi 1.5 上下文撤销编写，仅捕获执行所需事实，不计作上游导入。agents 查看复用共享原生 Transcript，扩展 child renderers、部分工具输出与稳定消息缓存。src/agents/model-editor.ts、src/runtime/config-edit.ts 和 src/ui/select.ts 为本项目类型/单 agent 模型配置需求编写，直接复用 Pi 的认证目录、模型能力、原生 SelectList、会话修改接口和共享配置；类型 Enable/Disable/Use definition 的语义参考上游 agent-file-toggle，写回共享 enabled 并保留 model/thinking，不导入独立文件开关系统，这些文件不计作上游源码导入。src/agents/workflow/literal.ts 为补齐 metadata 纯字面量契约编写，不计作上游导入。技能发现复用 Pi getSkills，不导入上游的重复目录扫描；命名技能在同一启用目录预加载。平台/真实资源组合按 [上游导入](../doc/todo/pi-suite/upstream-import.md) 和 [agents 待办](../doc/todo/pi-suite/agents/index.md) 继续实施。pi-starship 0.65.2 用于外部 footer 契约参考及实际 extension_status 模块验证，不是本包依赖。导入其他模块时同步记录路径、许可证及具体重构边界。

更新时先取得指定版本的 npm 发布包，与登记的 tarball integrity 对照来源；检查工具契约及公共宿主 API 差异，局部吸收所需改动，更新 sources.json、许可证及本登记，再运行对应契约与宿主检查。来源校验用于确保版权和基线可追踪，不以构建产物哈希代替功能验证。
