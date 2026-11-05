# 上游源码导入与改造

目标：tasks、jobs、agents 以上游发布包源码为基础导入改造，保留已解决的平台与并发边界，按文件记录导入、改造和丢弃范围。

当前状态：实施中；四个上游发布包已下载核对，jobs 的后端、长期管理、PTY、monitor、hands-free 与 CLI 预设，tasks 的两级存储、依赖、会话与提醒，以及 agents 的基础执行、队列、记录、交互与资源基础能力已按职责导入改造并登记来源；类型与单 agent 模型配置已实现，@handle 输入、补全与克隆启动已导入，定时调度与 RPC 五通道、生命周期、cwd 和结构化结果已接入，agents 的 workflow 高级入口继续导入，完整资源组合待验收。task 的 agent 执行恢复关联已接入，综合场景待验收。本文件记录完整按文件处置结论。ask 与 goal 已按上游契约重写并通过两平台检查，不再改为导入。

影响范围：src/tasks、src/jobs、src/agents 与共享 runtime/ui，third-party 来源登记与许可证，package.json 运行依赖。

约束：导入文件保留来源注释与 MIT 许可证；单文件不超过 1000 行、单目录不超过 20 个文件；上游独立的 widget、状态键、通知、配置与设置界面接入本包共享模块；工具按 [统一工具设计](tool-design.md) 重新注册。

相关当前文档：[基线与验证](../../current/validation.md)、[上游登记](../../../third-party/UPSTREAM.md)。

## 任务列表

- [ ] 将四个上游包的导入文件放入目标目录，文件头标注包名、版本与原路径
- [ ] 删除丢弃范围的代码与依赖，拆分超限文件
- [ ] 把上游 widget、状态、通知、配置和会话事件接入共享 dock、StatusPublisher、Notifications、SessionBinding 与配置
- [ ] 登记许可证、导入文件清单与改动边界，更新 sources.json
- [ ] 锁定并验证新增运行依赖：zigpty、@xterm/headless、@xterm/addon-serialize、croner

## 验收方式

导入文件头部来源与 UPSTREAM.md 清单一致；丢弃项在本文件有记录且源码中不存在；没有超过 1000 行的文件或超过 20 个文件的目录；本包只存在 pi-suite:dock、goal、pi-suite:runtime 三个常驻显示键；类型检查与离线检查通过。

## 关联计划

- [统一工具设计](tool-design.md)
- [扩展包架构](architecture.md)
- [上游基线](upstream-baseline.md)

## 选择依据

| 方式 | 结论 |
| --- | --- |
| 完全重写 | 不采用。pi-subagents 约 2.3 万行、pi-interactive-shell 约 1.1 万行，并发队列、嵌套归属、ConPTY、POSIX 进程组、终端设备查询应答和 Windows 进程树停止都是已踩过的边界，重写会重复这些工作 |
| 整包 fork 后串联加载 | 不采用。各包自带 widget、状态键、通知和配置，与统一 dock、状态栏和通知冲突；入口文件 4367、2703、1417 行超过限制；包含付费语义监督等不需要的功能 |
| 按文件导入改造 | 采用。保留核心逻辑与边界处理，删除不需要的功能，拆分超限文件，显示与调度接入共享模块 |

保留范围由用户确认：subagents 保留核心启动、后台、恢复、嵌套、查看与停止，以及自定义 agent 类型、@handle 提及、定时调度、SubagentWorkflow 和跨扩展 RPC，不保留 git worktree 隔离。interactive-shell 保留 PTY、输入、attach/detach、停止，以及输出 monitor 与 hands-free/dispatch，不保留 Jev 语义监督与语义输出裁剪。child 提问转给父 agent。

## 目标目录

```text
src/
  runtime/        binding、notifications、config、wait（共享等待）
  ui/             dock、status、details、transcript、scroll、terminal（PTY 视图）
  tasks/          store、types、model、query、tools、viewer、index（会话与提醒）
  jobs/
    backends/     pipe、pty、windows-tree、posix-group
    terminal/     session、protocol、keys、visible-text
    monitors/     stream、poll-diff、file-watch、hands-free
    manager、store、tools、commands、runtime、index
  agents/
    core/         manager、queue、runner、session、nested、records
    types/        agent-types、custom-agents、default-agents、invocation
    context/      prompts、skills、memory、models、usage、structured-output
    workflow/     runtime、worker-source、host、task、progress、journal、meta、saved
    schedule/     scheduler、store
    mention/      parse、clone、completion
    ui/           viewer、workflow-card、workflow-dialog、menus
    tools、commands、rpc、index
```

## pi-background-jobs 0.1.3

| 文件 | 行数 | 处置 |
| --- | --- | --- |
| src/windows-process.ts | 188 | 导入到 jobs/backends/windows-tree。保留 CIM 身份、按创建时间选取子树、taskkill /T /F、四项确认条件和 TOCTOU 说明。可信 SystemRoot 固定为 C:\Windows 的限制保留，其他系统盘需另行验证 |
| src/store.ts | 206 | 导入改造。目录改为 `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`，增加 input.jsonl 与 PTY 的 output.log；保留 UTF-8 边界分页、日志文件身份校验和删除前复核 |
| src/jobs.ts | 319 | 导入改造为 JobManager。保留可重入 stop、shortenStop、wait 观察引用、monitor 的日志与运行时限、shutdown/exitSync；增加 PTY 模式、创建归属与按创建者级联停止。不保留默认 exclusive 工作区锁：PTY REPL 与构建常需并存，串行要求由模型用 wait 表达 |
| src/process.ts | 86 | 导入改造为 pipe 后端。保留输出文件校验与退出观测；Linux 使用 detached 进程组 |
| src/runtime.ts | 74 | 导入。globalThis 注册键改为 pi-suite，保留协议版本、空闲替换、quit 共享期限与 exit 同步回退；增加独立版本的查询/停止控制桥，执行协议不兼容时仍由原实现处理控制 |
| src/state.ts、src/workspace.ts | 14、26 | 导入 |
| src/types.ts | 47 | 导入并合并 PTY、归属、输入记录字段 |
| src/tools.ts | 75 | 不导入实现，按统一规范重写注册；保留描述中对停止确认与日志不可信的说明 |
| src/notifications.ts | 239 | 机制改接共享 Notifications；保留启动引用记录、分支引用判断、每个 job 最多唤醒一次和 Esc 暂停已有 job 唤醒的规则 |
| src/panel.ts、extensions/index.ts | 53、39 | 不导入，改由 /jobs 详情和 src/index.ts 注册 |

## pi-interactive-shell 0.18.0

| 文件 | 行数 | 处置 |
| --- | --- | --- |
| pty-process.ts | 500 | 导入并拆分为接口分派、zigpty 适配和 POSIX 后端。保留 BOOTSTRAP 进程组钉住与 PTY fd 屏蔽；Linux resize 的 /usr/bin/stty 绝对路径需验证。Windows 停止接入 windows-tree，补齐进程树停止 |
| pty-session.ts | 726 | 导入并拆分为会话主体与渲染纯函数。保留 xterm headless、有序写队列、设备查询应答与 kill 升级 |
| pty-protocol.ts、pty-log.ts | 35、59 | 导入 |
| key-encoding.ts | 333 | 导入，删除语义动作编码 |
| shell-resolution.ts | 43 | 导入，复用 Pi 的 Bash 选择；Windows 需要 Git Bash |
| headless-monitor.ts | 488 | 导入改造为 monitors/hands-free，保留静默结束、宽限期、超时、trigger 匹配与冷却；删除语义挂钩 |
| index.ts 中 monitor 编译与 file-watch/poll-diff 生成 | 约 330 | 导入到 monitors/，按 Bash 单引号转义规则保留 |
| session-query.ts | 171 | 导入，查询限流默认值改为可配置并下调 |
| handoff-utils.ts | 118 | 导入，完成日志落盘与 TTL 清理并入 job 历史 |
| launch-policy.ts | 37 | 导入，仅用户级配置可设置，deny 优先 |
| spawn.ts | 358 | 导入 CLI agent 预设（pi、codex、claude、cursor 及自定义键）与参数拼装，删除 worktree 创建 |
| session-manager.ts | 481 | 会话表、ID 生成与退出清理并入 JobManager；删除输出源相关部分 |
| runtime-coordinator.ts | 368 | API 未绑定时的延迟投递、agent 主动停止后的唤醒去重、运行代次并入共享 runtime；删除输出选择缓存 |
| notification-utils.ts | 219 | 文案口径并入共享通知：“已请求终止，子进程退出未确认”；发送改走 Notifications |
| config.ts | 437 | 只取默认值与上下限，加载改用共享配置 |
| types.ts | 311 | 裁剪后导入，删除 Semantic* 类型 |
| tool-schema.ts | 486 | 不导入，作为参数参考；保留“kill 不确认退出”的描述口径 |
| overlay-component.ts | 1133 | 只导入用户接管/交还、退出倒计时和 hands-free 更新预算的状态机，渲染由 ui/terminal 重写 |
| output-selection-runtime.ts 的 normalizeSelectorVisibleText | 约 20 | 摘出到 terminal/visible-text，用于 PTY 回车覆写后的可见文本 |
| terminal-observation.ts 的 sanitizeTerminalTextBuiltIn、containsSecretPromptText | 约 40 | 摘出，用于读取前清理控制序列及识别密码提示 |
| skills/interactive-shell | 280 | 按新工具重写为本包技能说明，删除 jev 与 output-selection 参考 |
| jev-client、semantic-*、selector-*、output-source-store、output-selector、scripts/、examples/ | 约 2800 | 丢弃：外发终端内容到付费接口及其评估资产 |
| reattach-overlay.ts | 448 | 丢弃：与主 overlay 重复的第二套界面 |
| background-widget.ts | 106 | 丢弃实现，由统一 dock 显示 |

依赖：zigpty（上游声明 ^0.1.6，当前发布 0.2.1，按实际验证版本锁定）、@xterm/headless、@xterm/addon-serialize；丢弃 @typesafe-ai/sdk 与 re2js。

## @tintinweb/pi-subagents 0.23.0

基础执行、队列、run 记录、类型、父级交互与任务/job 关联已导入改造，见 [基础阶段](../../finished/pi-suite/agents/core.md) 与 [来源登记](../../../third-party/UPSTREAM.md)。类型与单 agent 模型配置见 [模型基础阶段](../../finished/pi-suite/agents/models-core.md)，资源选择、技能、memory 与上下文见 [资源基础阶段](../../finished/pi-suite/agents/resources-core.md)。@handle 输入与克隆启动见 [提及基础阶段](../../finished/pi-suite/agents/mentions-core.md)。定时调度见 [调度基础阶段](../../finished/pi-suite/agents/schedules-core.md)。RPC 见 [RPC 基础阶段](../../finished/pi-suite/agents/rpc-core.md)。下表保留完整处置范围；workflow 和回收仍需继续执行。

| 文件 | 行数 | 处置 |
| --- | --- | --- |
| src/agent-manager.ts | 1735 | 导入并拆分为记录与生命周期、两个并发池与队列、停止与回收。保留 isTopLevelAgent、启动时记录 chargedPool、dequeue 释放等待者、排队项的父级 abort；增加执行 ID 与 job 级联停止 |
| src/agent-runner.ts | 1468 | 导入并拆分为会话构建、工具范围、恢复与引导。删除 worktree；child 会话注入转交父 agent 的 ask_user |
| src/nested-tools.ts | 426 | 导入，工具改为 agent_* 规范名；maxDepth 默认 3，包含顶级及两层嵌套 |
| src/agent-types.ts、custom-agents.ts、default-agents.ts、invocation-config.ts | 346、452、125、155 | 导入，删除 isolation 参数；invocation-config 的 model 与 thinking 改为参数优先于 TUI 类型配置、再优先于 frontmatter，见 [模型与 thinking 配置](agents/models.md) |
| src/agent-record-entry.ts | 138 | 导入，条目类型改为 pi-suite:agent-record，保留 reopenTarget 拒绝规则 |
| src/completion-outbox.ts、group-join.ts | 116、141 | 规则并入共享 Notifications：一个边界一条消息、已读取结果撤销通知；不保留 group 参数 |
| src/mention.ts、mention-clone.ts、ui/agent-mention.ts | 141、195、216 | 已按职责导入 @handle 输入、原生补全与克隆启动；handle/alias 并入 run 记录、工具和通知复用公共模块，取消随主绑定生命周期 |
| src/schedule.ts、schedule-store.ts、ui/schedule-menu.ts | 386、153、105 | 已按职责导入；存储改为本包按主会话目录，文件协议与 tasks 共用异步锁和原子提交；保留 cron/单次/周期、普通 run 与通知，长延时分段与原生值选择取消 |
| src/workflow/* | 4567 | 导入；runtime.ts 1219 行拆分；gate 在 cwd 执行，不再依赖 worktree；工具名 agent_workflow |
| src/ui/workflow-card.ts、workflow-dialog.ts、workflow-menu.ts | 470、1115、193 | 导入，workflow-dialog 拆分；显示行接入 dock |
| src/cross-extension-rpc.ts | 221 | 按职责导入到 agents/rpc，保留五通道与版本 2；会话注册、模型、归属、启动等待和消费接入共享框架；未知与内部参数报错，生命周期从公共 Manager/SDK 发出 |
| src/settings.ts | 650 | 设置项并入共享配置 agents 节；不导入独立设置界面，仅按类型的模型与 thinking 由 /agents 写回配置，见 [模型与 thinking 配置](agents/models.md) |
| src/memory.ts、usage.ts、prompts.ts、skill-loader.ts、context.ts、env.ts、structured-output.ts、status-note.ts | 179、167、171、102、58、33、130、90 | 导入 |
| src/model-resolver.ts、model-scope.ts、enabled-models.ts | 118、70、180 | 导入；model-resolver 对配置与参数中不可用的模型报错并指出来源，不换成其他 provider 的同名模型 |
| src/package-resources.ts | 652 | 导入，保留项目信任判断 |
| src/agent-color.ts、agent-source-badge.ts、agent-file-toggle.ts | 161、75、297 | 导入，用于 /agents 列表与类型开关 |
| src/child-context.ts、abortable.ts、xml.ts、types.ts | 15、43、13、404 | 导入，types 删除 worktree 字段 |
| src/ui/conversation-viewer.ts | 790 | 不导入渲染；保留 x 两次停止、Enter 引导输入、b 转后台的操作语义，查看器复用共享 transcript |
| src/ui/agent-widget.ts、fleet-list.ts | 661、559 | 丢弃实现；计数由 StatusPublisher 发布，详情行交给 dock |
| src/ui/select-item.ts、viewer-keys.ts | 45、39 | 导入 |
| src/worktree.ts | 205 | 丢弃 |
| src/output-file.ts | 164 | 丢弃：Claude Code 兼容 JSONL 副本，agent_read 直接读取 child 会话 |
| src/index.ts | 4367 | 不整体导入；按职责拆入 agents/tools、commands、rpc、index，保留会话关闭的停止顺序与 ctrl+b 转后台 |

依赖：croner；nanoid 用 node:crypto 替代。

## @tintinweb/pi-tasks 0.9.1

| 文件 | 行数 | 处置 |
| --- | --- | --- |
| src/task-store.ts | 402 | 导入改造至 tasks/store、model。保留 pid:uuid 锁、原子保存、锁内重读和边界加载；等待改为异步，增加 parentId 两级约束、版本号与批量事务；保留 blockedBy 双向关系及自引用/不存在/二元环警告，反向边从保存数据派生 |
| src/task-paths.ts | 65 | 会话路径逻辑导入 tasks/index，默认会话级存储 `<cwd>/.pi/tasks/tasks-<sessionId>.json` |
| src/types.ts | 40 | 改造：状态改为 todo、doing、done，增加 parentId |
| src/reminder-cadence.ts | 90 | 规则导入 tasks/index：任务长时间未更新时注入一次临时提醒，执行中缩短间隔；共享配置可关闭 |
| src/tasks-config.ts | 77 | 并入共享配置 tasks 节 |
| src/index.ts | 1417 | 不导入工具实现，按 task_list/task_edit 重写；new/resume/fork 重置、fork 继承父清单、工作区切换时重新定位存储与 --no-session 内存模式导入 tasks/index；reload 后按 agentId 重新关联执行任务随 agents 接入 |
| src/auto-clear.ts | 134 | 丢弃：按轮次删除已完成任务，与“折叠只改变显示”的规则冲突 |
| src/task-sort.ts、task-glyphs.ts | 90、110 | 丢弃：显示由 dock 统一处理 |
| src/process-tracker.ts | 140 | 丢弃：上游工具未调用，进程由 JobManager 管理 |
| src/ui/task-widget.ts、ui/settings-menu.ts | 325、174 | 丢弃，由 dock 与配置文件替代 |

TaskExecute 的自动级联（autoCascade）默认关闭，不导入；执行任务使用 agent_start 的 taskId。

[返回扩展包待办索引](index.md)
