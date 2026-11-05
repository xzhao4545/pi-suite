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
| src/jobs/manager.ts | pi-background-jobs src/jobs.ts | 增加 PTY、单一 job.json、单调耗时、输入记录、创建归属与级联停止；去掉工作区独占锁 |
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
| src/tasks/store.ts | src/task-store.ts | 保留 pid:uuid 锁、锁内重读、原子保存、快照与播种；锁等待改为异步，增加版本校验、同目标串行入口与复制后整批提交 |
| src/tasks/model.ts | src/task-store.ts 的 CRUD 与依赖规则 | 两级 parentId，父级进度与反向边派生，保留自引用/不存在/二元环及未完成阻塞项警告，删除清理依赖 |
| src/tasks/types.ts | src/types.ts | 状态统一为 todo/doing/done，增加两级结构、版本化 schema 与批量 changes |
| src/tasks/index.ts | src/index.ts、task-paths.ts、reminder-cadence.ts | 按 cwd/会话定位存储，保留 fork 清单与计数器继承、内存模式、临时提醒；显示和反馈接入统一 Dock，执行引用通过 TaskStore.link |

agents 按职责导入改造 @tintinweb/pi-subagents 0.23.0，保留 [完整 MIT 许可证](./licenses/pi-subagents.txt)：

| 本包文件 | 来源 | 改动 |
| --- | --- | --- |
| src/agents/defaults.ts | src/default-agents.ts | 保留内置类型的完整描述、提示词与只读工具集合，配置类型并入本包 |
| src/agents/catalog.ts、models.ts | src/custom-agents.ts、agent-types.ts、model-resolver.ts、invocation-config.ts | 核心 frontmatter、来源优先级和精确/唯一大小写匹配；调用参数优先的 model/thinking，显式不可用模型报错，复用 Pi 认证目录 |
| src/agents/manager.ts、runtime.ts | src/agent-manager.ts | 拆分同进程生命周期、两池共享 FIFO 与 chargedPool；增加 run ID、父级准入关闭与 job 级联，reload 保持执行 owner |
| src/agents/runner.ts、records.ts | src/agent-runner.ts、agent-record-entry.ts | Pi SDK 会话创建、绑定、prompt/abort/dispose 与 custom entry；删除 worktree，记录按 run 的结束叶子，使用父级 ModelRuntime |
| src/agents/child.ts、questions.ts | src/nested-tools.ts 的嵌套范围 | 工具改为 agent_*；共享 TaskStore、wait、Notifications 与 ask schema，新增只交直接父级的挂起提问 |

工具与通知不导入上游实现，按本包规范重写。agents 查看复用共享原生 Transcript，扩展 child renderers、部分工具输出与稳定消息缓存。src/agents/model-editor.ts、src/runtime/config-edit.ts 和 src/ui/select.ts 为本项目类型/单 agent 模型配置需求编写，直接复用 Pi 的认证目录、模型能力、原生 SelectList、会话修改接口和共享配置；这些文件不计作上游源码导入。其余资源选择、@handle、调度/workflow/RPC 与回收按 [上游导入](../doc/todo/pi-suite/upstream-import.md) 和 [agents 待办](../doc/todo/pi-suite/agents/index.md) 继续导入。pi-starship 0.65.2 用于外部 footer 契约参考及实际 extension_status 模块验证，不是本包依赖。导入其他模块时同步记录路径、许可证及具体重构边界。

更新时先取得指定版本的 npm 发布包，与登记的 tarball integrity 对照来源；检查工具契约及公共宿主 API 差异，局部吸收所需改动，更新 sources.json、许可证及本登记，再运行对应契约与宿主检查。来源校验用于确保版权和基线可追踪，不以构建产物哈希代替功能验证。
