# Subagent 全屏、Dock 默认展开与文本精简

本专项三项界面需求已实现、已验证，保留原需求、实施前历史根因与设计细节。与[原生工具与阅读框架专项](../ui-native-integration/index.md)分开维护；本专项自身的真实宿主证据与未覆盖范围见下方验收结论。

| 编号 | 需求 | 详细契约 |
| --- | --- | --- |
| UX-1 | Subagent 查看时覆盖整个屏幕，不显示主会话 footer 状态栏 | [全屏与 footer](viewer.md) |
| UX-2 | 输入框上方 Tasks、Agents、Jobs 列表未处于选择状态时，优先展开 Tasks | [Dock 默认展开](dock.md) |
| UX-3 | 所有展示文本精简，去掉冗余内容；选择 Tasks 时不显示 readonly 提示 | [文本精简](text.md) |

## 实施任务

- [x] 通过公共宿主/阅读框架实现 Subagent 全终端覆盖，退出后恢复原 footer、焦点和主会话视口。
- [x] 将 Dock 无活动选择时的默认展开策略与领域行优先级分离，优先给可见 Tasks 分区正文预算。
- [x] 精简公共提示与摘要，移除 Tasks 选择标题中的 `read only` / `readonly`，保留必要操作、错误和权限边界。
- [x] 合并验证全屏/resize/返回、三分区预算与选择切换、精简提示及原文保持，不为每个词或尺寸新增测试。
- [x] 局部更新对应 `doc/current`，完整归档本专项并更新索引。

“长上下文自动压缩”本次为行为解释，不新增压缩策略需求；本专项不改变模型配置、执行归属、任务状态或自动压缩规则。

## 验收结论与边界

离线 frozen-lockfile 安装与最终 `pnpm typecheck` 通过；最新 `pnpm test` 全量 **220/220 通过，约 1 分钟**。本专项三项结论如下：

1. **UX-1 全终端覆盖与恢复**：真实 `TuiAltScreen`、`TuiMainScreen` 与 xterm ANSI 输出证据通过。原生 overlay 使用 **100% height**，短正文及 model picker 也覆盖完整终端；Details、Jobs、模型选择等子页加载间隙由 native 捕获背景继续覆盖 footer。40×24、80×30、120×40 和动态 resize 已覆盖。退出或构造失败时释放捕获/焦点并恢复原 footer 实例、最新主会话状态与原焦点，不替换或销毁原生/第三方 footer。
2. **UX-2 Dock 分配**：未活动选择且存在可见 Tasks 时优先 Tasks；活动选择时所选源及真实对象优先；无 Tasks 时沿原 priority 分配。三分区、紧凑预算、退出/再次选择和动态更新通过，不改变任务状态或真实完成反馈。
3. **UX-3 文本边界**：Tasks 选择标题的 `read only` / `readonly` 已去除；真正影响许可的权限/只读信息、完整错误、用户原文和工具真实结果保留，不以缩短协议结果冒充展示精简。

发布 Node bin 的实际 CLI 已通过 PTY/xterm 补验：fullscreen/regular 下 Subagent 阅读、Jobs/Tasks 列表与输出子页、返回、resize 及原生工具命中可用。宿主与扩展共用 unbundled patched 模块，不能以直接 SDK/TUI 构造代替发布入口的验收。此结论仅适用于定制开发依赖，不证明官方 Pi 加载兼容；已确认的 U1 替代方案见 [待办阅读方案](../../../../todo/official-pi-compatibility/reading-ui.md)。

结论限于真实原生 TUI/SDK、xterm ANSI 输出与组件证据；未进行实体人工终端或 Windows 验收。没有外网账号凭据，不作真实账号权限、解密或中转粘性证明；模型配置、执行 owner、任务状态与自动压缩策略均不属于本专项变更。

[返回已完成索引](../../../index.md)
