# 宿主依赖审计与职责分类

## 基线与现状

审计以未打补丁 Pi 1.5.0 的公开文档、声明及实现为基线，并与仓库补丁及生产调用交叉核对。不能把本仓库 patched node_modules、SDK 构造测试或修改后的 CLI 当成普通插件的兼容证据。

当前仓库维护 `pi-tui`、`pi-coding-agent`、`pi-ai` 三份补丁；扩展加载时检查新增布局 API，开发依赖的 bin/RPC 也被调整为 unbundled 入口。消费者安装插件不会把插件仓库的 `patchedDependencies` 自动应用到既有宿主。版本同为 1.5.0，不等于模块能力相同。

本页仅记录依赖分类；代码和补丁尚未撤除。

## 业务能力与实现依赖

| 能力 | 原版能力与当前耦合 | 已确认处置 |
| --- | --- | --- |
| 原生工具外壳、摘要接替与完整错误 | 原版工具注册及 ToolExecutionComponent 可承担外壳；不必改宿主 | 保留正文与原生壳分工，不整体回滚 |
| 任务恢复基线、真实完成反馈、等宽选中 | 插件状态和样式管理；不必改宿主 | 保留恢复不反馈、真实完成 5 秒、前缀/列宽不变 |
| 首开末尾、搜索、暂停/跟随、展开与返回 | 阅读状态及输出 revision/字节来源可由插件管理 | 按 U1 保留；展开/resize 不当成 provider 新输出 |
| 全屏遮盖 footer | 原版公开 overlay 有 top-left、width/maxHeight、margin；插件输出足够行数即可覆盖 | 使用显式高度预算和填充，不替换 footer，不复制私有主 layout root |
| VStack/HStack/Container/ScrollView | 原版已有；当前额外依赖根布局导出、测量与 overlay frame 集成 | 复用公开组件；共享框架负责预算，去除新增 API 调用 |
| 复杂 overlay 鼠标、嵌套工具命中和原生 scrollbar capture | 宿主内部存在部分基础，但当前生产链依赖补丁集成；公开 API 不能保证完整等价 | U1 不承诺这组交互，不另写鼠标/scrollbar 系统模拟宿主 |
| Jobs PTY | 原有 xterm、进程后端、二维屏幕及输入控制是插件能力 | 保留真实尺寸、接管/交还，不替换为线性 ScrollView |
| 普通持久化 fork 的 Tasks 来源 | 原版 previousSessionFile 可定位源文件 | 按 T1 使用该来源，复制完整快照 |
| 内存 fork 的 Tasks 来源 | 当前使用新增 header.parentSessionId；不是原版公开字段 | 不保证内存任务继承，不实现快照交接系统，不暗中落盘 |
| Subagent 与 @类型克隆的 runtime | 两处强转读取私有 ModelRegistry.runtime；不是宿主补丁 | 按 M1 保留并公开风险，独立于宿主补丁清理 |

## 三组补丁的处置边界

### pi-tui

当前包括根布局函数导出、布局测量/分配配套、overlay frame 与鼠标/滚动条路由、高度及释放行为等。原版已经公开部分组件和 `Component.handleMouse`，不能把所有这些补丁说成业务功能必需。

U1 通过插件共享预算与生命周期管理替换调用；不保留为了完整鼠标体验添加的宿主逻辑。是否已有公开 ScrollView 方法可直接复用，应按具体调用核实，不通过宽泛能力探测静默切换多套 UI。

### pi-coding-agent

- prepared fork、准备能力标记、复制前转换入口和相关导出属于净化专用依赖，拟移除。
- `parentSessionId` 同时被普通 Tasks 内存 fork 使用，需先落实 T1，再移除该依赖。
- `projectContextEntry` 根导出及 pi-ai `/api` Jiti aliases 与当前净化 helper 调用链相关，拟随专用调用移除。
- Node bin/RPC 改指 unbundled 是补丁传播的后果，不是独立业务需求；待所有宿主依赖替换后恢复官方入口。
- 原版 `fork.position: 'at'`、`withSession`、`newSession.setup` 已经公开，不能列为新增宿主能力。普通 fork 必须保留。

### pi-ai

- Responses signature/tool-call-ID codec 导出与 adapter 拆 ID 重构为净化提供辅助调用，不需要保留为独立产品能力。
- 跨来源 text phase 保留改变正常 adapter 行为，不只是 helper 导出；按用户决定恢复原版语义。
- 不增加持续请求恢复、历史来源伪装、永久过滤、缓存禁用或自动重试 400 的替代机制。

## 其他耦合

- `src/ui/dock.ts` 当前直接读取 focusedComponent；原版已有公开 `getFocusedComponent()`，替换即可，不必丢掉空 Editor 的 Left 入口。
- 当前 layout preparation、content-growth/clamp-follow 和 dispose 配套应分别替换为公开方法或插件自身的状态/资源边界，不把一整份补丁直接搬进插件。
- `src/ask/view.ts` 存在自绘 thumb/箭头展示。U1 不用这种展示冒充原生 scrollbar；正文及列表阅读提示应纳入统一键盘阅读框架。
- M1 不能被混进“全部只使用公开 API”的声明；它是用户明确接受的私有例外。

## 验证结论边界

已完成的是静态审计和方案裁决，不是原版插件实现验收。既有 patched 环境的 220 项检查只能证明对应模块组合；stock bundle 被拒绝的负对照也不能算官方兼容通过。

实体终端、Windows 人工交互、外部账号认证、路由状态等不能借用 Linux PTY/xterm 或离线 Provider 的结论。相关验收范围见 [清理与发布](cleanup-and-release.md)。

## 任务列表

- [x] 区分业务必需能力、当前实现耦合和部署后果。
- [x] 将 U1/T1/M1/原版 phase 的决定映射到依赖组。
- [ ] 实施获授权的替换并核查源码是否还有新增 API、alias 或私有宿主布局读取。
- [ ] 核查最终声明仅保留 M1 这一明确例外，不隐藏其他宿主依赖。

[返回专项索引](index.md)
