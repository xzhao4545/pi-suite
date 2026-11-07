# Tasks 编号、状态样式与紧凑反馈

状态：方案已确认，未实施。上一轮 [Tasks 交互](../../finished/pi-suite/tasks-goal-interaction.md) 的 `#ID 标题` 左置、状态图标右置方案已被用户否决，本专项替换其显示规则。

已确认决策：

- 子任务 ID 为 `组ID.序号`（如 `1.2`），显示编号与工具 ID 为同一文本。
- 删除子任务跨组移动能力（update.parentId）；需要移动时删除后在目标组新增。
- 旧 version 2 任务文件读取时自动转换为 version 3。
- 待办使用默认前景色，只有完成项使用灰色；此点按用户要求，不沿用 OMP 的待办 dim。

## 原始需求

- [ ] 1. 任务行去掉 `#` 前缀。
- [ ] 2. 状态图标放在行首，不放在右侧。
- [ ] 3. 子任务不与父任务共用全局编号，子任务编号为 `1.1`、`1.2`。
- [ ] 4. 紧凑显示（询问打开时）不能只剩一行汇总，至少显示当前父任务与其实际子任务两行。
- [ ] 5. 未完成任务不能使用灰色；只有已完成任务使用灰色。
- [ ] 6. `/tasks` 能看到已完成任务。
- [ ] 7. 任务工具调用默认只显示一行摘要，例如创建时只显示创建了几项，不铺开全部内容。

## 当前原因

| 需求 | 根因位置 |
| --- | --- |
| 1、2 | `src/tasks/presentation.ts` 的 `taskDisplay` 固定拼接 `#${id} 标题`；Dock（`TasksModule.rows`）、task_list renderer、TaskBrowserView 都把 `taskIcon` 放进 `suffix`/description，状态因此在右侧 |
| 3 | `src/tasks/model.ts` 的 `create` 对组和子任务共用 `data.nextId++`；`types.ts` 的 `taskId` 模式 `^[1-9][0-9]*$` 只允许单段数字 |
| 4 | `TasksModule.rows(true)` 只返回 `tasks:summary` 一行；`Dock.dockAllowance` 在询问期间最多分配 1 行。非紧凑模式只附带 doing/blocked/刚完成子任务，组内全是 todo 时只显示组行 |
| 5 | `taskStyle` 对 todo 使用 `dim`，对 done 使用 `success` 加删除线 |
| 6 | `/tasks` 与 TaskBrowserView 默认 `state='unfinished'`，`queryTasks` 因此排除已完成组与子任务；只有 `/tasks all` 或手动切换 State 才能看到 |
| 7 | task_edit 折叠结果按每个回执输出一行（最多 6 行再加汇总）；task_list 折叠时仍输出最多 8 行；task_get 未注册 renderer，宿主直接显示全部正文 |

## OMP 参考结论

阅读 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 提交 `f2b795ba747b23d42052184d822b41e3d01357cc`：

| 位置 | 设计 | 本方案处置 |
| --- | --- | --- |
| `packages/tui/src/tools/todo.ts` `formatTodoLine` | 每行 `<复选框> <文本>`，图标在行首，颜色作用于整行；完成 `☑` + 删除线，其余 `☐` | 采用行首图标与整行着色 |
| 同上 | 待办为 `dim`，完成为 `success` 绿色 | 不采用：待办使用默认前景色，完成使用 `dim` + 删除线 |
| 同上 `renderCall` / `renderResult` | 调用中一行 `Todo <op> <task> <N items>`；结果卡片头部 `☑ Todo 12 tasks`，折叠时最多 8 行窗口 | 调用中保持一行；结果折叠改为仅一行摘要，展开才显示明细 |
| `packages/coding-agent/src/modes/interactive-mode.ts` 紧凑状态段 | 终端少于 18 行时只显示 `TODO 3/7 · ☐ 当前任务` | 不采用单行：用户要求至少父、子两行 |
| 同上 `#renderTodoList` | 当前阶段展示最近完成 1 项、进行中项及后续待办 | 采用“当前子任务”概念，选择规则见第 3 节 |
| `packages/coding-agent/src/modes/controllers/todo-command-controller.ts` `/todo` | 无参数时输出完整清单，含已完成项 | `/tasks` 默认显示全部状态 |
| 编号 | 任务按内容引用，没有 ID；多阶段时阶段头用罗马数字 | 不采用：Suite 需要稳定 ID 供 job/agent/调度引用，改为两级 `组.子` ID |

## 方案

### 1. 两级 ID 与存储 version 3

#### ID 规则

- 组 ID 为 `N`，继续由 `data.nextId` 分配；`nextId` 只计组。
- 子任务 ID 为 `组ID.M`。组记录新增 `nextChild`（新组为 1），每次在该组创建子任务时 `M = nextChild++`。
- 编号删除后不复用：删除 `1.2` 后新增项为 `1.4`，显示会有空号。这样 job、agent run、调度记录中已写入的 `taskId` 不会指向新任务。
- 子任务在 `data.tasks` 中保持创建顺序；没有跨组移动后，组内数组顺序等于序号顺序，查询与 Dock 不需要额外排序。

#### schema（`src/tasks/types.ts`）

导出三个 schema，替换现有单一 `taskId`：

| schema | 模式 | 使用位置 |
| --- | --- | --- |
| `groupId` | `^[1-9][0-9]*$` | task_list.groupId、add.parentId、存储中的 parentId |
| `childId` | `^[1-9][0-9]*\.[1-9][0-9]*$` | start/done/block/unblock 的 id；`src/jobs/tools.ts` job_start.taskId；`src/agents/tools.ts` agent_start.taskId |
| `taskId` | 以上两者之一 | task_get.id、update/delete 的 id、blockedBy 元素、存储中的 id |

- `src/agents/schedules/store.ts` 删除自带正则 `'^[1-9][0-9]*$'`，改为导入 `taskId`（不是 `childId`）。原因：已保存调度中的纯数字旧 taskId 仍能通过文件校验，不会让整个调度文件变成无效文件；触发时由 `AgentManager.start` 现有检查（`manager.ts` 第 144–146 行）报告该子任务不存在。
- `mutationSchema` 的 update 分支删除 `parentId` 字段；`src/tasks/schema.ts` 的扁平 `editSchema.parentId` 仅保留给 add 使用，`editArguments` 现有的 `Value.Check(changeSchema, params)` 会拒绝 update 携带 parentId。
- `storeSchema.version` 改为 `Type.Literal(3)`；任务记录新增 `nextChild: Type.Optional(Type.Integer({ minimum: 1 }))`。`emptyTasks()` 返回 version 3。

#### 模型（`src/tasks/model.ts`）

- `create(title, description, parentId)`：组使用 `String(data.nextId++)` 并写入 `nextChild: 1`；子任务使用 `${parentId}.${parent.nextChild++}`。
- update 分支删除 `change.parentId` 处理与 “Only children can move between groups” 错误；字段循环的 key 列表删除 `parentId`。
- `validateHierarchy` 改为：
  - ID 唯一。
  - 组：id 匹配 groupId、`Number(id) < nextId`、有 `nextChild`、无 status。
  - 子任务：id 匹配 childId、前缀等于 parentId、序号小于父组 `nextChild`、无 `nextChild`、有 status、父级存在且是组。
- 所有错误与警告文本去掉 `#`，如 `No task 1.4`、`1.2 blocks itself`。

#### version 2 转换（`src/tasks/store.ts`）

在 TaskStore 的解析回调中把 version 2 转为 version 3，删除现有 version 1 → 2 分支：

1. 按 `data.tasks` 原顺序遍历，组保留原 ID；每组 `nextChild` 从 1 开始。
2. 每组子任务按 `createdAt`、旧数字 ID 排序，依次编号 `组.1`、`组.2`…，写入映射 旧 ID → 新 ID，组的 `nextChild` 设为子任务数 + 1。
3. 所有任务的 `blockedBy` 按映射替换（组 ID 不变）。
4. `nextId` 保持原值（大于所有组 ID，仍满足校验），version 设为 3，然后继续执行现有 `Value.Check` 与 `validateHierarchy`。

转换只发生在内存读取；下一次修改提交时写入 version 3 文件。job、agent、调度历史中旧的纯数字 taskId 不改写，仅作为历史文本保留。

#### 查询与分页

- `src/tasks/tools.ts` task_list 的分页键改为 `${组ID 补零16}:${子序号 补零16}`，组行子序号为 0。
- `Dock` 中组排序 `Number(a.id) - Number(b.id)` 只比较组 ID，保持不变。

#### 去掉 `#`

模型可见文本与界面统一使用不带 `#` 的 ID：

- `src/tasks/query.ts`：`taskLabel`、`taskDetails`（`parent 1`、`blockedBy: 1.2, 2.1`、`blocks: …`）、NOT_FOUND 文本。
- `src/tasks/presentation.ts`：`receiptLine`、`editLines`、`derivedDisplay`、`receiptDisplay`。
- `src/tasks/tools.ts`：task_list 页头 `group 1`；`queryHint` 示例改为 `task_get({"id":"1.2"})`。`src/tasks/schema.ts` 的 hint 改为 `task_edit({"op":"done","id":"1.2"})`、`{"op":"start","id":"1.3"}`。task_edit 描述说明子任务 ID 形如 `1.2`、移动需删除后新增。
- `src/tasks/store.ts` link、`src/tasks/index.ts` executionTask、`src/agents/manager.ts`、`src/agents/tools.ts`、`src/jobs/tools.ts` 中的 `task #${id}` / `execution task #${id}`。
- `src/tasks/viewer.ts` Group 控件标签与搜索字符串。
- 不涉及：workflow 的 `#${row.index}`、jobs 监视事件的 `#${eventId}`，它们不是任务 ID。

### 2. 统一行格式与颜色

`presentation.ts` 只保留一组行构造函数，Dock、工具结果、/tasks 共用：

- `taskIcon(status)`：返回下表图标。
- `taskRow(task, theme?)`：返回 `<图标> <ID> <标题>`，子任务前加两个空格缩进，并按状态整行着色。
- `taskStyle(task, text, theme?)`：保留，供 BrowserView 截断后着色。

```text
⟳ 1 登录流程优化                 1/3
  ☑ 1.1 检查请求链路
  ⟳ 1.2 修复状态同步
  ⚠ 1.3 回归验证
☐ 2 发布准备                     0/2
  ☐ 2.1 更新版本号
```

| 状态 | 图标 | 样式 |
| --- | --- | --- |
| todo | `☐` | 默认前景色，不调用 `theme.fg` |
| doing | `⟳` | accent |
| blocked | `⚠` | warning |
| done | `☑` | dim，标题加删除线 |

- 组行颜色按派生状态；组行右侧 suffix 只保留 `完成数/总数`，子任务行不再有 suffix。
- 四个图标的 East Asian Width 均为 N（单列宽），替换当前宽度为 A 的 `·`，避免中文终端错位。
- “已完成 N 组”汇总行为 dim。

### 3. Dock 当前子任务与紧凑两行

#### 当前子任务

`src/tasks/model.ts` 新增 `currentChild(group, views)`，按以下顺序选择该组一个子任务：

1. doing 中 `updatedAt` 最新的一项；
2. 第一个 blocked 项；
3. 第一个 todo 项；
4. 全部完成或空组时为空。

#### 非紧凑（`TasksModule.rows(false)`）

- 每个显示的组总是附带当前子任务，另附其他 doing、blocked、处于 5 秒完成反馈中的子任务。
- 子任务行 `parentId` 指向组行，priority 为组 priority + 0.5；Dock 现有父子预留逻辑保证子任务与父行一起显示或一起隐藏。
- 组优先级规则（选中 > doing > blocked > 完成反馈 > 普通，同类按最近更新）不变。

#### 紧凑（`TasksModule.rows(true)`，询问打开时）

- 存在未完成组：返回优先级最高的未完成组行与其当前子任务行，共 2 行。组行 suffix 为 `完成数/总数`，还有其他未完成组时追加 ` · +N 组`。组内没有子任务时只返回组行。
- 全部完成：返回 1 行 dim 的 `☑ 已完成 N 组`。
- 删除原 `tasks:summary` 行及其 `⟳ N · ⚠ N` 汇总。

#### Dock 分配（`src/ui/dock.ts`）

- `dockAllowance` 询问期间由 `Number(budget > 1 && 有紧凑行)` 改为：`budget > 1` 时取各来源紧凑行数的最大值并封顶 2，否则为 0。
- `askBudget` 保持 `Math.max(1, budget - allowance)`，询问至少 1 行。
- 终端少于 28 行且 footer 占用状态行时，budget 为 2，此时 Suite 实际占用 3 行（Dock 2 + 询问 1），比共享预算多 1 行；该超出为满足“至少两行”的明确取舍，写入 current 文档。
- 其他模块（goal/jobs/agents 设为 dock 显示时）也提供紧凑行时，仍按共享 priority 在 2 行内分配。

### 4. 工具调用紧凑显示

工具结果正文（模型可见内容）只去掉 `#` 并使用新 ID，结构不变；以下只改 renderer。所有 renderer 的失败结果保持显示完整错误正文。

展开方式沿用 Pi 1.5.0 宿主能力，renderer 只按 `options.expanded` 输出折叠或展开内容，不自行注册按键或鼠标处理：

- 鼠标左键点击某个工具结果：只切换该工具。宿主 `ToolExecutionComponent.createResultRegion` 用 MouseRegion 包裹 renderResult 返回的组件，`renderShell: 'self'` 同样生效。
- 快捷键 `app.tools.expand`（默认 ctrl+o，可在 keybindings 中修改）：切换全部工具输出（`toggleToolOutputExpansion`）。
- 折叠行不追加 `(ctrl+o to expand)` 提示，保持一行；如后续需要提示，使用渲染上下文提供的 `keyHint`，不写死按键文本。

#### task_edit

- renderCall：调用中显示 `正在更新任务…`，完成后为空（现状不变）。
- 折叠结果固定为一行，按以下顺序判断：
  1. 只有 1 个回执：`<图标> <ID> <标题> · <动作>`，按该任务状态着色；block 带原因时追加 `：原因`。示例 `☑ 1.2 写测试 · 已完成`。
  2. 多个回执：按动作分组计数，组与子任务分开计，格式 `任务 · <动作> [g 组] [c 项] · …`。示例：创建一组四个子任务为 `任务 · 已创建 1 组 4 项`；级联删除为 `任务 · 已删除 1 组 3 项`；混合批次为 `任务 · 已完成 1 项 · 已开始 1 项 · 已更新 2 项`。
  3. 依赖派生变化追加 ` · 依赖变化 N`；警告追加 warning 色 ` · ⚠ N`。
- 动作名沿用 `receiptDisplay` 的判定：已创建、已删除、未变化、已开始、已完成、已阻塞、待处理、已更新。
- 展开（点击该结果或 `app.tools.expand`）：每个回执一行（行首图标）、派生变化行、变更字段、组进度与警告全文。

#### task_list

- 折叠结果一行：`任务 · <筛选> · g 组 c 项 · 进行中 a · 阻塞 b · 完成 d`，有下一页时追加 ` · 有下一页`。计数基于本页返回的行。
- 展开：两级行（第 2 节格式），组行带进度，末尾保留下一页提示。

#### task_get

- 新增 renderCall（调用中显示 `Task`，完成后为空）与 renderResult、`renderShell: 'self'`。
- 折叠结果一行：第 2 节的任务行，组带 `完成数/总数`。
- 展开：`taskDetails` 全部行。

### 5. `/tasks`

- 命令改为 `/tasks [组 ID]`，删除 `all` 参数；参数非组 ID 时提示 `Use /tasks [group ID]`。
- TaskBrowserView 默认 State 为 All，展示所有组和子任务，已完成项按第 2 节灰色删除线显示；State 控件仍可切换为 Unfinished、Running、Blocked、Completed。
- 列表行改用 `taskRow`：图标在行首，组的 description 只保留进度。
- 非 TUI 模式通知同样输出全部状态。

### 6. 提醒

`registerReminders` 回显仍为最多 10 个未完成项，使用去掉 `#` 的 `taskLabel`，不改变间隔与触发规则。

## 实施步骤

- [ ] 1. types/schema：三个 ID schema、version 3、`nextChild`、删除 update.parentId；jobs/agents/schedules 改用共享 schema。
- [ ] 2. model/store：两级 ID 分配、`validateHierarchy`、version 2 转换、`currentChild`、删除移动逻辑，错误文本去 `#`。
- [ ] 3. presentation/query：`taskRow`、新图标与配色、所有文本去 `#`。
- [ ] 4. Dock 与 `TasksModule.rows`：当前子任务附带、紧凑两行、`dockAllowance` 封顶 2。
- [ ] 5. tools：task_edit/task_list 一行折叠、task_get 新 renderer、分页键、hint 与描述。
- [ ] 6. viewer/命令：默认 All、`/tasks [组 ID]`、行首图标。
- [ ] 7. 测试：按下节修改既有用例并运行全量检查。
- [ ] 8. 实际 Pi CLI PTY 验收后更新 current 文档与上游登记，移到 doc/finished。

## 测试调整

只修改既有用例中被新契约改变的断言，并补充两项明确风险：

| 文件 | 调整 |
| --- | --- |
| `tests/tasks/model.test.ts` | ID 断言改为 `['1','1.1','1.2','2']` 等；删除跨组移动用例，改为断言 update 携带 parentId 被 `changeSchema` 拒绝；“IDs are never reused” 改为删除 `1.2` 后新增得到 `1.3`、新组得到下一组号 |
| `tests/tasks/store.test.ts` | version 2 → 3；并发写入计数改为 `nextId` 等于组数 + 1；新增 1 项 version 2 文件转换：子任务重编号、跨组 blockedBy 映射、`nextChild` 正确，且转换后可继续编辑 |
| `tests/tasks/protocol.test.ts` | ID 改为两级；第 63 行跨组移动改为在新组新增子任务并设置 `blockedBy: ['1.1']`，保留跨组依赖派生断言；`/done #2/`、`/unchanged #2/` 改为不带 `#` |
| `tests/tasks/ui.test.ts` | 匹配 `1.2 ` 等新行格式；紧凑断言改为询问期间渲染 2 行，第一行为组、第二行为其当前子任务；删除旧 summary suffix 断言 |
| `tests/tasks/host.test.ts`、`tests/tasks/agents.test.ts`、`tests/agents/runtime.test.ts`、`tests/agents/stop-races.test.ts`、`tests/runtime/footer.test.ts` | 子任务 ID `'2'`/`'3'` 改为 `'1.1'`/`'1.2'`；`#1 work` 等正则去 `#`；version 断言改为 3 |

## 验收

- [ ] 全量测试与类型检查通过，日常耗时仍在 5 分钟内。
- [ ] 实际 Pi CLI PTY 在 40/60/120 列：行首图标、无 `#`、`1.1` 编号、待办为默认色、完成为灰色删除线。
- [ ] 打开询问时 Dock 显示父任务与当前子任务两行，询问输入仍可用；24 行终端核对总高度。
- [ ] task_edit 创建、单项完成、混合批次各显示一行；点击单个结果只展开该项，ctrl+o 切换全部，展开后明细完整；失败显示完整错误。task_list、task_get 折叠为一行。
- [ ] `/tasks` 默认可见已完成项，State 筛选正常。
- [ ] 使用一份 version 2 任务文件启动会话，清单转换后显示与编辑正常。

## 完成后需更新的文档

- `doc/current/tasks/index.md`：ID 规则（组递增、子任务 `组.序号`、不复用）、删除“移动至另一父级”、task_edit 参数说明。
- `doc/current/tasks/operations.md`：`/tasks [组 ID]` 与默认 All、行格式与配色、当前子任务与紧凑两行、工具一行摘要。
- `doc/current/tasks/storage.md`：version 3、`nextChild`、version 2 转换。
- `doc/current/runtime/tools.md`：对象 ID 行中 task ID 的格式。
- `doc/current/jobs/index.md`：job_start.taskId 为子任务 ID `1.2` 形式。
- `doc/current/validation.md`：tasks 段落的检查范围。
- `third-party/UPSTREAM.md`：`src/tasks/model.ts`、`types.ts` 行的改造说明。

[返回 Pi Suite 待办](index.md)
