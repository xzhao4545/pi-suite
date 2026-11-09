# Dock 与工具显示

## 当前实现与根因

- `src/ui/dock.ts` 的 `sections()` 按分区最高 priority 排序；`render()` 在选择激活时再把选中分区置顶。显示顺序与键盘遍历因此随状态和选择发生变化。
- `src/jobs/index.ts` 的 `refresh()` 拼接 `job <短 ID> <名称>`，并按 `selectedJob` 直接在文本前追加 `> `。Dock 自身也维护选择并绘制 `>`，形成两套可见选择状态。
- BrowserView 通过 `src/ui/browser-chrome.ts` 应用记录状态颜色，DockRow 尚未携带统一状态角色。Agents 的 `waiting(parent)`、Job 的 cleanup 也需要明确的显示状态。
- `src/ui/tool-render.ts` 设置 `renderShell: 'self'`，绕过 Pi 默认工具背景，但自身只返回带 outputPad 的文本，没有执行外框。展开路径主要使用无颜色 Text，领域 renderer 返回的普通字符串没有统一语义高亮。

## 1. Dock 固定顺序、名称与配色

### 分区与导航顺序

- Tasks、Agents、Jobs 固定为 **Tasks → Agents → Jobs**；任何状态变化、刷新和键盘选择都不得改变三者相对位置。
- 扩展 DockSource 的固定顺序声明，在注册来源处给出明确顺序。Goal 的独立 Dock 摘要放在这三类之前，Workflows 的独立分区放在三类之后；两者不插入这三类之间。
- priority 仅用于决定保留哪些对象行、父子连带保留和必要详情预算，不用于分区排序。
- 进入选择时不将选中分区置顶。可选行使用同一固定分区序列和来源内部顺序遍历；数量摘要不参与选择，Tasks 常驻摘要仍按其现有可打开能力决定是否参与。
- 高度足够时为非空分区保留至少一条摘要，再给选中对象分配可见空间。高度不足以容纳全部分区时，使用保持相对顺序的可见窗口，保证所选对象可见；不能为避免裁剪而倒置分区，也不能允许 Enter 打开不可见对象。
- 对象刷新、同名、截断和移除时仍按 sourceId + rowId 协调选择。不会因为名称变化跳到另一个对象。

### Job 名称

- Dock、`/jobs` 列表、subagent 所属 Jobs 列表的名称区只显示 Job 名称，不追加 `job` 前缀或短/完整 ID。
- 列表选中信息也优先显示名称，不在常驻选择摘要中重新引入 Job ID。状态、耗时和输出模式等必要指标放在独立后缀，不混进名称。
- 新 Job 的名称沿用 Manager 已有的显式 name / 命令首行 / 文件监控名称派生能力；显示函数不得把 ID 作为用户可见名称。名称清理后为空时，应使用可解释的命令或监控名称，并明确处理无法取得名称的记录。
- 完整 ID 保留在内部稳定身份、工具协议、搜索元数据和 `d` 详情中。重名对象以稳定 ID 选择，详情可辨认，不给列表追加机器 ID 来消歧。
- 不修改模型工具返回的 ID 与查询协议；人类浏览标签和模型工具摘要分开维护。

### 状态角色

DockRow 携带状态或语义角色，统一在共享 UI 层着色。领域模块提供字面量数据，不将主题 ANSI 写入状态快照。

| 状态 | Pi 主题角色 |
| --- | --- |
| starting、running | success |
| queued、waiting、waiting(parent)、stopping | warning |
| failed、limited、timed_out | error |
| completed、stopped | dim |
| cleanup pending / unconfirmed | warning；仍按清理契约保留必要行 |

名称、状态、时间与其他指标分开渲染；状态配色不能误染同名字符串。选中行使用选中背景和明确的行首标记，不用整行 accent 覆盖状态颜色。Agents 标题状态计数、Job 清理提示与紧凑后缀使用同一角色。

## 2. 统一工具执行外框

- 在 `tool-render.ts` 的公共 self-shell 中复用 Pi `DynamicBorder`，让所有 Suite 工具调用/结果有与原生命令执行相同类型的上下边界。必要时扩展 `src/ui/frame.ts` 支持执行块主题角色，不逐工具实现外框。
- 调用尚未得到结果时显示一套外框；部分结果开始后，由结果组件接管执行块，调用组件不再输出另一套外框；最终结果和展开状态仍是同一个执行块。
- 保持折叠摘要紧凑；展开时展示完整可读内容，结果正文与模型正文有明确边界，错误全文保留且显著着色。
- 外框、内边距与正文宽度统一计算，outputPad 不重复应用；不通过手工字符串长度处理 ANSI、中文、emoji 或多行内容。
- Pi 内置工具保留原生执行壳；已有自定义壳的第三方工具不重复套框。未提供扩展 renderer 的工具继续使用 Pi 通用工具呈现，不退化成模型正文。
- 原生宿主继续管理工具展开、鼠标区域、图片和流式调用/结果配对。Suite 不建立第二套工具执行容器或交互协议。
- 主会话、恢复历史、Ask History 和 child Transcript 使用同一登记 renderer；仅展示的路径不得重新执行工具。

## 3. 工具文本与展开内容高亮

### 内容角色

| 内容 | 显示方式 |
| --- | --- |
| 工具名称、主要对象 | toolTitle / accent，必要时 bold |
| 成功、失败、等待、停止与限制 | 统一状态语义角色 |
| 字段标签、来源、次要指标 | muted / dim |
| 普通结果正文 | toolOutput |
| 完整错误、警告、截断和清理未确认 | error / warning |
| 明确类型的命令、代码、JSON | Pi 原生语言高亮 |
| 原生 read/write 代码、edit diff | 保留原生 renderer 的高亮与差异呈现 |

- 扩展 ToolView 的展开表达能力，允许结构化行或原生 Component，避免把所有字段和正文拼成失去角色的字符串。
- 调用、折叠、展开和错误使用同一语义角色。展开内容保留主要对象与状态概览，正文不会因展开失去高亮。
- 只有明确标注语言或可依据真实文件路径确定语言的内容才进行语法高亮；普通日志和任意工具正文不强行识别成 Markdown/代码。
- 先清理不可信内容，再生成可信样式。不在染色后执行会剥离 ANSI 的 sanitize；进程控制序列只在终端模型中解释，不能直接注入主会话工具显示。
- 敏感 job_write 输入继续隐藏，高亮、展开和错误展示不得绕过敏感字段契约。
- 使用共享组件缓存昂贵布局与高亮，内容、宽度、语言或主题变化时失效；主题 ANSI 不持久化进业务状态。

## 4. 选择状态与残留标记

- 可见 `>` 与选中背景只由 Dock 管理，移除 JobsModule 的文本级选中标记。
- 将“记住最近查看对象”与“当前选择激活”分开。可记住上次对象身份，但关闭查看器后常驻行不得继续显示选中标记或选中背景。
- Agents/Jobs 的最近查看引用不再永久提高常驻优先级。必要的选中行优先保留由激活中的 Dock 负责，不由领域状态长期持有。
- Enter 打开、Esc/→ 退出选择、详情关闭、双左退出以及会话 bind/detach 都走统一状态更新。异常关闭也不能遗留可见选择状态。
- 检查 Dock 的 ask/detail 隐藏与恢复路径，确保重新显示时 active 为 false；后续再次按左可定位上次仍存在的对象。

## 5. 共享命令高亮与 Suite 配置

### 覆盖入口

- Pi 内置模型工具 `bash`，以及可用的 `powershell` 的命令调用区。
- Jobs 查看器的顶部实际执行命令，包括展开后的多行命令。
- Suite 工具展开中的 command 字段。
- child Transcript 中对应的内置命令工具显示应与主会话使用一致规则。

使用 Pi 现有语言高亮及真实 shell 语言信息，区分字符串、变量、选项、管道、重定向、注释和多行结构，不用整行单色冒充语法高亮。不执行命令来取得高亮信息，也不改变命令原文。用户 `!`/`!!` 的 BashExecutionComponent 不属于本次内置模型工具配置范围。

### 配置契约

```json
{
  "ui": {
    "highlightBuiltinCommands": true
  }
}
```

- 默认 true，只控制内置模型命令工具的增强语法高亮。false 完整保留其原生调用显示，不影响工具执行、输出和原生外框。
- Jobs 命令区及 Suite 展开的 command 字段默认高亮，不受该内置工具专用开关影响。
- 将字段接入 configSchema、SuiteConfig、defaults、用户/项目逐字段继承与现有 schema 驱动 SettingsList；不添加另一套设置存储。
- `/suite` 显示来源、默认值、用户值、项目值和有效值；保存后按现有规则 `/reload` 应用。
- 通过 `registerToolRenderer` 和 `next()` 组合显示，保留原生结果 renderer、计时、超时、部分参数、流式输出、截断、图片和展开能力。不重注册内置工具执行实现，不覆盖其他扩展的执行后端。
- renderer 登记与 child Transcript 的 lookup 保持统一；不得只修改主会话而让 child 继续使用另一份显示定义。

## 影响范围

`src/ui/dock.ts`、`src/ui/status.ts`、`src/ui/browser-chrome.ts`、`src/ui/frame.ts`、`src/ui/tool-render.ts`、`src/ui/transcript.ts`，以及 agents/jobs 的行数据与工具 renderers、`src/runtime/renderers.ts`、`src/runtime/tools.ts`、`src/runtime/config.ts` 和设置入口。

新增能力按 UI 展示/渲染职责分组；`src/ui` 已有较多文件，不继续在其根目录平摊新增文件，应结合本专项评估以 dock、rendering 或 viewer 子目录组织，保留模块边界。

## 验收

- Tasks/Agents/Jobs 同时存在，分别出现 waiting、failed、stopping、cleanup 和普通活动；刷新、左键进入、跨分区移动时顺序不变，所选对象始终可见。
- 同名 Job、中文名称、超长名称和极小预算下，不显示机器 ID、不选择错误对象。状态颜色在普通、选中、紧凑和标题计数场景一致。
- 从 Dock 与 `/jobs` 打开 Job，Esc 返回后无残留 `>` 或选中背景；重新选择仍可定位有效对象。
- 代表性 Suite 工具在调用、部分结果、最终成功、错误与展开中仅有一套外框；主会话和 child Transcript 一致，敏感输入不泄露。
- 命令、多行 JSON、代码与 diff 按正确语言/角色显示；主题切换和缩放清除缓存，普通日志不被错误解释。
- 配置 true/false 和项目覆盖用户值分别检查，执行与原生结果显示不变；设置保存和 reload 遵守现有契约。

## 任务

- [ ] Dock 固定分区顺序、可见预算与同序键盘选择
- [ ] Job 人类浏览名称精简及 Dock/Browser 统一状态角色
- [ ] 可见选择状态归一化，清除领域文本 `>` 与持久选中优先级
- [ ] 公共工具执行外框与调用/结果合并显示
- [ ] 结构化展开高亮、错误与敏感内容契约
- [ ] 共享命令高亮、renderer 组合及 Suite 配置
- [ ] 定向验证及 ui/runtime/jobs/agents 文档局部同步

[返回专项索引](index.md)
