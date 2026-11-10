# UI-1：公共工具外观交由 Pi 原生外壳

## 当前状态与根因

[`src/ui/tool-render.ts`](../../../src/ui/tool-render.ts) 的公共 `toolRenderers()` 设置 `renderShell: 'self'`。`ToolShell` 使用 `DynamicBorder` 绘制上下 `borderMuted` 横线，并自行处理 `outputPad`。

Pi 内置 read、bash 等工具通常让宿主 `ToolExecutionComponent` 使用默认背景块、留白与 pending/success/error 状态背景；edit 等工具虽自行生成外观，但也采用背景块。Suite 使用相同主题并不能消除外壳结构的差异。

当前调用壳在尚无结果时显示，部分/最终结果通过共享 renderer state 接替调用壳；这一摘要去重契约仍需保留。Pi 原生工具组件已经负责展开状态、结果点击和图片处理，本专项不另建执行组件。

## 目标方案

1. 移除 Suite 公共 renderer 的 `renderShell: 'self'`，采用 Pi 默认工具外壳。
2. 将 `ToolShell` 的职责收敛为正文组件；按照最终职责命名，不再负责工具上下横线、外层背景或外层留白。
3. Suite 继续负责调用摘要、结果摘要、结构化展开、明确语言的代码/命令高亮、完整错误及敏感信息隐藏。
4. 默认外壳负责外层 `outputPad`、纵向留白和执行状态背景；正文中的任务层级缩进属于内容，应保留。避免默认外壳与正文重复应用 padding。
5. 保留调用与结果共用 state 的接替机制：无结果时只显示调用摘要，首次部分结果到达后显示结果摘要，最终结果继续更新同一执行展示；不额外创建一条工具调用记录。
6. 只修改 Suite 公共外观，不覆盖 Pi 内置工具各自的 renderer 设计；内置 bash/powershell 增强继续仅装饰调用正文。

## 影响范围与维护约束

- 公共入口：`src/ui/tool-render.ts`。
- 登记与回放：`src/runtime/renderers.ts`、`src/runtime/tools.ts`。
- 消费模块：tasks、jobs、agents、goal、ask、wait、workflow 的公共工具视图。
- 展示入口：主会话、恢复/重载历史、Ask History、活动 child Transcript 与已回收 renderer 的历史 lookup。

`renderCall` / `renderResult` 继续按宿主提供的 theme、renderer state 和 lastComponent 工作。正文保持字面量清理在配色之前，敏感信息不经错误诊断重新暴露；结构化内容及语法高亮不因外壳统一而退化为纯字符串。

状态背景由宿主按照实际 partial/error 状态生成，不根据 Suite 的摘要图标猜测执行状态。不改工具 execute、结果正文或持久消息，只改显示。

## 不采用的方案

- 不仅把 `borderMuted` 改成另一个颜色；问题是外壳结构不同。
- 不在每个领域 renderer 中复制背景块、padding 或边框逻辑。
- 不对 Pi 内置 read/edit/bash 的执行定义做替换以迁就 Suite 外观。
- 不保留一层不可见自绘外壳再在外面叠加默认外壳。

## 任务列表

- [ ] 收敛公共正文组件职责，移除自绘工具横线与重复外层 padding。
- [ ] 保留调用、部分结果和最终结果的单份摘要接替机制。
- [ ] 核查错误全文、敏感输入隐藏、结构化字段与代码/命令缓存。
- [ ] 核查登记、恢复、child 实际 renderer 与历史 lookup 使用同一外观规则。
- [ ] 更新已有工具外壳检查中关于 self/horizontal border 的目标断言，不保留固化自绘外壳的过时断言。
- [ ] 实施后局部同步[统一界面](../../current/ui/index.md)与[工具契约](../../current/runtime/tools.md)。

## 验收标准

- 同一主题与 `outputPad` 下，Suite 工具与 Pi 默认外壳遵循一致的背景和留白规则，无额外上下横线。
- 调用、部分结果、最终结果及错误均不出现重复摘要或双层留白。
- 单项点击、宿主全部展开、正文完整性和窄宽度截断保持既有契约。
- 改变主题、缩放终端、恢复会话及回收 child 后，工具展示仍一致。

[返回专项索引](index.md)
