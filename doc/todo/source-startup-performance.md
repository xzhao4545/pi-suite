# 源码入口启动性能优化

## 状态与目标

用户已确认先不做预编译 JS 发布入口，只实施其他启动优化。共享 registry、资源路径和 Tasks 查看器边界已实施，Goal 详情按需加载已在目标模块实现；真实 CLI/RPC 对比与聚焦检查结论见下文。TUI 首次可操作、完整扩展集合和全部首次使用验收尚未全部完成，冷首次使用仍有明显阶段转移，本项保留在 todo，不归档。既有启动专项见 [启动性能优化记录](../finished/pi-suite/interaction-improvements/startup-performance.md)，本项补充源码入口、渲染依赖和查看器边界，不覆盖原有记录。

目标是在保留全部默认功能、历史工具渲染和首次就绪契约的前提下，减少源码入口的冷加载成本及无必要的启动依赖。优化必须改善实际就绪时间，不能只把 factory 的等待挪到 session_start，或把全部等待转移到第一次工具调用。

### 明确不做

- 不将 `pi.extensions` 从 `src/index.ts` 改为 `dist/index.js`，不增加预编译、bundle、构建产物提交或安装时构建。
- 不新增 `prepare`、`postinstall` 等构建脚本，不引入构建工具，不改变 Git/本地包安装方式、peer 版本和 `private: true`。
- 不修改 Pi 宿主、Jiti 私有加载器、全局启动包装器或模块身份适配；不以升级宿主代替本项优化。
- 不通过关闭 ask/tasks/jobs/goal/agents、mentions、调度、workflow 或历史渲染获取性能改善。
- 不自动停用、修改或更新用户安装的第三方扩展，不清理用户缓存，不增加后台预热、永久资源缓存、遥测或常驻 watcher。
- 不执行消费者安装验收或 npm 发布；既有 [安装验收待办](official-pi-installation.md) 的延期与授权边界保持不变。

## 检查依据与适用范围

### 实施前基线中的加载问题

| 位置 | 实施前事实 | 处理方向 |
| --- | --- | --- |
| `src/index.ts`、`src/runtime/renderers.ts` | factory 提前注册所有历史 renderer；业务模块虽在 session_start 激活，但 renderer 的静态依赖已经进入入口加载图 | 保留提前注册，切断显示代码对执行 owner 和资源加载器的运行时依赖 |
| `src/agents/render.ts`、`src/runtime/wait-render.ts` → `src/agents/runtime.ts` | 仅为 `agentDisplayName` 查询就静态引入 AgentManager、jobs runtime；AgentManager 继续连接 history、catalog 等模块 | 将只读查询与创建 owner 的实现解耦，仍读取同一份进程级 owner 状态 |
| `src/agents/history.ts` → `src/agents/resources/loader.ts` | history 仅使用 `resourcePath` 路径展开函数，却带入完整 child resource loader | 路径函数回归资源层内的轻量模块，避免查询路径连接 child 执行资源栈 |
| `src/runtime/tools.ts` | renderer 注册表与工具 schema、参数校验、分页、读取契约同处一文件 | 按入口追踪和阶段计时判断是否需要分离；若实施，保持唯一注册表及统一注册能力 |
| `src/runtime/suite.ts` → `src/tasks/viewer.ts` | tasks 准入时为注册 `/tasks` 和 Dock 回调直接导入 viewer，连带 BrowserView/DetailsView 等组件 | 将轻量命令注册与真正查看界面分离，首次命令或 Dock 打开时才加载 viewer |
| `src/goal/commands.ts` → `src/ui/details.ts` | `/goal` 注册阶段静态导入详情阅读组件，实际仅详情操作使用 | 在详情调用路径加载阅读组件，目标控制命令仍启动即用 |

此前的入口加载追踪中，factory 场景读取约 77 个 Suite 源文件，完成 session_start 后约 142 个。该计数表示源文件读取集合，不等同于执行次数或精确耗时贡献，也不作为永久测试断言；本次以实际官方 Node bin/RPC 重新建立基线，并以加载追踪辅助定位。

此前完整配置的诊断中，Suite 冷加载约 2.1 秒，Plannotator 约 2.5 秒，Slopchop 约 1.8 秒，Model Manager 约 1.5 秒，Web Access 约 1.1 秒。这些近似单次数据仅用于选择检查方向，不是优化后的结果、稳定预算或 TUI 首屏时间；缓存差异不能全部归因于 TypeScript 转换。

仓库 peer/开发依赖和现有正式支持声明为 Pi 1.5.0，实际用户宿主为 1.5.2。后续分别记录这两种环境的结果，不把用户环境诊断自动扩大为 1.5.2 全面兼容声明。实际用户加载的是 Git 安装副本；仓库显式入口的验证不代表该安装副本已更新。

## 实施顺序

### 第一阶段：复用唯一 owner 状态，解耦显示与执行

#### Agent 名称与 owner 查询

- 在现有 agents 模块内提取轻量的进程级 registry/只读查询边界，可采用 `src/agents/registry.ts`；不为一个函数机械拆分整个目录。
- 共享现有 `Symbol.for('pi-suite.agents.runtime.v1')` 和按 agentDir 分组的 owner map。运行时创建与显示查询必须经同一个模块访问同一状态，不复制一份名称 map，不新增创建、恢复、改名、清理时的同步维护链。
- 轻量模块对 AgentManager 只使用类型依赖，不导入其构造器、JobManager、catalog、history、资源发现或执行模块。
- `agentDisplayName` 保留按 id、可选 runId 以及排除 workflow child 的现有筛选语义；查询时从既有 owner 取记录，未找到时显示原 ID。
- renderer 查询不能创建 registry owner、jobs runtime、目录、计时器或监听器；不扫描持久历史文件。是否存在 owner 与是否启用当前会话 agents 模块仍是两个事实。
- `src/agents/runtime.ts` 继续负责创建/复用 owner、并发执行加载及 quit；reload/new/resume/fork/tree 不能替换正在运行的 owner。
- 使用语言服务查找全部引用，迁移 agents renderer、wait renderer、相关测试及其他调用；不保留旧位置的兼容 re-export。

#### 资源路径与工具注册

- 将 `resourcePath` 从完整 child resource loader 移到资源层内的轻量路径模块；history 与 child loader 共用同一实现，保留 `~`、绝对/相对路径和 cwd 语义。
- 追踪 `runtime/tools.ts` 对入口的实际成本。若分离显示注册，则 `registerToolRenderers`、`toolRenderer` 和 `registerBoundTool` 必须继续共用唯一的按 ExtensionAPI 隔离的 WeakMap，不能形成主会话/child 两套显示注册表。
- schema、参数校验、分页和读取协议保持现有统一框架；仅为缩短 renderer 依赖而拆出最小边界，不另建工具注册 API。
- 检查所有 renderer 的值导入，真正只用于类型的改为 `import type`；已经是类型导入的项目不重复改动，不将纯函数导入当作一律需要异步化。
- `runtime/renderers.ts` 的工具映射本身保持清晰；没有职责或依赖收益时，不按文件数量拆成多层注册包装。

### 第二阶段：补齐查看器按需加载边界

#### Tasks

- 参考 `src/jobs/commands.ts` 的轻量注册方式，在 tasks 内增加/复用命令注册入口，将 `/tasks` 注册从 `tasks/viewer.ts` 移出。
- `runtime/suite.ts` 在 tasks 准入时只加载模块、工具和轻量命令注册；不再为注册命令加载完整 viewer。
- `/tasks` 的异步 handler 在首次调用时导入实际实现；Dock 的 task 详情回调在打开时导入 `showTask`，保留原 reference/generation 校验、只读详情和通知协调。
- 新的异步边界必须复查会话/绑定是否仍有效，复用 SessionBinding 与现有撤销规则；加载期间发生 reload、会话切换或取消时，不把旧页面挂到新会话。
- 保留无 TUI 模式下的文本输出、参数错误、筛选、任务组选中状态、详情返回和共享目录更新能力。

#### Goal 与已有延迟栈

- 在 `/goal` 实际详情路径动态加载 `showDetails`；目标开始、编辑、暂停、恢复、停止、清除等控制操作仍在命令注册后立即可用。
- 继续保持原通知 hold/finally 释放、错误传播和绑定撤销语义，不通过忽略加载异常保证表面可用。
- 检查 Tasks/Goal 的传递导入是否确实减少；BrowserView/DetailsView 若还被其他必要启动模块使用，应报告实际收益，不能仅因改成 import() 就宣称全局未加载。
- 保留已存在的 Ask 界面、Jobs 查看器、Suite 设置、PTY 后端、child runner 和 workflow Worker 延迟边界，不重复重构已满足要求的路径。
- 正文/历史工具 renderer 仍提前注册，不能等待首次工具、首次展开或 session_start 才补齐；保留 Bash/PowerShell 原生 renderer 装饰与其他扩展的 next() 组合。

### 第三阶段：按实测处理剩余启动工作

- 在前两阶段后重新测量 factory、首次 session_start、首次就绪和首次使用；只对仍有明确贡献的额外导入、重复读取或扫描实施优化。
- 沿用首次准入与绑定共享配置、workflow 与 mentions 共享类型快照、按 ctx.cwd 与信任准入的现有实现；不引入跨 cwd/信任永久缓存。
- 不把 tasks 绑定、活动执行恢复、调度、动态 schema、RPC、首次 @类型补全移到未等待的后台任务；session_start 返回前仍满足全部启动契约。
- 不将共享图的顺序 import 改为 Promise.all；首次并发使用继续共享已有加载 Promise，防止 Jiti 暴露未完成导出。
- 不修改 CLI preset 的源码入口定位和字面量 prompt 协议；`jobs/launch/presets.ts` 的前导 @、fork、print/JSON 行为列入受影响路径核查。

## 第三方扩展的独立优化方向

完整配置冷启动不能只靠 Suite 消除。以下作为独立后续方向，不在本仓库实施时直接修改用户安装目录，也不将停用功能作为 Suite 优化结果：

- Plannotator：检查浏览器会话、diff、HTML 转换和 Web UI 服务依赖是否可在首次审阅命令调用时加载。
- Slopchop：检查 review UI 依赖是否可移到审阅命令或快捷键首次执行时加载，保留原有入口与行为。
- Model Manager：检查 dashboard 的顶层导入是否可延迟；catalog/必要 Provider 注册与 transport 初始化分别测量，不能为优化使模型首次不可用。
- Web Access：先测入口依赖贡献，并区分同步初始化、被等待的网络请求与后台通知；不能仅看到网络代码就认定为启动阻塞。

实施第三方优化需要对应源码、独立授权和单独验收，可向上游提交变更；不在 Suite 内增加插件包装器或另一套加载框架。

## 性能测量与验收

### 测量方法

1. 使用官方实际 Node bin 和 RPC 入口；SDK 直接导入 factory 只作阶段辅助，不能替代 CLI 就绪证据。固定 Node/Pi、cwd、配置、模型、资源和扩展集合。
2. 分别使用隔离的测试用户目录/资源和明确受控的缓存环境；不删除用户缓存。冷/暖缓存必须说明影响 Jiti、Node 编译缓存还是两者，冷启动取样不清理整个系统缓存。
3. 不发送收费模型请求；功能链使用现有 faux provider 或本地受控 SSE。Pi 离线开关不保证第三方自行发起的网络请求也被禁止，完整配置测量须单独辨别。
4. 比较无扩展、仅 Suite 默认模块、仅 Suite 全业务模块关闭、含实际类型/历史资源、完整扩展集合。模块关闭场景只验证准入，不替代默认功能性能结果。
5. 对可比场景在同一设备交替采样优化前/后各至少五个独立进程，报告中位数、范围和离群值。单个取样或模块读取数变化不能作为性能完成依据。
6. 阶段覆盖宿主资源解析、module import/factory、session_start、RPC 首次响应、TUI 首次可操作、首次命令/工具以及 reload；诊断只采用临时或可关闭机制，不在正常启动新增日志。

### 行为与性能完成条件

- 默认功能的冷启动到真实就绪时间中位数降低；暖启动、reload 和首次使用没有超出取样波动的明显回退。阶段成本转移必须与端到端时间同时报告，不预先承诺毫秒数或百分比。
- 工厂阶段显示依赖不再为名称查询加载 AgentManager、JobManager 或完整 child resource loader；通过真实加载追踪辅助定位，不新增绑定源码文本/文件数量的永久测试。
- 无当前 agents owner、旧会话历史、模块禁用、主会话与 child 场景都能正常渲染；已有 owner 的名称查询保持 id/runId 隔离，显示查询不会创建磁盘状态。
- regular/fullscreen 实际 TUI 覆盖历史工具摘要/展开、命令高亮、Tasks/Goal/Jobs/Subagents 首次打开及返回；RPC 覆盖就绪后工具/命令可用。首屏时间与 RPC 时间分开描述。
- 首次 Ask、pipe/PTY、child、workflow 能真实执行；共享加载期间取消、reload 或切换会话不使用失效上下文、不出现部分导出错误。
- new/resume/fork/tree/reload 保留任务 generation、active-tool 选择、mentions、调度、通知交付、进程级执行 owner 和 quit 清理语义；不得新增重复计时器或订阅。
- 保留 CLI preset 的前导 @ 字面量、复杂 prompt、fork 及 print/JSON 链路；不破坏宿主模块身份或父模型 runtime 桥接。
- 配置、资源、导入失败经既有边界可见，不静默回退；未测平台和宿主版本明确列为未覆盖。

### 复用验证与文档维护

优先复用 `tests/runtime/tool-history.test.ts`、`tool-render.test.ts`、`modules.test.ts`、`cli-host.test.ts`，以及 agents 资源/lifecycle、jobs launch/PTY、Ask 和 workflow 的相关现有检查。仅为明确跨模块行为风险调整或增加必要测试，不为每个 import、文件移动或注册转发新增测试；临时性能诊断不进入日常测试集合。

代码实施收尾统一运行 `pnpm typecheck`、`pnpm test`，另运行受影响的真实 CLI/PTY/RPC 场景。日常检查控制在 5 分钟内、全量检查控制在 10 分钟内；不在每个小改动后重复全量运行。聚焦检查与性能样本不替代收尾全量检查，也不替代消费者安装。

局部同步 [公共运行时](../current/runtime/index.md)、[统一 UI](../current/ui/index.md)、[任务操作](../current/tasks/operations.md)、[子代理运行时](../current/agents/runtime.md) 和 [验证规则](../current/validation.md) 中受影响的稳定事实，尤其校正查看器何时实际加载；未完成的验收仍保留于本项。只有全部完成条件满足后才移至 finished 并更新索引。性能结论保留环境与适用范围，不保留临时日志、脚本或本机产物路径。

## 已实施边界与验收结论

### 实现范围

- agents/registry.ts 复用原进程 symbol 和 owner map，名称查询仅有 AgentManager 类型依赖；agents 与 wait renderer、现有名称检查已迁移，不保留 runtime.ts 的名称查询 re-export。
- history 与 runner 共用 resources/paths.ts 的原路径展开语义；child loader 不再输出路径函数。runtime/tools.ts 的传递依赖为共享 schema、读取契约及错误模块，没有执行 owner/查看器链；本次不机械拆分它，提前渲染、lookup 与执行登记仍使用原唯一 WeakMap。
- Tasks 命令在 commands.ts 注册，非 TUI 文本查询不加载 viewer；TUI 命令及 Dock 打开时才导入 viewer，导入、详情读取和返回选择均核对捕获的 SessionBinding。失效绑定不挂旧页面或改新 Dock，通知令牌始终 finally 释放。
- Goal 的 showDetails 已进入实际详情路径，导入后核对目标模块捕获的绑定及取消信号。Ask、Jobs、Suite 设置、PTY、child 和 Worker 的既有按需入口保留，历史与原生命令 renderer 仍在 factory 提前注册。

### 实际 CLI/RPC 对比

环境为 Linux、Node 24.22.2、官方未修改 Pi 1.5.0 与 1.5.2 的 `dist/bundle/cli.js --mode rpc`。改动前保留独立源码副本；“仅启动改动”副本只应用本项 registry、资源路径和 Tasks 边界，不混入同期 Goal 重构；“联合快照”包含当时的 Goal 详情延迟与 Responses 恢复，不是后续所有联合修改的最终验收。

每组前后各 5 个独立进程，交替顺序采样。cwd、临时用户配置和资源场景保持等价；默认全部 Suite 模块启用，使用明确源码入口，不加载第三方扩展。冷样本关闭 Jiti 文件转换缓存与 Node 编译缓存；暖样本启用各版本/副本独立临时目录中的 Jiti 文件缓存，预热样本不计入五次比较，Node 编译缓存仍关闭。不清理用户缓存，不发送模型请求。真实就绪定义为进程启动至首个 `get_state` 响应；随后检查命令登记、首次 `/tasks` 文本、空 Goal status 和扩展命令触发的原生 reload。

以下为真实就绪中位数，括号为最小–最大值，单位 ms：

| 宿主/场景 | 实施前 | 仅启动改动 | 联合快照 |
| --- | --- | --- | --- |
| Pi 1.5.2 默认冷 | 3136（3097–3263） | 3018（2990–3072） | 3044（2937–3158） |
| Pi 1.5.2 默认暖 | 652（637–705） | 663（649–693） | 647（626–682） |
| Pi 1.5.0 默认冷 | 6239（3043–6386） | 5987（2967–6023） | 5990（2895–6091） |
| Pi 1.5.0 默认暖 | 1157（1109–1181） | 1168（1150–1188） | 1150（1136–1153） |
| Pi 1.5.2 无 Suite 对照 | 1162（647–1176） | 1176（659–1248） | 未测 |
| Pi 1.5.2 全业务关闭冷 | 2232（2221–2296） | 1540（1498–1558） | 未测 |
| Pi 1.5.2 类型/持久记录冷 | 3186（3043–3468） | 3120（3052–3400） | 未测 |

Pi 1.5.2 默认冷就绪中位数减少约 118ms（3.8%），联合快照减少约 92ms（2.9%）；默认暖差异落在样本波动内。默认冷 reload 中位数 2021 → 1866ms，暖 reload 87 → 86ms；RPC 首次 Tasks 文本 1.45 → 1.50ms。类型/记录场景的冷 reload 2083 → 1949ms。全关闭场景只证明准入优化，不能替代默认性能：其冷 reload 1365 → 1450ms，存在剩余成本，尚未完成“不明显回退”的综合验收。

Pi 1.5.0 冷样本与无 Suite 对照均出现约两倍的整段时延变化，不能把这部分归因于 Suite 或 TypeScript 转换，也不能用跨宿主数字推断版本性能。上述范围完整保留，当前只支持有限的同组交替比较；未建立生产缓存、完整配置或 TUI 首屏预算。

临时真实 CLI 加载追踪的一次阶段诊断：实施前 import/factory 约 1359ms、session_start 主处理约 972ms；仅启动改动约 599/1771ms，联合快照约 564/1680ms。说明名称查询提前加载的 owner 工作回归必要会话准入，factory 收益大部分为阶段转移，端到端只小幅改善。源码读取集合分别为 factory 77 → 31（联合 33）、session_start 后 142 → 138（联合 135），只用于定位：factory 不再加载 AgentManager、JobManager、child loader；仅启动副本的 Goal 静态依赖仍加载 DetailsView，联合快照的首次就绪没有加载 Tasks viewer、BrowserView 或 DetailsView。

### 实际 TUI 首次使用对比

Linux Node 24.22.2、官方 Pi 1.5.0 实际 Node bin、fullscreen 80×30、默认全部模块及同一离线 fixture，前后各五进程交替采样。冷组禁用 Jiti/Node 编译缓存；暖组只启用隔离的 Jiti 文件缓存，预热不计样本。首个 `/tasks` 命令发出后真实页面出现并可返回才算可操作，不用 session_start 标记冒充首屏时间。

| 指标（ms，中位数及范围） | 实施前 | 联合实现 |
| --- | --- | --- |
| 冷 session_start 标记 | 3195（3115–3415） | 3065（3037–3507） |
| 冷首次 Tasks 页面（自进程启动） | 3285（3211–3509） | 3296（3265–3783） |
| 冷首次 Tasks 命令等待 | 90（89–95） | 237（228–276） |
| 暖 session_start 标记 | 735（710–743） | 727（704–743） |
| 暖首次 Tasks 页面（自进程启动） | 833（804–842） | 823（798–842） |
| 暖首次 Tasks 命令等待 | 95（91–106） | 95（90–100） |

空 Goal status 的首次反馈中位数均约 21ms。Tasks 列表不再为显示首屏预载详情阅读器，详情实际打开才加载；导入前后均核对绑定。该局部边界没有消除冷首次列表的转换等待：冷首屏整体没有可靠改善，启动标记约 130ms 的收益主要转移到首次 Tasks（约 +147ms）。暖组无明显回退。故本项尚未达到“默认端到端改善、首次使用无明显回退”的全部完成条件，不以 factory 文件减少或 RPC 数字代替这一结论。

### 检查与未覆盖范围

受影响的 Tasks UI/撤销、工具显示/历史、模块准入、agents 资源/历史/运行检查，以及官方 CLI/PTY/RPC 合并检查的最终结果见 [验证规则](../current/validation.md)。实际 CLI 已覆盖 regular/fullscreen 的历史工具、Tasks/Goal/Jobs/Subagents 首次打开/返回、PTY 输入/resize、child、clone/冷恢复/quit；实际 Goal 恢复与混合通知历史在 40/80/120 列另通过离线 smoke，不涉及收费服务。

尚未建立完整第三方扩展集合、首次 Ask/workflow 的前后性能比较、生产类型/历史规模与 Windows 新行为验收；既有契约通过不等于这些性能场景已测。安装副本、用户配置、宿主、第三方安装目录和发布方式均未修改，Pi 1.5.2 仅为诊断，不扩大正式支持范围。

## 任务列表

- [ ] 建立源码入口冷/暖启动、factory/session_start、首次使用和 reload 的完整可比基线，区分 Pi 1.5.0 正式范围与实际 1.5.2 诊断。
  - [x] 官方 Node bin/RPC、阶段辅助追踪及冷/暖/reload/首次文本查询的独立进程基线与对比。
  - [x] 真实 TUI 首次 Tasks 可操作、冷暖前后各五进程与返回。
  - [ ] 完整扩展集合及其他交互首次使用基线。
- [x] 提取共享轻量 agents registry/只读名称查询，迁移全部调用，保留唯一 owner、按 agentDir 隔离和无副作用显示语义。
- [x] 解耦资源路径函数与 child resource loader，并按实测决定 runtime/tools 的最小显示注册边界；保留唯一工具/renderer 注册表。
- [x] 分离 Tasks 轻量命令注册与查看器，实现 `/tasks`、Dock 详情首次加载和加载期间绑定撤销处理。
- [x] 将 Goal 详情阅读组件移入实际使用路径，核查其余按需栈与传递导入，保持提前历史渲染和启动就绪合同。
- [ ] 复测剩余启动成本，只处理有证据的额外依赖或重复工作；不并发共享图、不后台跳过必要绑定、不新增永久缓存。
- [ ] 完成现有契约检查及真实 CLI 的历史、首次命令/工具、PTY、child/workflow、reload/切换/退出验收，报告未覆盖范围。
- [ ] 提供优化前后多进程采样结论与首次交互使用代价，确认默认功能端到端改善而非阶段转移。
  - [x] 前后各五进程 RPC 对比、范围、波动与阶段转移分析。
- [ ] 局部更新 current 文档并在完成全部验收后归档本项；保持源码 Git 安装方式及独立安装验收延期边界，不修改第三方安装目录。
  - [x] 同步当前 registry、资源路径和查看器加载边界。

[返回待办索引](index.md)
