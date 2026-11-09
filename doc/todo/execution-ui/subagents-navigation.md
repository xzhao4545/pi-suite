# Subagents 底部信息栏与统一导航

## 正式布局

Subagents 会话查看器**删除顶部运行长标题，将其必要内容移到底部精简信息栏**。信息栏属于查看器布局，与正文和快捷键栏分隔，不设置或替换主会话 footer。

```text
子代理原生会话输出……
────────────────────────────────────
代码检查 · running · 32s · ↑12k ↓3k
模型名称 · thinking high · 8 tools
────────────────────────────────────
 m message · d details · o tools · h thinking · Esc back · ←← close
```

实际提示使用统一框架的英文文案。查看器不在顶部重复名称、状态、模型、thinking、ID 或阅读位置；顶部只保留必要外边界，正文直接开始。

## 当前实现与根因

- `src/agents/viewer.ts` 的 `transcriptTitle()` 拼接名称、状态、时间、模型、thinking 和 agent ID，再由 DetailsView 放入顶部 readerHeading。信息长且单一色调，窄屏易截断主要内容。
- `src/ui/details.ts` 只有顶部标题、正文和底部操作文字，正文与操作区没有独立内部分隔线。
- `src/ui/inline-input.ts` 已支持在原查看器/列表中发送消息，但使用单行 Pi Input，不能呈现原生 Editor 的多行输入框和编辑边线。
- BrowserView、DetailsView 的退出主要依赖 Esc，嵌套列表/详情调用会在局部 done 后重新打开来源页面，没有统一的整条浏览链路退出结果。

## 1. 底部运行信息

### 字段与显示优先级

| 优先级 | 字段 | 角色与规则 |
| --- | --- | --- |
| 最高 | 当前 subagent 名称、状态 | 名称 text + bold；状态使用共享记录状态色 |
| 高 | 运行耗时、等待父级回答等必要状态 | 耗时 muted；待答 warning，不与普通 waiting 混淆 |
| 中 | 模型、thinking | 模型适度 accent；thinking 标签 muted，值保持可辨识 |
| 中 | 输入/输出 token | 紧凑单位，muted；数值来自当前 run 的使用量 |
| 较低 | 工具次数 | muted，可在窄屏省略 |
| 详情 | agentId、runId、cwd、完整模型来源、权限、错误等 | `d` 查看，不在常驻信息栏追加机器 ID |

- 信息来自当前选中的 **runId**，不使用主 agent 的模型或统计，不因同 agent 的后续 run 创建而切换数据源。
- 宽屏尽量一行，普通宽度最多两行；窄屏先省略工具次数与次要指标，再截短模型/名称，保证名称和状态可辨识。完整信息始终可通过 `d` 查看。
- 计时、token、工具次数和状态沿用 Manager 快照与订阅；仅活动查看器需要的展示计时更新，不新增业务持久化或通知。
- 排队、尚未启动、结束和只读记录明确显示真实状态；耗时按照已有运行契约派生，不把排队时间冒充有效运行时间。
- `failed` / `limited` 使用 error，`queued` / `waiting` / `stopping` 使用 warning，`running` / `starting` 使用 success，`completed` / `stopped` 使用 dim。
- 阅读位置、following / paused、新输出与 End 恢复提示也在底部显示；空间不足时使用紧凑提示，不重新加顶部长标题。

### 区块边界与布局

- 正文 → 底部信息栏之间一条 borderMuted 分隔线；底部信息栏 → 快捷键/输入区域之间一条分隔线。外边界复用 DynamicBorder。
- 扩展 DetailsView 的可选底部信息区和标题布局选项；agent 查看器接入该能力，其他需要标题的静态详情仍可保留自己的标题。
- 底部信息、搜索、编辑框、反馈和快捷键都计入 readingRows 高度预算，正文使用剩余空间；不在渲染后直接裁掉输入光标或操作栏。
- 输出更新只影响正文和对应信息，不把运行信息追加成模型消息，不因底部字段宽度/行数变化重置跟随、滚动或搜索。
- 鼠标行坐标按新的正文起点/终点计算，分隔线和操作区不能被当成 transcript 行。
- 主会话原生 footer 和第三方 footer 均不修改，不调用 setFooter，不重建或复制插件实例；返回主会话后保持其原有数据、布局和订阅。

### 快捷动作

保留现有 `m` Message、`o` Tools、`h` Thinking、`j` Jobs、`c` Model / thinking、`b` Background、`x` Stop subtree，按 run 归属与状态动态显示；添加 `d` 完整运行详情。模型编辑、所属 Jobs 和静态详情返回时保留原 transcript 的阅读状态；整条链路关闭时不得自动重开查看器。

## 2. `m` 原生 Editor

### 打开与编辑

- 在共享 InlineInput 中增加原生 Editor 模式，复用 Pi Editor 的边线、光标、撤销、多行编辑、粘贴和换行能力，不自行实现文字编辑器。
- Transcript 和 Runs 列表的 `m` 都在当前视图底部打开该 Editor，提示为 `Message <名称>` 或 `Answer parent question`。不关闭原查看器，不跳到主会话输入。
- 底部信息栏保留。打开输入时，原快捷动作区改为 Editor 与发送/取消提示，正文相应缩小；输入区有界，长输入沿用原生编辑滚动，不把视图撑到终端以外。
- 使用注入的 KeybindingsManager 处理原生提交/换行键，默认 Enter 发送、Shift+Enter 换行；界面提示反映真实配置，不自定义一套与 Editor 不一致的换行规则。
- 输入组件接收所有文字和方向键；`m`、`d`、`o` 等输入内容不触发记录操作。正确传递 focused 和光标标记，保证中文输入法候选窗定位。
- 搜索与消息编辑是互斥的底部输入模式；先结束当前模式再进入另一模式，不出现两个文本焦点。

### 发送、取消和反馈

- Esc 关闭 Editor，恢复原阅读/列表焦点，不退出查看器。空提交取消，不发送空消息；取消的本次草稿不自动提交。
- Enter 发送后保留原视图。发送成功后按已有消息行为更新正文，原本 following 的 reader 继续跟随；发送失败保留可重试的草稿与明确错误，不丢弃内容后静默返回。
- 发送前重新校验 canMessage、父级归属和所选 runId。当前 run 已结束或不接受消息时，只在本视图提示错误，不发送给该 agent 的后续 run。
- 等待提交期间不重复发送，控制快捷键不会穿透到底层进程/主编辑器；Esc 可退出输入显示，但不能被解释为取消已经交给 Manager 的消息或停止子代理。
- 提交结果或错误在底部显示，按现有下一次操作清除规则处理，不使用主会话 notify 替代本视图反馈。
- BrowserView 和 DetailsView 共用同一 Editor/composer 实现；保留确实只需要单行输入的组件能力，不把过滤 Input 改成消息编辑器。

## 3. 双左退出与焦点优先级

### 浏览态退出契约

- Jobs/Subagents 的浏览列表、会话输出、运行详情和所属 Jobs 等浏览态，连续两次无修饰 `←` 在 **300ms** 内触发 close，回到主输入框。
- 两次之间有其他按键则取消本次判断；超时重新计为第一次。判断由公共框架持有，不依赖各页面各自的全局计时器。
- 忽略 key release；终端协议可识别 repeat 时，不将自动重复计为第二次按下。传统终端没有 repeat 标记时，不宣称可以可靠区分所有长按输入。
- 普通单次左键不退出、不改变浏览顺序；Dock 在空编辑器中的左键进入行为保持不变，不把进入动作算入查看器的双左退出。
- 区分 `back` 与 `close` 结果：Esc 逐层返回来源页面，双左 close 沿整个调用链传播到 Jobs/Subagents 命令或 Dock 入口。不能只关当前详情后，被外层 for 循环重新打开列表。
- 通过 BrowserView、DetailsView 和阅读入口的统一结果/导航契约接入，不逐页面写重复的 Esc/时间戳/返回循环。

### 文本与程序输入边界

按键优先级为：原生文字编辑/搜索 → 明确接管的 PTY 输入 → 浏览器导航与动作 → 主编辑器。

- 消息 Editor 和搜索 Input 内，左右键用于移动光标，不触发双左退出；Esc 先关闭当前输入模式。
- PTY 查看态是 Jobs 浏览态，双左退出有效。PTY 接管态左右键属于程序，使用现有可配置 detachKey 离开，不延迟或吞掉程序的方向键。
- double-left 是查看器退出，不是 stop、abort、clear 或向程序发送两次左键；关闭过程中不触发主 agent 中断。
- 关闭、异常和 session bind/detach 释放本视图订阅/计时器/composer，清除双左待判状态与可见 Dock 选中态。重开界面不继承上一次第一次左键。
- 焦点通过 Pi custom/overlay 的 done 生命周期恢复，不直接修改宿主私有 focus，不依赖异步通知来补救焦点。

## 影响范围

`src/agents/viewer.ts`、`src/agents/viewer-info.ts`、`src/agents/ui/runs.ts` / `index.ts`、`src/ui/details.ts`、`src/ui/browser.ts`、`src/ui/inline-input.ts`、`src/ui/reading.ts`、`src/ui/actions.ts`、`src/ui/browser-chrome.ts`，以及 `src/jobs/viewer.ts` / `log-viewer.ts` / `src/ui/terminal.ts` 的导航和输入边界。

复用当前 Transcript 原生组件和 ScrollView 持续跟随能力；不因本次布局重新提取模型纯文本、不重建整段历史，也不实现另一套消息发送、父级提问或子代理状态数据源。

## 验收

- 活动 subagent 查看器顶部不显示运行长标题；底部信息来自当前 run，名称/状态、模型/thinking 和使用量可分辨，长名称、窄屏与缩放最多两行。
- 正文、信息栏和快捷键/输入区边界明确，工具展开与多行模型输出不会混入操作区；主题切换和中文宽度正确。
- 流式消息、并发工具、waiting(parent)、停止和最终结果更新信息，不产生新会话记录或重置 reader；暂停与新输出提示在底部清晰可见。
- Transcript 与 Runs 列表 `m` 都出现原生 Editor，支持中文、多行、粘贴、撤销、发送和 Esc 取消；输入文字不触发动作，run 结束竞态不误发，失败可重试。
- 从 Dock、`/subagents` 和 `/jobs` 进入嵌套浏览链路，Esc 逐层返回，双左一次退回主输入框，不重开来源视图；退出后无残留 `>`、计时器或焦点。
- Editor/搜索的双左只移动光标；PTY 查看态可退出，接管态方向键到达程序且配置的 detachKey 可离开，Job 不因退出被停止。
- 主会话分别使用原生 footer 与第三方 footer，进入/退出不修改 footer 工厂、数据或订阅，返回后状态栏照常显示。

## 任务

- [ ] DetailsView 可选底部信息区，Subagents 顶部长标题迁入精简高亮信息栏
- [ ] 正文/信息/操作区分隔、高度预算、底部阅读提示与鼠标坐标
- [ ] Transcript 与 Runs 列表接入共享原生 Editor
- [ ] 发送/取消/失败草稿及 run 归属校验、焦点与中文输入
- [ ] 统一 back/close 导航结果，Jobs/Subagents 双左退出跨层传播
- [ ] 编辑/搜索/PTY 接管按键边界及关闭资源释放
- [ ] 定向验证及 agents/jobs/ui 操作文档局部同步

[返回专项索引](index.md)
