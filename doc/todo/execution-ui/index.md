# 执行界面与查看器优化

## 目标与正式范围

本专项统一优化输入框上方的常驻列表、工具调用/结果显示、Jobs 查看器和 Subagents 会话查看器。实现应扩展现有 Dock、工具 renderer、BrowserView、DetailsView、ScrollView、InlineInput 和终端会话能力，不建立平行的 UI、进程管理或状态系统。

Subagents 会话查看器采用确定布局：**移除顶部运行长标题，将其内容精简、高亮后放入底部信息栏；底部信息栏是查看器的一部分，不替换主会话 footer。**

本目录记录剩余实施需求及尚未完成的专项验收；“已实现”仅表示当前工作区存在对应能力，不等于本专项整体完成或实际 CLI 已验收。用户可见提示使用统一浏览框架的英文风格；本文中的中文布局示意用于说明信息层次。

## 需求索引

新增导航细节已形成当前代码基线，实施与 SDK/组件验证见 [导航细节专项](../../finished/pi-suite/ui/navigation-details.md)。后续方案直接复用这些能力，不重复实现：

- Dock 分区固定为 Goal → Tasks → Agents → Jobs → Workflows；priority 决定预算保留，不改变显示位置。空编辑器按 ← 进入，↑↓ 逐行选择，`[`/`]` 循环切换可选分区。
- Tasks 的可见组与子任务参与 Dock 选择，Enter 通过共享字面量详情模式只读查看；`src/ui/dock/rows.ts` 已按真实位置生成前段、后段和间隙折叠提示，微小预算保留选中对象及紧凑方向计数。
- BrowserView 已统一 List/Details、Filter/Search/Input 的焦点标记、活动/非活动样式和鼠标焦点；非活动列表不保留选中背景，记录状态与正文语法色仍可读。
- 模型配置选择已支持 provider/modelId/显示名模糊过滤，保留 No override、thinking 能力和宿主 keybindings；Ask 批量题目已支持可选 `title` 与响应式短标题页签。
- Suite 生成的提示已使用英文；用户文本、程序输出及密码提示识别保留原文。主会话 footer 未修改。

固定顺序与焦点改进不等于 Job 名称、领域选中状态或会话底部布局已完成：JobsModule 仍追加文本级 `>`，Jobs 仍进入二次操作菜单，Subagents Transcript 仍使用顶部长标题和单行 Input。

| 用户需求 | 正式实施内容 | 当前状态 | 详细方案 |
| --- | --- | --- | --- |
| 1 | Tasks → Agents → Jobs 固定顺序，Job 只以名称标识，状态配色 | 顺序与导航已实现；Job 名称及 Dock 状态角色待完成 | [Dock 与工具显示](dock-tools.md#1-dock-固定顺序名称与配色) |
| 2 | 工具结果有明确执行外框，区别于模型正文 | 公共 self-shell 执行外框待实现 | [工具执行外框](dock-tools.md#2-统一工具执行外框) |
| 3 | 工具调用、折叠和展开内容高亮 | 已有部分语义色；结构化展开和语法高亮待扩展 | [工具文本高亮](dock-tools.md#3-工具文本与展开内容高亮) |
| 4 | 返回后清除 Job 可见选中态与残留 `>` | Dock 自身会退出激活态；领域标记与最近查看优先级待统一 | [选择状态统一](dock-tools.md#4-选择状态与残留标记) |
| 5 | 选中 Job 直接进入命令与实时输出界面 | 现有日志/终端能力可复用；统一直接查看入口待实现 | [Jobs 查看器](jobs-viewer.md) |
| 6 | 内置命令工具与 Job 命令高亮，Suite 设置可控制内置增强 | 高亮增强及配置字段待实现 | [命令高亮与配置](dock-tools.md#5-共享命令高亮与-suite-配置) |
| 7 | Jobs/Subagents 浏览态双左退出 | 跨层 back/close 结果与双左识别待实现 | [统一退出与焦点](subagents-navigation.md#3-双左退出与焦点优先级) |
| 8 | Subagents 底部信息栏、正文分隔、`m` 原生 Editor | 内联发送已有单行 Input；底部信息栏、分隔及多行 Editor 待实现 | [Subagents 底部布局](subagents-navigation.md) |

## 统一约束

- 固定布局顺序与业务保留优先级分开；稳定对象身份与可见名称分开；浏览记录与执行控制权分开。
- 所有颜色使用 Pi 主题角色，复用 ANSI 安全宽度计算、截断、换行和原生输入组件。
- 后续 UI 样式不改变工具参数、执行实现、模型收到的 `content`、结构化结果、归属或停止契约；保留已支持的 Ask `questions[].title`，敏感输入仍不得泄露。
- 打开、刷新、缩放和主题切换不重置阅读位置、查询或输入草稿。关闭、会话重绑和 reload 释放本次查看器的订阅、计时器与焦点。
- 不更改主会话 footer 或第三方状态栏插件，不使用替换 footer 的方式实现查看器底部信息栏。
- PTY 显示终端屏幕，pipe 显示真实流内容；不将 pipe 输出或不完整历史日志宣称为完整终端还原，不自动改变 Job 的执行模式。
- 默认视图紧凑，完整字段和控制操作通过现有快捷动作框架访问；危险操作保留确认。

## 实施顺序

1. 在已实现的 Dock 固定顺序、只读 Tasks、分区切换和折叠窗口上，完成 Job 名称、Dock 状态角色及领域选择状态统一。
2. 公共工具外框、展开高亮与命令高亮配置；复用现有调用/结果合并状态，不重写工具执行。
3. 统一 Jobs 查看入口、实时输出与 PTY 屏幕呈现，保留 BrowserView 已有焦点、过滤和阅读状态。
4. Subagents 底部信息栏、共享原生 Editor 和浏览链路双左退出；保留已有 run 校验、内联发送、模型筛选及焦点角色。
5. 增量补充定向契约验证、实际 CLI 交互验收、当前文档同步及完成归档。

## 验收与文档维护

优先调整已有 UI、renderer、viewer 与终端测试；新增测试只覆盖跨入口和容易回归的共享契约，不为每种文案、颜色或细小修补分别添加测试。日常测试总耗时保持在 5 分钟内，全量测试保持在 10 分钟内。

实际 Pi CLI 至少检查 40×24 与 120×40，以及 inline/fullscreen 两种布局；覆盖中文与多行内容、主题变化、缩放、有无记录、活动/结束/只读对象、输入焦点、嵌套查看器退出和 PTY 操作。主会话分别使用原生 footer 与已有第三方 footer，确认退出查看器后均保持原样。

现有 SDK/组件契约已覆盖 Dock 固定顺序、只读 Tasks、`[`/`]`、双向折叠和小预算，以及浏览器焦点/鼠标、模型筛选和 Ask Unicode 页签；后续调整应维持这些结果。它们不替代 Job 残留标记、统一查看器、Subagents 底部信息栏、Editor、双左退出及第三方 footer 的实际 CLI 验收。

相关稳定文档：

- [统一界面](../../current/ui/index.md)、[主题](../../current/ui/themes.md)、[终端操作](../../current/ui/terminal.md)
- [工具契约](../../current/runtime/tools.md)、[设置与退出](../../current/runtime/settings.md)
- [Jobs](../../current/jobs/index.md)、[Subagents 操作](../../current/agents/operations.md)
- [验证规则](../../current/validation.md)

实施完成后，仅局部更新受影响的 `doc/current` 操作与架构章节，迁移本专项至 `doc/finished` 并更新两侧索引；不在 current 中写实施流水账或本机测试产物路径。

## 任务

- [x] Dock 固定分区顺序、同序选择、只读 Tasks、方括号切换与双向折叠窗口
- [x] 共享浏览器焦点、英文提示、模型筛选与 Ask 短标题基线（见已完成导航细节专项）
- [ ] 完成 Job 名称、Dock 状态配色及领域选择状态统一
- [ ] 完成公共工具外框、高亮与内置命令高亮设置
- [ ] 完成 Jobs 直接查看、实时输出及终端屏幕能力
- [ ] 完成 Subagents 底部信息栏、原生 Editor 与统一退出
- [ ] 完成定向验证、实际 CLI 验收、文档同步与专项归档

[返回待办索引](../index.md)
