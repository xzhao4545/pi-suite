# 基线与验证

本页记录版本基线、支持范围、各模块的验证结论和未覆盖项。逐项检查、样本与耗时见各处链接的归档页。

## 基线与依赖

| 项目 | 当前值 |
| --- | --- |
| Pi peer 与开发依赖 | `@earendil-works/pi-coding-agent`、`pi-ai`、`pi-tui` 的 peer 为 `>=1.6.1`，开发依赖精确锁定 1.6.1 作为验收基线，使用官方未修改的包及新作用域 API；组件 `render()` 按 1.6 的 `readonly string[]` 契约透传，不原地修改子组件输出 |
| typebox | 1.3.27 |
| 调度运行依赖 | croner 10.0.1 |
| 运行环境 | Node.js 24+，pnpm 12.6.0 |

- Linux 按操作系统能力验证，复用已有 Node.js/nvm 环境，不安排发行版专项或安装新发行版。
- 非交互 shell 先加载 nvm 初始化脚本，再解析 `node` 命令。
- 公共基础检查另在 Linux 已有 WSL/nvm 环境（Node 24.14.0）与 Windows 通过，见 [目标基础阶段](../finished/pi-suite/goal-core.md)。
- `pnpm-workspace.yaml` 的 `supportedArchitectures` 为 Windows/Linux 保留平台可选依赖，使共享依赖目录包含 TypeScript 7 的两平台编译器。

| 模块 | 上游基线 | 许可证 |
| --- | --- | --- |
| ask | pi-ask-user 0.17.2 的工具契约；交互重构到公共 runtime/ui | [许可证](../../third-party/licenses/pi-ask-user.txt) |
| goal | @narumitw/pi-goal 0.54.15 的工具契约与控制语义；生命周期接入 Pi 1.5.0 的公共最终结算接口 | [pi-goal MIT](../../third-party/licenses/pi-goal.txt) |

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)；所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

## 官方宿主与支持范围

- 验收基线为官方未修改的 Pi 1.6.1；下文各专项验收记录注明了实际使用的 Pi 版本。`dist/bundle/cli.js` 与 `dist/bundle/rpc-entry.js` 通过真实加载与运行验收，见 [官方 Pi 兼容验收](../finished/pi-suite/official-pi-compatibility/validation.md)。
- Linux PTY/xterm 覆盖 regular/fullscreen 下的 Tasks/Subagents/Jobs、Dock、正文搜索、工具键盘展开、活动 child 的中文原生 Editor、持久 clone、resize、返回和自然退出。本地 HTTP SSE 覆盖 Responses 保存、重启 resume，以及同模型/跨模型的原版 phase 行为。
- 包为 `private: true`，未发布到 npm。消费者 Git/本地包及 tarball 安装延期，不计为通过，见 [安装验收边界](../finished/pi-suite/official-pi-compatibility/index.md#状态与执行权限)。
- 未证明的范围：实体人工终端、Windows 人工交互、外网账号/组织权限、真实上游密文解密、中转粘性。各平台专项的结论不扩大到这些范围。

| 宿主边界 | 当前结论 | 详情 |
| --- | --- | --- |
| 阅读 | 使用公开组件、共享显式预算与唯一 `scrollTop`，滚动条隐藏；复杂阅读 overlay 的区域鼠标焦点、嵌套单项工具命中和滚动条轨道/拖动不在保证范围 | [终端交互](ui/terminal.md) |
| 任务与 fork | 持久源按 LF/UTF-8 只读首头并取完整独立快照；内存 fork 明确提示任务不自动继承 | [任务存储](tasks/storage.md) |
| 模型运行时 | 受守卫地保留父级私有 `ModelRegistry.runtime`；同一 runtime 的受控 Provider、临时 API key 与虚拟路由聚合通过；失效时明确拒绝，不切换默认 runtime | [模型边界](agents/models.md#模型运行时桥接) |

## 平台范围

| 平台 | 验证环境 | 结论 |
| --- | --- | --- |
| Linux | 同版本 SDK、官方实际 Node bin/RPC 与发布 CLI；模型请求使用离线 faux Provider 或本地受控 SSE | 各模块结论按 [模块结论](#模块结论) 所列版本与范围读取 |
| Windows | 实际 Pi 1.5.0 CLI、ConPTY、真实进程与 SDK，Node 24.22.2 | 完整检查 158 项与类型检查通过，无失败、跳过或取消；验收范围仅为 Windows，见 [Windows 阶段](../finished/pi-suite/jobs/windows-runtime.md) 与 [收尾记录](../finished/pi-suite/windows-completion.md) |

Windows 已验证：

- 完整检查覆盖受控 SDK、组件、Worker、真实进程与 ConPTY 路径，包括共享 wait 提前返回、`goal_wait` 的 `waitFor`、终端视图与 monitor。共享 JSON 快照与写入竞争经实际并发读写及 tasks/schedules 检查验证。
- 实际 Pi CLI：40/60/120 列 PTY 缩放与输入、接管/交还、退出清理；原生类型模型写回后 RPC/单次调度/workflow 的模型与 thinking；公开 RPC 五通道、调度详情与 Esc、shell gate、共享 wait、job 日志查看/停止/历史删除和自然退出。终端缩放见 [运行时验收](../finished/pi-suite/jobs/windows-runtime.md)。
- 实际 Pi CLI 的前导 `@` 复杂正文、reload/new 不重放、会话身份与自然退出，见 [Windows CLI 阶段](../finished/pi-suite/jobs/windows-cli-ui.md)。
- Codex 0.162.1（exec_command）与 Claude Code 2.1.301（Bash/Read）：pipe 工具的文件字节、回复、自然退出与长工具停止通过；复杂正文、用户接管输入、模型交还输入、主对话回复及进程树停止确认通过。使用本地受控 SSE 与隔离配置，不等同真实外部服务或 Windows 文本 PTY 接管。
- footer：pi-starship 0.65.2 与 Pi 原生 footer 在 40×24、60×30、120×40 下核对目标、任务、child、job 与询问；实际 `extension_status` 模块核对 goal/runtime 槽位读取、数量上限与空状态。用户实际 Starship 根 format 缺少 `$extension_status` 时状态不可见，用户配置保持原样，隔离副本可通过 Dock 明示，见 [CLI/footer 验收](../finished/pi-suite/jobs/windows-cli-ui.md)。
- 原生组合覆盖询问/通知、两级任务、模型与 @handle、调度、workflow/child 查看、持久历史与主从交互、Pi 预设，以及监督/输出/屏幕和只读边界，逐项范围见 [完成索引](../finished/index.md)。实际业务 RPC 使用 pi-tasks 0.9.1，见 [跨扩展验收](../finished/pi-suite/agents/windows-rpc.md)；实际外部 MCP 使用 Context7 4.5.0。离线 Provider 只控制模型请求，真实进程、SDK、TUI 与外部文档查询按各专项验证。
- 上游固定版本的静态结论与当前运行层次见 [Windows 问题追踪](../finished/pi-suite/windows-baseline.md)。

不覆盖或不计为通过：

- Cursor 实际 agent CLI：命令缺失，不在验证范围。
- 手机 SSH 专项取消；跨设备 Linux 验收由用户后续处理。
- Windows 结论不推及 Linux；Linux 各模块结论也不推及 Windows，除非对应条目链接了 Windows 验收页。

## 模块结论

除另行标注外，本节结论来自 Linux、Node 24.22.2、官方未修改 Pi 1.5.0。模型请求使用 SDK 自带 faux Provider 或本地受控 SSE，不调用收费模型 API，不代表生产缓存率或费用。

### ask

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 契约 | 默认值与草稿、批量最终确认、预选/推荐身份、四种结果状态（answered/skipped/timed_out/cancelled，只有 cancelled 终止）、空闲期限重置、自动答案优先级与未回答位置通过。模型结果的 content 与 details 分离；短题上限 24 个 Unicode 码点，重名标 #N；删除题目只删除该题 context | [Ask 交互](../finished/pi-suite/ask/interaction.md)、[交互细化逐项验收](../finished/pi-suite/interaction-refinement/validation.md) |
| 实际 CLI | 40×24、60×30、120×40 PTY 中，题型标记与配色、页签与鼠标切题、筛选外勾选、文本光标、自由输入、草稿保留、Review 提交与未回答拒绝、按键/滚轮重置期限、到期自动答案、顶层 Esc 跳过与再次 Esc 中断通过；实际 CLI 平台仅 Linux | [Ask 交互](../finished/pi-suite/ask/interaction.md) |
| 协调 | 原生询问期间，child 的父级问题与 job 完成暂存，结束后与 goal 请求合并为一条消息；父级问题依次展示，排队题不启动期限；系统取消后 goal 等待新的用户 prompt，skipped/timed_out 保留自动许可；child 问题的父级协议期限独立管理 | [询问协调阶段](../finished/pi-suite/ask/coordination.md)；Windows 见 [询问验收](../finished/pi-suite/ask/windows-combination.md) |

### goal

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 工具契约 | 空白参数返回 `INVALID_ARGS`；错误或缺失的 goalId 返回 `NOT_FOUND`；wait/block 在非 active 或仅结案轮返回 `NOT_RUNNING`；修订、绑定或请求取消代次失效，或非所属会话，返回 `STALE_BINDING`。新的用户审计轮可直接完成 paused，completed 幂等；工具错误经共享 `ToolError` 保留错误码与调用的 goalId | [目标接口](goal/operations.md) |
| 生命周期 | 真实宿主核对正常继续、重试成功/耗尽、手动与阈值/溢出压缩、压缩取消、Esc、未回答询问、预算、reload、new/resume/fork、树切换和期限恢复；压缩摘要由公共 hook 提供。独立结案权限、pause/clear、quit 与真实 SIGKILL 后的冷恢复（需手动 resume）通过 | [交互细化逐项验收](../finished/pi-suite/interaction-refinement/validation.md) |
| 请求合同与自动续跑 | 无压缩连续 20 次自然工具请求和 20 次边界续跑均只交付一份完整目标说明；usedTokens 与状态保存在当前 Store/UI；必要短控制只追加、不移除历史；其他提示节、动态工具增删与真实事件保留。Completions/Responses 中途更新与折叠的四种序列化组合保留强制 head、合同与工具声明。自动轮连续五轮无工具或活动相同时停跑，原因持久；用户审计与显式 resume、变化的只读研究、等待、reload/compact 与真实后台唤醒权限通过 | [续跑验收](../finished/pi-suite/goal/context-optimization.md) |
| 状态与上下文 | 每个主会话一份 version 1 当前文件，兼容导入 JSONL 中的 Goal version 1/2；同会话 tree/reload 共用当前状态，new/fork 默认无 Goal；暂停原因与显式恢复许可不随旧分支回滚。真实 SDK/本地 HTTP 比较正常续跑的完整 input 前缀及系统、工具、缓存键，控制、用量与 UI 更新不移除前次 Goal 历史；单文件导入/clear、迟到计量、存储错误、冷启动、混合通知、等待、预算、停跑、强制提示与压缩通过；外部 GoalStore 更新沿用共享订阅 | [Goal 状态与上下文验收](../finished/pi-suite/goal/goal-state-context/validation.md) |
| 界面 | 实际 Node bin 的 regular/fullscreen 在 40/80/120 列覆盖 `/goal pause`、恢复一行摘要、Ctrl+O 原生展开/收起与前次原因，阅读不增加模型请求。宿主被普通输入占用时 `/goal resume` 即时显示 `Goal resumed · waiting`，目标已运行时显示 `Goal already running`。混合 job/agent 通知与 `/reload` 历史重建保留真实事件，隐藏结构化 Goal 控制片段。原生 custom message 不提供单消息鼠标展开，不模拟点击 | [Goal 与 Responses 恢复归档](../finished/pi-suite/goal/goal-responses-recovery.md) |
| Responses 恢复 | 10 组聚合覆盖真实 SDK serializer、HTTP/SSE、boundary/context_edit 与原生重试：资源 400 的 ID-only 修复；429/503/网络错误后成功；有限预算耗尽时保留最后错误；无新 ID 不重复恢复；默认关闭，拒绝不安全请求；普通参数/权限/额度/上下文错误不接管；暂停后的迟到成功被拒绝；两种公开边界扩展顺序；分支/端点/实例隔离。工具副作用不重放，原始失败保留，Goal 最终结算暂停。两种 Model Manager 加载顺序、两个并发 childSuite 请求，以及与 pause/clear/edit/replace/abort/new 的会话竞争通过 | [Responses 恢复](runtime/responses-recovery.md) |

未验证：Windows 上的 goal 新行为、真实上游密文解密、全部第三方版本、生产缓存率或费用。

### tasks

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 存储与编辑 | 两级批量原子编辑、稳定短 ID、移动与重新打开后的派生进度、依赖反向关系与警告通过。两个真实进程并发写同一文件、异步锁等待、无效文件与取消均不覆盖既有内容。组号独立，子任务编号用 `nextChild`，同一 generation 内不复用已删除编号；version 2/3 经校验后在内存迁移并映射依赖，提交时写 version 4。全部完成或 owner clear 时原子清空、重置编号并轮换 generation；旧的排队写入/link 与 child assigned 恢复明确拒绝 | [交互细化逐项验收](../finished/pi-suite/interaction-refinement/validation.md) |
| 会话 | new/resume/fork/reload 各自独立持有清单；内存模式与 job 引用通过。自然 completed 的 turn_end 任务提醒写入持久 transcript，不请求新模型轮；doing 间隔、generation 与项目级关闭配置生效 | [任务存储](tasks/storage.md) |
| 工具协议 | Provider 转换后的 object schema、查询修正、按记录字节预算分页与组上下文、单操作与原子批量、多 doing、手动与依赖阻塞、共享目录监听、稳定浏览身份、单次通知/问题交付、真实停止清理、累计运行计时及取消/恢复交错通过。时钟 tick 不持久写入，也不发模型请求 | [专项验收](../finished/pi-suite/tool-protocol/reference-validation.md) |
| 子代理集成 | 多个 child 同时读写同一 TaskStore 后保留 status/description/owner 与派生进度；持久主会话 reload/fork 期间存活 child 保留原清单，fork 得到独立副本，回收后经 agent_send 回到原 owner 时恢复，agent/task 引用稳定。child 完成或停止不自动把任务改为 done | Windows 见 [任务验收](../finished/pi-suite/tasks/windows-combination.md) |

### agents 与 workflow

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 执行核心 | 真实 SDK child 覆盖两池队列与排队停止、原生前台问题/回答、嵌套调用不占池位、共享 TaskStore、run 恢复与结束叶子、配置模型来源、真实 abort 与问题超时；已结束 child 的遗留 job 被清理，同级 job 保持运行 | [执行基础阶段](../finished/pi-suite/agents/core.md) |
| 停止竞争 | 同步 abort/event/changed 重入只清理一次；整批排队目标取消且回调 drain；清理期间与 task I/O 后的新 run 准入正确；停止旧 run 不影响新执行；回收后代按祖先清理；授权等待期间停止会阻止后续启动；父级最终结算等待全部 child 与 job 清理完成，并保留正确终态和错误 | [生命周期阶段](../finished/pi-suite/agents/lifecycle.md) |
| 主从交互 | 多 run 的读取与通知消费隔离、边界合并；旧 run 的 wait others 返回；多 child any/all、ids 外问题优先、状态/活动数量/进度读取与提问消费通过。嵌套 FG/BG 问题只到直接父级；主会话 Esc 或 wait 超时后 child 保持 waiting，回答后可继续结算 | [主从交互专项](../finished/pi-suite/agents/interaction.md)；Windows 见 [历史交互验收](../finished/pi-suite/agents/windows-history.md) |
| 进度与通知 | 并发工具参数摘要与有界正文、排队/等待父级状态、活动用量与流式进度通过；稳定 agent ID 汇总全部 run 根与回收后代的所属 job；正文列最近 20 个 run，不截断 details 或归属集合。创建归属查询不可用时给出明确原因；失败通知含实际用量与错误；读取会撤销该 run 的待发结果 | [主从交互专项](../finished/pi-suite/agents/interaction.md) |
| 模型配置 | `/subagents` 类型写回后无需 reload，agent_start、调度与 workflow 的新 child 使用当前类型配置，显式参数优先；已准入请求与 workflow 固定 resume 保持原契约；认证丢失明确报错且不创建替代 run；取消不写入；逐字段配置位置、删除后的用户值与无效文件拒绝通过。interactive `@类型` 输入用父模型 clone 整理任务，child 使用类型模型；@handle 对结束记录与回收后的持久恢复保持 individual 优先级与历史实际模型；父模型不被改写 | [入口组合阶段](../finished/pi-suite/agents/models-entrypoints.md)；Windows 见 [模型验收](../finished/pi-suite/agents/windows-models.md) |
| @handle | Pi 原生补全下 handle/alias 唯一与恢复、会话过滤、排队消息、文件与命令补全并存、CJK 前缀与重复绑定通过。clone 使用当前父级上下文，只持有一个启动工具，重复调用只启动一次；切换事件取消流式 clone 并拒绝后续启动；clone 未调用工具时明确报错；配置关闭、裸名称、文件、普通文本、图片、非用户与 print 输入保持原语义 | [@handle 基础阶段](../finished/pi-suite/agents/mentions-core.md)；Windows 见 [模型与 handle 验收](../finished/pi-suite/agents/windows-models.md) |
| 类型开关与回收 | enabled 逐字段来源、规范类型身份、定义恢复与模型字段保持通过；普通/嵌套/恢复/workflow 的新调用按当前开关准入，已准入执行与固定 child 续接不受影响。回收前检查活动执行、未消费通知、多 reader 引用、非持久历史与祖先归属；job 清理失败时仍等待 child 结算，后续 stop 可重试 | [类型开关与回收阶段](../finished/pi-suite/agents/types-retention.md)；Windows 见 [模型验收](../finished/pi-suite/agents/windows-models.md)、[历史交互验收](../finished/pi-suite/agents/windows-history.md) |
| 资源 | 包声明、字段优先级、门控、精确排除、目录/单文件、同名类型覆盖、项目信任与路径/符号链接边界通过；被排除的扩展工厂不执行，本包不重复加载；晚注册工具与首请求扩大的工具集合受直接/嵌套调用限制。技能完整预加载一次，memory 只读/读写目录、前 200 行写入提示（见 [资源](agents/resources.md)），父级文本不含工具结果，frontmatter 运行选项、会话目录、隔离提示与嵌套准入通过 | [资源基础阶段](../finished/pi-suite/agents/resources-core.md)；Windows 见 [Context7 验收](../finished/pi-suite/agents/windows-context7.md)、[历史交互验收](../finished/pi-suite/agents/windows-history.md) |
| MCP | 本机 stdio 协议夹具覆盖原生传输与 discovery、`mcp__` 服务器名单与显式资源 helper 并存、禁用与未选服务器不执行、child 结束后服务进程全部退出、原生 codemode/tool_search、晚注册工具在下一请求生效、隔离与不可信项目不连接。跨 cwd RPC 只加载用户级 MCP，不加载父项目或目标项目的 MCP。Windows 实际外部服务为 Context7，不推及 OAuth 或其他服务 | [MCP 阶段](../finished/pi-suite/agents/mcp-transport.md)；Windows 见 [Context7 验收](../finished/pi-suite/agents/windows-context7.md) |
| 调度 | 六字段 cron、周期与相对/ISO 单次、无效时间、远期延时、文件竞争只准入一次、损坏文件保留通过；普通池满时仍立即启动并计数，触发时使用更新后的类型选项；new/resume/reload 按 owner 恢复期限；模型不可用时保存并通知错误，不替换模型。时区：纽约→UTC reload 保留已提交期限且恰好触发一次，后续 cron 用当前本地时区；日历夏令时日 23/25 小时，固定周期 24 小时；错过周期的恢复与 claim 共用原相位。实际 CLI：详情八字段、Esc 保留、确认删除后不触发；reload 继续，new 不继承，resume 对过期单次明确报错且不回放；quit 中断 child 并清理受管进程，退出码 0 | [时区阶段](../finished/pi-suite/agents/schedule-timezone.md)、[CLI 调度阶段](../finished/pi-suite/agents/schedules-cli.md)；Windows 见 [调度验收](../finished/pi-suite/agents/windows-schedules.md) |
| RPC | 五个公开 `pi.events` 通道与版本 2、工厂后注册、重复绑定、reload 撤销/恢复、生命周期与用量、同步消费不触发父级请求、待发通知撤销、已结束引导拒绝、启动错误与模型/参数校验通过；排队即时返回、信号取消、满池绕过、级联停止与会话/嵌套/workflow 归属拒绝通过。指定 cwd 保留父级配置/扩展并隔离目标信任；StructuredOutput 结果与父工作区列表通过。实际 CLI 加载独立外部 consumer（不导入本包内部类），两种加载次序、ready/ping v2、reload 后唯一回复、真实 steer 与 stop/quit 清理通过 | [独立扩展阶段](../finished/pi-suite/agents/rpc-cli.md)；Windows 见 [RPC 验收](../finished/pi-suite/agents/windows-rpc.md) |
| Workflow 核心 | 真实 Worker 覆盖流水线独立推进、parallel、嵌套阶段与共享并发/预算、结构化返回与 gate、排队期间暂停/跳过/重试与全部尝试用量。journal 只跳过成功且未改变的前缀；schema 重检、含 child resume 的整段执行、文件损坏与 I/O 错误明确报告；metadata 纯字面量、确定性 globals、未支持选项、agent/item/nested 上限、未等待调用通过，无限循环 Worker 被实际终止 | [编排核心阶段](../finished/pi-suite/agents/workflow-core.md) |
| Workflow 宿主 | 后台工具、结构化 child、cwd gate/短退出/EOF、列表与数量隐藏、共享等待消费、journal 重放与 SDK 引用恢复通过；固定 schema/model/type/tools 续接；父模型经 wait/agent_send 回答问题；workflow 与排队 agent 的 reload/new/resume owner 正确；quit 等待真实 gate 清理。资源优先级/信任/包门控、源码互斥、截断或损坏的 journal、工具开关撤销/恢复、动态类型描述、40/60/120 列与阶段/unphased 分组通过 | [宿主接入阶段](../finished/pi-suite/agents/workflow-host.md)；Windows 见 [查看验收](../finished/pi-suite/agents/windows-workflow-viewer.md)、[Context7 验收](../finished/pi-suite/agents/windows-context7.md) |
| 查看与控制 | 前台转后台释放调用，池计费转移，后台记录持久化，父级取消隔离与完成通知通过；workflow 问题回答、两次停止、搜索文字隔离、输入往返阅读状态、实际 child.cwd、并发部分结果与旧 run 延迟输入拒绝通过；Transcript 按 toolCallId 配对 partial/final 结果，组件身份与阅读位置在 40/60/120 列稳定 | [原生会话查看](../finished/pi-suite/agents/viewer-controls.md)；Windows 见 [Workflow 与 child 查看验收](../finished/pi-suite/agents/windows-workflow-viewer.md) |
| 所属 Jobs | 所选 run 子树与回收后代的 job 被列出，不同 cwd、同 agent 新 run 与无关 job 被排除；可单独停止选中 job；foreign PTY 历史只开放日志，隐藏 attach/stop；`modules.jobs=false` 保留同 owner 既有 job 查询，quit 完成清理 | [运行记录](../finished/pi-suite/agents/runs.md)；Windows 见 [查看验收](../finished/pi-suite/agents/windows-workflow-viewer.md) |
| 持久历史 | 默认/类型配置目录冷启动发现、目标 cwd 与 configCwd 归属、稳定分页与原生只读菜单通过；直接父级发送准入、跨工作区缓存、磁盘更新与本地编辑/真实执行优先通过。只读存储对缺失/未来 header、损坏 JSONL、无效记录、错误叶子与缺失文件给出明确结果，中断 owner 规范化为 failed，读取不改变原文件内容与 mtime | [持久历史](agents/history.md)、[历史发现阶段](../finished/pi-suite/agents/history-discovery.md)；Windows 见 [历史交互验收](../finished/pi-suite/agents/windows-history.md) |

### jobs

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 执行与停止 | 真实进程覆盖 pipe 的 stdout/stderr、退出码与耗时，stdin 输入与 sensitive 记录，进程树停止确认、重复停止，已结算的 job 不重复停止，timeoutMs，另一 manager 只读历史，按创建归属级联停止与停止期间的启动，quit 停止并关闭准入，PTY 输入与合并输出。独立进程组覆盖 pipe/PTY 异步 stop、pipe 同步退出、忽略 TERM 的后代、已重新挂到 PID 1 的原组成员，另一独立 job 不受影响。Linux 使用系统 bash；Windows 使用 Git Bash，测试在临时 agentDir 的 settings.json 中设置 shellPath | [工具执行阶段](../finished/pi-suite/jobs/cli-tools.md) |
| 会话保活 | job 运行期间执行 new/resume/fork/reload，进程不变、日志连续，只有所属会话收到一次结果 | [会话保活](../finished/pi-suite/jobs/session-lifecycle.md) |
| 等待与通知 | wait 撤销通知，轮后结算恰好唤醒一次，状态计数清除；列表筛选、参数冲突、job_stop 结果与不支持的通道报错通过。共享 wait：其他对象结算、ids 外的 child 提问、等待中与等待前的用户插话、超时均正确返回；mode all 在部分结算时不返回；等待一个 job 时另一 job 结算会提前返回且不重复通知；用户 steer 结束等待但不停止 job。`goal_wait` 的 `waitFor`：其他 job 结算不结束等待，恢复时合并送达，已结算 ID 不进入等待 | [主从交互专项](../finished/pi-suite/agents/interaction.md) |
| monitor | literal 与阈值 trigger、同行去重、冷却、detector 丢弃与改名、poll-diff 样本变化触发、file-watch 无 command 运行并在文件事件时触发通过；monitor 事件使等待自身 job 的 wait 提前返回，events 通道可读，已返回的事件不重复唤醒。detector 延迟最终结算时，对已观测到自然退出的 job 重复 stop 会等待完整事件，返回 `requested:false`、退出码 0 与 completed | [CLI 预设与启动基础阶段](../finished/pi-suite/jobs/cli-launch-core.md) |
| 输出读取 | 小日志全量返回；1 MiB 与 100 MiB 日志按头尾与中段关键行截断并给出续读范围；中文与 emoji 分页边界、搜索上下文、匹配上限续读、无效正则、PTY 回车覆写与重复行折叠通过。真实 PTY 中密码提示到 LF 的回显隐藏，从提示之后按原始 offset/search 读取；CSI/BS/中文宽字素、重复两行折叠与 fullScreen 提示通过。原始日志保留真实字节，sensitive 输入不保存正文，终态 outputPreview 不超过 2 KiB，预览与完成结果同条投递；job/agent 读取的上下文、keys 原始范围、预算与 more 提示续读通过 | [输出读取阶段](../finished/pi-suite/jobs/output-core.md)；Windows 见 [监督与输出验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| 超长行 | 100 MiB 单行的起止锚定、未命中、中文跨块、空行、原始 offset 续读与默认关键行预算通过。含中文单行的 Unicode 正则可能耗尽 V8 栈，此时输入保持原样，求值 RangeError 报告为 `REGEX_RESOURCE_LIMIT`；job_read/agent_read 直接调用与工具管线保留该错误，失败不消费结果、不增加模型请求。单行组装为线性，缓冲与解码内存随行长增长；任意正则不保证执行时限 | [长行阶段](../finished/pi-suite/jobs/long-line.md) |
| 屏幕 | 真实 PTY 覆盖垂直重绘、备用屏幕切换、覆盖帧、停在备用屏幕、先回主屏再退出；同 owner 最后一屏、终态原生快照与无快照历史为只读。当前画面由 xterm 维护，线性 reader 不还原二维历史 | [屏幕范围](../finished/pi-suite/jobs/screen-range.md) |
| 终端接管 | 实际 CLI 在 regular/fullscreen 与 40/80/120 列直接 PTY attach：配置的离开键优先、接管/只读提示、真实输入消费、缩放、交还与重新接管、离开后 job 继续、命令区焦点下退出、原编辑器恢复与正常 quit 通过。用户接管后模型写入返回 `USER_CONTROL`；Ctrl+G 交还，Ctrl+T 带回含双方输入的屏幕，Ctrl+] 离开后 job 继续运行。PTY 组件的自定义键、光标、反馈/确认时保留退出提示与逐区高度预算通过。嵌套程序自身的退出与 PTY 结算不由提示栏检查代替 | [终端缩放阶段](../finished/pi-suite/jobs/terminal-resize.md)（控制台 ioctl、同 stdin 的 stty 与 SIGWINCH） |
| hands-free | 静默/定时增量更新、单次与总输出预算、暂停与释放、真实 PTY 的宽限期与用户接管、静默终止的进程组清理、总运行超时与自行退出、wait 返回更新后的去重、reload 后 `goal_wait` 恢复通过 | [hands-free 基础阶段](../finished/pi-suite/jobs/hands-free-core.md)；Windows 见 [监督与输出验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| CLI 启动 | 预设字段合并、真实 Bash 的字面量 prompt 与 Pi fork 参数、非交互直接执行与参数互斥通过。实际 Pi CLI：fork 源会话保持原文、复杂 prompt、PTY 接管/交还/离开与确认清理；前导 `@` 经原生 flag/input 桥恢复，保留附件与 JSON 事件；默认 pipe 通过 EOF 直接启动；RPC 初始 prompt 明确拒绝；print/JSON 中 `--system-prompt '-e'` 与 `--append-system-prompt '--'` 保持值边界。同名文件不读取、fork 新身份且源字节不变、自动发现与显式入口去重、PTY 后续输入、reload/new 不重放与自然 quit 通过；正文恢复后保留普通 input 与提及分派语义 | [原文初始任务阶段](../finished/pi-suite/jobs/literal-prompt.md)；Windows 见 [预设验收](../finished/pi-suite/jobs/windows-pi-presets.md)、[监督验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| 直接启动 | 模型经 job_start 直接启动普通 command、CLI 预设与带 detector 的 monitor，实际输出与 monitor 事件一致；`/suite` 中没有启动策略字段；自然 quit 退出码 0 | [直接启动专项](../finished/pi-suite/jobs/launch-confirmation.md) |
| 外部 CLI（Linux） | Codex 0.166.0 与 Claude Code 2.1.153 经实际预设/JobManager PTY 与本地受控服务：复杂初始正文、用户输入与交还后的模型输入逐字进入主对话 HTTP 请求，CLI 显示对应 SSE 回复，`USER_CONTROL` 与 `managed_scope_confirmed` 停止通过。Codex 隔离配置并使用 `--no-daemon`；Claude 使用 `--bare`、空配置/工具与本地测试密钥。工具模式下 Codex exec_command、Claude Bash/Read 的文件内容与实际工具结果一致，日志与当前屏幕按既有边界读取；Codex 长工具的独立进程组后代实际消失并列入身份 scope，另一 job 不受影响。本机 workspace-write 被 bwrap 阻断，成功执行仅使用隔离的临时 danger-full-access 配置。结论只覆盖上述版本的 Linux 文本交互 | [CLI 文本阶段](../finished/pi-suite/jobs/cli-pty.md)、[工具执行阶段](../finished/pi-suite/jobs/cli-tools.md)；Cursor 见 [Windows 收尾记录](../finished/pi-suite/windows-completion.md) |
| 技能 | `package.pi.skills`、包管理器/ResourceLoader/SDK 发现、原生 `/skill` 调用通过；`jobs=false` reload 撤销 jobs 工具并保留 ask_user。技能先核对实际可用工具；模块开关不影响 Pi 包级资源发现 | [技能发布阶段](../finished/pi-suite/jobs/skill.md) |
| 日志查看 | 底部实时跟随、滚动与搜索保留位置、UTF-8 分次写入、关闭详情后进程继续、退出后补读最终输出通过；历史有界尾窗、按字节前后翻页、字面量 Markdown 与 40/60/120 列渲染通过；同一筛选集合插入新记录后游标稳定，session/workspace 范围与已结束详情正确 | [日志查看基础阶段](../finished/pi-suite/jobs/log-viewer-core.md)；Windows 见 [运行时验收](../finished/pi-suite/jobs/windows-runtime.md)、[输出验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| 历史清理 | 活动或磁盘未确认的记录拒绝删除；settlement/inputQueue/saveQueue 完成后删除元数据与全部日志，晚到的消费不重建；阻塞期间未读通知被撤销；原生取消/确认与 foreign 历史删除通过。只读 agents 历史与受限执行协议隐藏删除入口 | [历史清理阶段](../finished/pi-suite/jobs/history-clear.md)；Windows 见 [运行时验收](../finished/pi-suite/jobs/windows-runtime.md)、[输出验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| 升级控制 | 执行协议不兼容时，查询、日志、停止、按 ID 等待、活动计数与 quit 可用，新启动与写入明确拒绝，占用注册与退出监听保留，空闲时替换、历史只读。不同 agentDir 或缺少兼容控制桥的占用注册不可接管。创建归属查询返回完整 owned 集合与副本，跨 cwd/owner/branch 正确：v3 控制桥提供完整 sessionJobs/createdBy；v2 保留 createdBy；v1 拒绝创建归属查询；v1/v2 拒绝完整 session 列表，状态只投影当前分支直属活动 job 并提示一次范围，workspace 读取、停止与 quit 保留 | [升级控制基础阶段](../finished/pi-suite/jobs/runtime-control-core.md)；Windows 见 [监督验收](../finished/pi-suite/jobs/windows-supervision-output.md) |
| 会话可见集 | session 列表、状态数量与稳定分页使用同一集合：当前 owner/branch 的直属执行，加上可见 agent 全部 run 根与回收后代的所属 job，跨 cwd 一致；workspace 不扩大目录范围。存储 await 期间的结算以返回时的 owned 副本为准；主级可见 child job 不转移结果通知 owner；agents 禁用后仍按当前分支保存的记录保留遗留 job；v2 受限计数与完整 session 查询按边界拒绝 | [运行记录](../finished/pi-suite/agents/runs.md)；Windows 见 [询问与界面验收](../finished/pi-suite/ask/windows-combination.md)、[历史交互验收](../finished/pi-suite/agents/windows-history.md) |

### UI 与 Dock

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 启动、设置与退出 | 真实 Pi TypeScript 加载、完整集合筛选、稳定身份、窄屏阅读、配置锁与两层覆盖、设置保存与 reload 准入通过。实际 CLI 的 `/exit` 在空闲、生成、工具执行与压缩中均可取消，PTY 被清理，终端恢复 | [交互与启动专项](../finished/pi-suite/interaction-improvements/index.md) |
| 剪贴板 | 独立 tmux 中 Pi 原生 OSC 52 在 external 模式被阻断，在 on 模式转发中文多行内容；用户确认 Linux/SSH/tmux 全屏拖选可在本机粘贴 | [交互与启动专项](../finished/pi-suite/interaction-improvements/index.md) |
| 取消 | Pi 1.5.0 原生终端分发与焦点编辑器覆盖普通/全屏下的正文与思考取消；AbortSignal 与 aborted 结算一致，取消后不产生 delta；用户复测确认 Esc 正常中断 | [专项验收](../finished/pi-suite/tool-protocol/reference-validation.md) |
| 工具显示 | 结果隐藏调用、partial 一行、outputPad 与宽度、默认展开正文与错误全文通过。实际 CLI 在 40×24、60×30、120×40 下：全部 Suite 工具折叠，单项鼠标展开与 Ctrl+O，sensitive 隐藏，Ask History 与实际 child renderer 一致 | [工具显示](../finished/pi-suite/tool-display.md) |
| 任务 Dock | 任务 Dock 与可编辑 Ask 并存，默认 All，完成项 dim 加删除线，迁移后的文件可继续编辑。父行先分配高度，剩余预算给相邻展开的 child；blocked 完成与重新打开、选中项稳定 ID、询问期间按实际子任务计数通过。40/60/120 列下完成比例、完成反馈与共享详情阅读状态保持。自动/主动清空、generation 与过期引用、恢复基线与五秒反馈通过。共享发布器接收必要的 agent/job 详情：数量不变时问题、清理与选择变化仍刷新详情，相同内容去重 | [Tasks 显示](../finished/pi-suite/tasks-display.md)、[交互细化逐项验收](../finished/pi-suite/interaction-refinement/validation.md) |
| 底部布局 | 实际 CLI 的 24/30/40/60 行与 40/80/120 列组合通过；低于 18 行时显示摘要，低于 5 行时使用询问预算。Dock 与 Ask 预算独立；焦点组任务顺序与溢出、分区/询问边框、切题/筛选时高度稳定、展开与全文、文本与 Review 阅读、鼠标页签、多行选项、预览滚轮、缩放时草稿保持与关闭后恢复通过；原生 SDK 核对通知协调与 footer 共存 | [底部布局专项](../finished/pi-suite/ui/dock-ask-layout.md) |
| Subagents 导航 | 根导航连续交接与实际一/两行信息预算通过。官方 CLI 在 regular/fullscreen 下逐帧检查同步绘制输出的 tabs、进入历史与返回；原生 TUI 覆盖延迟、resize、构造失败、输入焦点与新旧 reader dispose | [交互细化逐项验收](../finished/pi-suite/interaction-refinement/validation.md) |
| 执行界面 | 实际 CLI 在 40×24/120×40、regular/fullscreen、dark/light、原生/第三方 footer 的 16 种组合下通过：真实 PTY 屏幕、输入、尺寸与转交；独立 pipe 流与结算后补读；Subagents 底部信息与中文多行 Editor；失败草稿与旧 run 拒绝；18 行编辑；嵌套 Esc、双左与主输入焦点恢复。原生百分比 overlay 与 reader 预算随 resize 一致；第三方 footer 的实例、订阅与分支更新保持；pi-starship 0.65.2 实际发布入口在 40×24 regular/light 与 120×40 fullscreen/dark 下查看往返、输入焦点与分支更新后持续显示。跨进程终态快照与危险操作权限由真实进程/存储契约核对。不支持：文字终端之外的图像协议、完整过去帧、跨进程输入控制。实际 CLI 平台仅 Linux | [执行界面专项](../finished/pi-suite/ui/execution-ui/index.md) |
| Starship footer | 从开发依赖加载 pi-starship 0.65.2 实际发布入口：goal_wait、tasks、运行中 child、两个 job 与主询问在 40×24、60×30、120×40 下并存；实际 emoji 与 24 位样式、`max_statuses` 插入顺序、disabled 或缺失的 `extension_status`、整体换行与显式 Dock 显示通过；询问期间 job 结算不增加模型调用。终端尺寸由受控 fixture 驱动。布局使用独立的空闲 Dock/询问预算，因为任意用户 footer format 没有可靠的公共高度反馈 | [Starship footer 联动阶段](../finished/pi-suite/footer-integration.md)；Windows 见 [CLI/footer 验收](../finished/pi-suite/jobs/windows-cli-ui.md)、[询问组合](../finished/pi-suite/ask/windows-combination.md) |

### 运行时与模块准入

| 范围 | 结论与边界 | 详情 |
| --- | --- | --- |
| 模块准入 | ctx.cwd 与 process.cwd 不同时按 ctx.cwd 读取项目配置；工具/命令注册与手动 active-tool 选择、首次 mentions 补全、new/resume/fork/tree 重绑与 reload 重新准入通过；child 的配置根与实际工具目录分离。goal 模块未创建时，startup/重绑/reload/quit 保留其他 provider 的 goal 状态；活动摘要与必要详情未变时不重复写状态、不请求 Dock 重绘。全部模块禁用后 reload 保留既有 job、SDK child 与 workflow Worker；quit 经既有 owner 注册等待 child/session、Worker、job/gate 真实结算与清理，不创建新运行时 | [扩展包架构与发布](../finished/pi-suite/architecture.md) |

## 性能验证方法

源码入口、renderer 提前注册与首次就绪边界见 [公共运行时](runtime/index.md#加载与首次就绪)。性能结论与样本见 [源码入口启动归档](../finished/pi-suite/interaction-improvements/source-startup-performance.md)。

1. 使用官方实际 Node bin/RPC 测量；不用 SDK factory 时长或源文件读取数代替真实就绪。
2. 固定宿主版本、配置、cwd 与资源集合。
3. 冷样本注明 Jiti 文件缓存与 Node 编译缓存状态；暖样本先预热。
4. 交替运行改动前后各至少五个独立进程，报告中位数、完整范围、阶段转移与首次使用代价。
5. 不清理用户缓存，不发送收费请求。

- RPC 首个状态响应、命令登记与文本查询只证明非 TUI 就绪；TUI 首屏、首次 viewer/Ask/PTY/child/workflow 与切换竞争按实际路径分别验证。
- 查看器延迟入口的聚焦检查覆盖导入、任务快照读取与返回选择期间的 SessionBinding 撤销，以及通知令牌在 finally 中释放。
- 不用源码 import 文本或固定文件数量的断言锁定实现。

## 当前测试集

```sh
pnpm typecheck
pnpm test
```

`pnpm test` 由 Node 内置测试运行器执行 `tests/**/*.test.ts`，以 `--experimental-transform-types` 加载 TypeScript，并发度为 4。

| 检查 | 环境 | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | Linux，Node 24.22.2 | 通过，约 2 秒 |
| `pnpm test` | Linux，Node 24.22.2，官方未修改 Pi 1.6.1 | 共 259 项全部通过，无失败、跳过或取消；约 62 秒 |

`tests/runtime/cli-host.test.ts` 的实际 CLI 用例使用 10 秒等待期限；与其他 CLI/Worker 进程同时运行时可能超时，单独重跑通过。

测试集覆盖询问、目标、任务、执行、子代理、workflow 与共享组件的当前契约。实际 Pi SDK 经原生工具包装器验证注册与结果；TUI 组件检查 40×24、60×30、120×40 下的询问高度与可见宽度；原生 footer 检查 40、60、120 列的状态行与宽度。平台与安装范围以 [平台范围](#平台范围) 和 [官方宿主与支持范围](#官方宿主与支持范围) 为准。

执行规则：

- 格式与类型检查在任务收尾统一执行，不在每个小改动或提交批次重复运行；聚焦测试按明确风险执行。
- 全量检查在临时 CLI 专项进程结束后单独运行，避免多组 CLI/Worker/CIM 同时启动影响就绪期限。
- 日常检查控制在 5 分钟内，全量检查控制在 10 分钟内。

[返回当前文档](./index.md)
