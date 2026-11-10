# 已实施清理与官方入口验收

## 权限和当前状态

用户已明确授权按照净化暂缓、U1/T1/M1 和原版 phase 行为实施，并确认以下源码、测试、依赖及入口清理范围。源会话 JSONL、用户任务/执行记录、shell 和全局 Pi 安装不修改；任何新增疑问或未列明破坏性操作提前询问。

净化专用 current/finished 页面和入口说明，以及命令实现、注册、专用测试与暂停副本 helper 均已移除。U1/T1/M1 和三组宿主补丁清理已实施，普通会话、模型切换、Goal 与执行 owner 保持既有契约，Responses 使用官方原版行为。官方未修改 Pi 1.5.0 的原有三项 bin/RPC 验收及新增真实 CLI Dock/搜索/合法 active child 中文 Editor 补验通过；消费者安装按用户明确指示延期，统一维护在 [安装待办](../../../todo/official-pi-installation.md)，不宣称安装验收或 npm 发布完成。

## 净化与 phase 的已清理范围

已按获准范围核查并移除：

- `src/runtime/responses/` 专用命令与净化实现，以及扩展入口注册。
- 净化专用测试和 CLI/RPC 夹具中的专用流程；保留实际宿主加载、页面、Tasks、Jobs 和退出清理的公共验证能力。
- 仅用于净化副本的 Goal 暂停复制 helper（pausedGoalCopy）；普通 Goal 恢复、显式暂停、waiting、预算与 owner 控制不改变。
- prepared-fork、supportsPreparedFork、转换入口、专用 projectContextEntry 导出及 api aliases 的调用和补丁。
- pi-ai signature/tool-call helper 导出和专用等价重构，不把它们搬到插件作为无使用方的保留层。
- 跨来源 phase 保留的额外 adapter 行为，遵循原版转换。

原版同实际 api/provider/model 的历史转换可保留 phase，任意一项不同则可能丢失；本专项不额外保证跨来源 wire phase，不另立功能，不维护一次或长期请求恢复 hook。新响应正常保存/重放仍使用官方行为。

不保留占位命令，不新增自动重试 400、永久净化、禁用缓存或伪造历史来源。移除净化不等于全部 Responses 400 被修复，也不意味着错误应被忽略。

## 已实施的宿主依赖清理次序

1. 先按 U1 替换共享 UI 的新增布局 API、overlay 高度/生命周期及鼠标/scrollbar 依赖，保留正文、阅读状态和 PTY。
2. 按 T1 替换 Tasks 来源定位，再移除新增 parentSessionId 依赖；不实现内存快照交接系统。
3. 移除净化专用调用、Goal helper、API aliases 及额外 phase 行为。
4. 核查全部使用方后移除三组宿主 patch、workspace patchedDependencies、对应 lockfile 条目与 patch-only `.gitattributes`，恢复官方 bin/RPC 入口及模块解析。
5. 移除只为 patched 布局设置的全包加载门禁，保留真正必要的版本/私有桥接错误边界；不能只删检查留下运行时崩溃。
6. 按 M1 保留明确的私有 runtime 桥接，统一到 `src/agents/models.ts` parentModelRuntime，manager 准入/runner/mentions.clone 复用；不增加 Execution 字段或序列化 runtime，不为了得到“零私有 API”宣称而擅自换成另一份 runtime。

这些步骤是调用链拆分，不是直接 revert 既有提交。禁止整体撤掉可保留的原生工具壳、任务反馈、阅读状态、全屏、展示精简或执行能力。

## 普通插件发布契约

- 用户安装插件后直接使用其官方 Pi，不要求补丁宿主、私有 bin、shell function/alias 或重定向启动入口。
- 插件包的 peerDependencies、devDependencies、lockfile、patchedDependencies 不能被用来声称会改造消费者既有宿主。
- 版本和包路径相同不证明能力、模块身份或认证状态相同；支持范围由实际验收界定。
- 开发构造 SDK、仓库 patched CLI 或预构建 bundle 的拒绝负对照不能代替正向官方加载验收。
- M1 的私有例外必须可见；普通插件定位不代表所有生产调用都已是公开 API。
- 当前包保持 `private:true`，三个 Pi peer/dev 均精确固定为 `1.5.0`；官方包的 bin/`./rpc-entry` 分别使用 `dist/bundle/cli.js`、`dist/bundle/rpc-entry.js`，原版 loader 的虚拟模块提供宿主类身份，不修改消费者宿主。本包未实际 npm 发布，Git/本地包及 tarball 安装验收延期。

## 验收矩阵与维护规则

优先复用已有测试，调整 patched 专属断言，不为每个细节增加固化测试。新增测试必须对应跨模块风险；条目不超过功能条目的三倍，日常不超过 5 分钟、全量不超过 10 分钟。

| 验收域 | 必要证据与当前范围 |
| --- | --- |
| 消费者安装 | 干净环境安装插件，启动未修改的官方 Pi；不借用仓库 patched 模块、改过的 bin 或 api aliases。按用户指示延期，见 [安装待办](../../../todo/official-pi-installation.md)，未标记通过 |
| 官方加载 | 使用未修改的官方 Pi 1.5.0 bin/RPC 与真实扩展加载器；原有三项入口验收通过，不以显式仓库入口的加载结果替代消费者包安装 |
| CLI/RPC | 实际官方 package bin、RPC export 和真实扩展加载器；不仅直接 SDK 构造。原有 Tasks/Jobs/clone/resize/类身份与正常请求退出通过，新增真实 bundled CLI 补验亦通过 |
| U1 页面 | Tasks/Subagents/Jobs/Ask History/workflow 的共享预算、键盘操作、原生输入、返回/resize/退出；共享定向 18/18 及 regular/fullscreen 的真实 Dock/正文搜索/o/合法 child 中文 Editor 补验通过，不以鼠标/scrollbar 补丁测试代替 |
| 会话与 Tasks | new/resume/reload/普通持久 fork；完整计数器、目标独立、LF/UTF-8 首头只读、内存独立 warning、无恢复反馈；stock 定向 16/16 通过 |
| Goal/owner | 原有目标恢复、绑定代次、等待/通知和执行原归属；不因删命令修改普通 Goal 行为 |
| PTY | 实际二维屏幕与输出区尺寸，接管/交还/离开/重新接管及真实退出；不伪造屏幕或按历史 PID 接管，按既有验证范围声明 |
| M1 | 父 runtime 私有桥接在官方入口中可用，统一结构协议守卫，失效不静默切 runtime；Provider/认证/路由继承仅按实际受控验证范围声明，不保证全部外部认证组合 |
| Responses | 不残留 Suite phase 转换/恢复层；官方 RPC 的正常请求、新 Responses 保存/resume 与跨模型原版 phase 行为通过，不因清理改写源会话 |

验收记录只保存结论、适用范围及未通过项。Linux PTY/xterm、离线 Provider 或本地 adapter 不证明实体人工终端、Windows 人工、外网凭据/组织权限、真实解密或中转粘性。没有证据不能勾选通过，也不能凭既有 patched 220/220 宣告普通插件兼容。

## 任务列表

- [x] 从产品文档移除净化专用页面及入口说明，保持源码状态说明真实。
- [x] 记录 U1/T1/M1/原版 phase 的清理顺序和发布证据要求。
- [x] 逐项实施获授权的清理，不修改源会话 JSONL，不迁移执行 owner。
- [x] 核查生产源码、测试夹具和依赖配置无净化入口或新增宿主 API/aliases 残留。
- [x] 官方未修改 Pi 1.5.0 的原有 bin/RPC 三项加载/运行验收及新增真实 CLI 补验通过，按精确版本/入口声明 M1 支持范围。
- [ ] 干净消费者 Git/本地包及 tarball 安装验收按用户指示延期，统一维护 [安装待办](../../../todo/official-pi-installation.md)，不勾选为通过。
- [x] 局部更新 current 和模块操作说明；finished 保留既有 patched 验收的限定范围，不倒写成原版通过。
- [x] 本专项实施记录归档至 finished，局部修正迁移相对链接与索引。
- [x] 完成最终复验及文档审核，按项目规则提交获授权的实现与文档。

[返回专项索引](index.md) · [当前运行时](../../../current/runtime/index.md) · [迁移前 patched 入口记录](../ui/cli-host-entry.md)
