# 拟清理范围与官方发布验收

## 权限和当前状态

用户确认净化暂缓、U1/T1/M1 和遵循原版 phase 行为。当前授权仅限文档；以下源码、测试、依赖和发布清理全部尚未执行。

净化命令的专用 current/finished 文档及其他页面的专用入口说明按用户要求移除，不继续作为已验收产品能力宣传。源码仍注册该命令；删除文档不代表命令、测试或补丁已经删除。普通会话、模型切换和历史行为不能按计划文字假定已改变。

## 净化与 phase 的拟清理范围

获明确实施授权后，核查并移除：

- `src/runtime/responses/` 专用命令与净化实现，以及扩展入口注册。
- 净化专用测试和 CLI/RPC 夹具中的专用流程；保留实际宿主加载、页面、Tasks、Jobs 和退出清理的公共验证能力。
- 仅用于净化副本的 Goal 暂停复制 helper；普通 Goal 恢复、显式暂停、waiting、预算与 owner 控制不改变。
- prepared-fork、supportsPreparedFork、转换入口、专用 projectContextEntry 导出及 api aliases 的调用和补丁。
- pi-ai signature/tool-call helper 导出和专用等价重构，不把它们搬到插件作为无使用方的保留层。
- 跨来源 phase 保留的额外 adapter 行为，遵循原版转换。

原版同实际 api/provider/model 的历史转换可保留 phase，任意一项不同则可能丢失；本专项不额外保证跨来源 wire phase，不另立功能，不维护一次或长期请求恢复 hook。新响应正常保存/重放仍使用官方行为。

不保留占位命令，不新增自动重试 400、永久净化、禁用缓存或伪造历史来源。移除净化不等于全部 Responses 400 被修复，也不意味着错误应被忽略。

## 宿主依赖清理次序

1. 先按 U1 替换共享 UI 的新增布局 API、overlay 高度/生命周期及鼠标/scrollbar 依赖，保留正文、阅读状态和 PTY。
2. 按 T1 替换 Tasks 来源定位，再移除新增 parentSessionId 依赖；不实现内存快照交接系统。
3. 移除净化专用调用、Goal helper、API aliases 及额外 phase 行为。
4. 核查全部使用方后移除三组宿主 patch、patchedDependencies 和对应 lockfile 条目，恢复官方 bin/RPC 入口及模块解析。
5. 移除只为 patched 布局设置的全包加载门禁，保留真正必要的版本/私有桥接错误边界；不能只删检查留下运行时崩溃。
6. 按 M1 保留明确的私有 runtime 桥接，不为了得到“零私有 API”宣称而擅自换成另一份 runtime。

这些步骤是调用链拆分，不是直接 revert 既有提交。禁止整体撤掉可保留的原生工具壳、任务反馈、阅读状态、全屏、展示精简或执行能力。

## 普通插件发布契约

- 用户安装插件后直接使用其官方 Pi，不要求补丁宿主、私有 bin、shell function/alias 或重定向启动入口。
- 插件包的 peerDependencies、devDependencies、lockfile、patchedDependencies 不能被用来声称会改造消费者既有宿主。
- 版本和包路径相同不证明能力、模块身份或认证状态相同；支持范围由实际验收界定。
- 开发构造 SDK、仓库 patched CLI 或预构建 bundle 的拒绝负对照不能代替正向官方加载验收。
- M1 的私有例外必须可见；普通插件定位不代表所有生产调用都已是公开 API。
- 当前 package private 状态及发布元数据仍须另行核查，本专项文档不自动宣布包已发布。

## 验收矩阵与维护规则

优先复用已有测试，调整 patched 专属断言，不为每个细节增加固化测试。新增测试必须对应跨模块风险；条目不超过功能条目的三倍，日常不超过 5 分钟、全量不超过 10 分钟。

| 验收域 | 必要证据 |
| --- | --- |
| 安装/加载 | 干净环境安装插件，启动未修改的官方 Pi；不借用仓库 patched 模块、改过的 bin 或 api aliases |
| CLI/RPC | 实际官方 package bin、RPC export 和真实扩展加载器；不仅直接 SDK 构造 |
| U1 页面 | Tasks/Subagents/Jobs/Ask History/workflow 的共享预算、键盘操作、原生输入、返回/resize/退出；不以鼠标/scrollbar 补丁测试代替 |
| 会话与 Tasks | new/resume/reload/普通持久 fork；完整计数器、目标独立、内存限制可见、无恢复反馈 |
| Goal/owner | 原有目标恢复、绑定代次、等待/通知和执行原归属；不因删命令修改普通 Goal 行为 |
| PTY | 实际二维屏幕与输出区尺寸，接管/交还/离开/重新接管及真实退出；不伪造屏幕或按历史 PID 接管 |
| M1 | 父 runtime 私有桥接在官方入口中可用、已验证的 Provider/认证/路由继承、失效不静默切 runtime |
| Responses | 不残留 Suite phase 转换/恢复层；正常官方请求、保存和重放不因清理损坏 |

验收记录只保存结论、适用范围及未通过项。Linux PTY/xterm、离线 Provider 或本地 adapter 不证明实体人工终端、Windows 人工、外网凭据/组织权限、真实解密或中转粘性。没有证据不能勾选通过，也不能凭既有 patched 220/220 宣告普通插件兼容。

## 任务列表

- [x] 从产品文档移除净化专用页面及入口说明，保持源码状态说明真实。
- [x] 记录 U1/T1/M1/原版 phase 的清理顺序和发布证据要求。
- [ ] 获得实施授权后逐项清理，不修改源会话 JSONL，不迁移执行 owner。
- [ ] 实施完成后核查生产源码、测试夹具和依赖配置无净化入口或新增宿主 API 残留。
- [ ] 在干净官方 Pi 安装链路完成正向验收，按实际版本/入口声明 M1 支持范围。
- [ ] 局部更新 current 和模块操作说明；finished 保留既有 patched 验收的限定范围，不倒写成原版通过。
- [ ] 完成验证后按项目规则提交获授权的实现与文档，并归档本专项。

[返回专项索引](index.md) · [当前运行时](../../current/runtime/index.md) · [既有 patched 入口记录](../../finished/pi-suite/ui/cli-host-entry.md)
