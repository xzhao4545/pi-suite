# Dock 显示修正：Jobs 计时与任务组顺序

## 目标

- Dock 的 Jobs 行与 Agents 行一样，在活动期间按秒刷新运行时间。
- Dock 的 Tasks 分区按组 ID 固定显示顺序，焦点规则只决定预算不足时保留哪些行。
- 预算不足时每个组都优先保留未完成子任务，已完成子任务优先折叠。

同一规划中的 [Subagent 与 Workflow 执行 owner 跨加载替换](../finished/pi-suite/agents/execution-owner-reload.md) 已归档。

## Jobs Dock 运行时间刷新

### 现有根因

`src/jobs/index.ts` 的 `JobsModule.refresh()` 只在 JobManager 发出变化事件时重算 Dock 行；`elapsedMs` 在查询时计算（`src/jobs/manager.ts:78`）。输出增长不改变元数据、不触发刷新，Dock 行停留在启动时的 `0.0s`。Agents 在 `src/agents/index.ts` 有活动期间每秒刷新的展示计时器，Jobs 缺少同等机制；`/jobs` 浏览器自带每秒刷新，不受影响。

### 设计

- 新增 `src/ui/ticker.ts` 公共展示计时器：存在活动对象且详情可见时每秒触发，`unref`，隐藏、解绑或无活动对象时释放。Agents 替换现有私有 interval。
- `JobsModule.refresh()` 拆分为 Dock 行发布与通知处理；计时器只重新发布 Dock 行，读取内存元数据，不读历史文件、不投递通知、不写会话。

### 验收

- 活动 job 的 Dock 行运行时间每秒递增；job 结算后计时器释放。
- Agents 行为不变；typecheck 与 jobs/agents 相关测试通过。

## Tasks 分区任务组顺序

### 现有根因

`src/tasks/index.ts` 的 `rows()` 为可见组计算焦点等级（选中组 50、含 doing 40、含 blocked 38、其余 30，同级按最近更新、再按 ID），并按该排序输出行。`priority` 用于预算保留，显示顺序却也随之变化：任务状态改变后组的位置跳动，例如组 2 含 blocked 子任务时显示在组 1 之上。组内子任务始终按 ID 排序，不受影响。`doc/current/tasks/operations.md` 中"同级以最近变更和稳定 ID 排序"记录的是这一行为。

### 设计

- 保留焦点组与每行 `priority` 的现有计算，用于预算不足时的保留顺序和单行摘要的当前子任务。
- 输出顺序改为组 ID 升序，组内子任务 ID 升序。Dock 框架已区分保留优先级与来源顺序，折叠提示按行在原列表中的位置插入，不需要修改 `src/ui/dock.ts`。
- 已完成组折叠为尾线 `☑ N completed groups` 的规则不变。

### 验收

- 预算充足时组按 1、2、3 显示，任务状态变化不改变组的先后。
- 预算不足时焦点组及其 doing/blocked 子任务仍优先保留，被折叠的组在原位置显示 `↑/↓/↕ … N more groups`。
- tasks 相关测试通过；`doc/current/tasks/operations.md` 写明显示顺序固定，焦点规则只影响保留与摘要。

## Tasks 分区已完成子任务优先折叠

### 现有根因

`src/tasks/index.ts` 的 `rows()` 只为焦点组的子任务按状态区分保留优先级；非焦点组的全部子任务统一为 `组 priority - 1`，不区分状态。`src/ui/dock/rows.ts` 的 `dockWindow()` 按 priority 降序加入行，同值按原列表位置（稳定排序），因此非焦点组从序号最小的子任务开始保留。组 1 前六项已完成、1.7 未完成时，预算先被已完成项占用，1.7 被折叠。焦点组内，当前项之前的待办与较早完成项同为最低档，同样可能先于待办保留已完成项。

### 设计

- 所有组的子任务使用同一状态顺序：doing/blocked、当前子任务、其余待办（当前项之后的待办在前）、最近一个已完成项、其余已完成项。
- 组间顺序保持现有规则：焦点组整体优先，其余组按焦点等级与最近更新；状态加成不得使某组子任务越过更高等级组的行，单行摘要仍取焦点组的当前子任务。
- 只修改 `rows()` 的 priority 计算，不修改 `src/ui/dock/rows.ts`；被折叠的已完成项在原位置显示 `↑/↕ … N more items`。

### 验收

- 非焦点组已完成项在前、待办在后且预算不足时，显示待办并将已完成项折叠为 `↑ … N more items`。
- 焦点组内任何待办都先于已完成项保留；现有焦点组、单行摘要与选中保留行为不变。
- tasks 相关测试通过；`doc/current/tasks/operations.md` 的保留顺序说明同步。

## 运行时间单位规范化

### 现有根因

`src/ui/format.ts` 的 `elapsedText()` 只输出整秒，运行一小时显示为 `3600s`，长时间运行的 agent/job 不易阅读。

### 设计

- `elapsedText()` 按量级选择单位并向下取整，最多两段：小于 1 分钟 `45s`，小于 1 小时 `12m05s`，小于 1 天 `3h07m`，其余 `2d04h`。第二段补足两位，向下取整保证每秒刷新时数值只前进不回退。
- 调用方不变：Dock 的 Agents/Jobs 行、Runs 列表、job 查看器信息行与 Subagent 底部信息栏。模型工具正文与通知继续保留一位小数秒。
- workflow 进度的 `formatDuration`（上游导入，含毫秒档）不在本项范围内。

### 验收

- 边界值（59s、60s、3599s、3600s、86399s、86400s）输出符合上述格式。
- typecheck 与相关测试通过；`doc/current/ui/index.md` 的运行时间说明同步。

## Agents 行 token 数量紧凑显示

### 现有根因

Dock Agents 行（`src/agents/index.ts` 的 `rows()`）直接输出原始数字 `↑12000 ↓3400`，长任务可达六七位，挤占名称宽度。Subagent 底部信息栏（`src/ui/viewer/agent-information.ts`）已私有使用 `Intl.NumberFormat` compact，两处不一致。

### 设计

- 在 `src/ui/format.ts` 与 `elapsedText` 一起提供公共 `countText(n)`：小于 1000 原样，其后使用 `k`、`M`、`B`，最多一位小数并去掉末尾 `.0`，向下取整，例如 `999`、`1.2k`、`12k`、`3.4M`、`1B`。不使用 `Intl` 的 `K`/四舍五入结果，避免未达到的数量提前进位。
- Dock Agents 行与 Subagent 底部信息栏共用该函数。`agent_get` 详情、`usageText` 等模型正文保持精确数字。

### 验收

- 0、999、1000、1234】12000、999999、1000000、1250000000 输出符合上述格式。
- Dock 宽屏行显示 `↑12k ↓3.4k`；typecheck 与相关测试通过；`doc/current/ui/index.md` 同步。

## Tasks 分区按 OMP 方式折叠

### 现有问题

Tasks 分区展开所有可见组，再由 `src/ui/dock/rows.ts` 的 `dockWindow()` 按 priority 在高度预算内取行，缺口处插入 `↑/↓/↕ … N more items`。剩余预算会被任意一个已完成子任务填补，实际出现：

```text
├─ ☐ 1 重写 README 与 docs 中英文用户文档        6/7
│    ↑ … 2 more items
│    ☑ 1.3 写英文 README 与 docs/en
│    ↕ … 3 more items
│    ☐ 1.7 根据审查修改并交付
```

已完成项与折叠提示占用了三行，只传达了组标题右侧 `6/7` 已经表达的信息；预算较小时又可能整组只剩标题。

### 参考：OMP 的 todo HUD

来源 `can1357/oh-my-pi` 提交 `0ba99d7b351c25478859ace113b24b1aefec07e3`：`packages/coding-agent/src/ui/dock/todo.tsx`、`src/ui/styles/dock/todo.ts`、`src/tools/details/todo.ts` 的 `selectCollapsedTodos`。只参考交互规则，不导入源码。

- 只展开当前阶段（第一个有未完成任务的阶段）；其后最多 4 个阶段只显示标题和 `完成/总数`，其余合并为 `… N more stages`；之前已全部完成的阶段不显示。
- 展开阶段的子项：最近一个已完成项作为上下文放在最前（不计入上限），随后最多 5 个未完成项：先进行中项，再补第一个进行中项之后的待办。未显示的未完成项在末尾合并为一行 `… N more todos`；只缺一项时直接显示该项。更早的已完成项不显示、不计入折叠提示，由标题的完成数表达。
- 上限按项数固定，不随高度预算变化；终端低于 18 行时折叠为一行 `TODO 2/5 · ☐ 下一项`。

### 设计

- **展开组**：焦点组展开，沿用现有焦点规则（选中组 → doing → blocked → 最近更新）。其余未完成组按 ID 顺序只显示标题行与 `完成/总数`；焦点组之外最多显示 4 个组标题，其余合并为 `… N more groups`。已完成组继续从树中隐藏并计入尾线 `☑ N completed groups`。
- **展开组的子任务**：按 OMP 规则选取：最近一个已完成项，加最多 5 个未完成项（doing/blocked 优先，再补当前项之后的待办，不足时补前面的待办），按子任务 ID 顺序显示；未显示的未完成项在末尾显示 `… N more items`，只缺一项时直接显示。组内不再出现 `↑/↕` 位置提示。
- **Dock 选择**：↑↓ 在可见行间移动；选中某个组标题或子任务时该组作为焦点组展开，原焦点组收起为标题。Dock 目前不向来源传递选择，需要扩展 `DockSource.rows` 接收当前选中的行 ID（未激活时为 undefined），其他分区忽略该参数。窗口外的子任务通过 `/tasks` 查看；退出选择后恢复默认焦点。
- **高度预算**：上述窗口是 Tasks 分区提交给 Dock 的全部行；窗口仍超过预算时，由 Dock 按现有 priority 裁剪（保留焦点组与当前子任务），预算 1–3 行的单行摘要不变。
- **实现位置**：选取规则放在 `src/tasks/`（`rows()` 或独立的窗口函数），折叠行使用 Dock 已有的不可选中行（`selectable: false`），不修改 `src/ui/dock/rows.ts` 对其他分区的行为。

示例（焦点组为 2）：

```text
Tasks  8/13
├─ ☐ 1 重写 README 与 docs 中英文用户文档        6/7
├─ ⚠ 2 Dock 显示修正与 owner 替换 (Blocked)        2/3
│    ☑ 2.2 Dock 每秒刷新
│    ⚠ 2.3 Tasks 分区按组 ID 显示 (Blocked)
├─ ☐ 3 用户文档修正                                0/3
└─────
```

### 验收

- 焦点组只显示最近一个已完成项和最多 5 个未完成项；更早的已完成项不显示且没有折叠提示；超出的未完成项在末尾显示 `… N more items`，只缺一项时直接显示。
- 非焦点未完成组只显示标题；超过 4 个时显示 `… N more groups`；组按 ID 顺序。
- Dock 选择到其他组标题时该组展开；退出选择恢复默认焦点；单行摘要、完成反馈与尾线行为不变。
- typecheck 与 tasks/ui 相关测试通过；`doc/current/tasks/operations.md` 的常驻摘要一节与 `third-party/UPSTREAM.md` 的参考来源同步。

## 相关 current 文档

- [Pi 子代理执行与记录](../current/agents/runtime.md)
- [公共运行时](../current/runtime/index.md)
- [统一界面](../current/ui/index.md)
- [执行任务](../current/jobs/index.md)
- [任务操作与显示](../current/tasks/operations.md)

## 任务列表

- [x] 公共展示计时器，Agents 与 Jobs 接入
- [x] 更新 `doc/current` 的统一界面页面
- [x] typecheck、jobs/agents 相关测试
- [ ] 实际 Dock 验证（Jobs 计时、任务组顺序）
- [x] Tasks 分区按组 ID 输出，保留焦点优先级用于预算
- [x] 更新 `doc/current/tasks/operations.md`，tasks 相关测试通过
- [x] 运行时间显示改为整秒（Dock、Runs、job 查看器、Subagent 信息栏），模型正文保留一位小数
- [x] 所有组按状态保留子任务，已完成项优先折叠
- [x] 更新保留顺序说明，tasks 相关测试通过
- [x] 运行时间按 s/m/h/d 规范化显示
- [x] Agents token 数量按 k/M/B 紧凑显示
- [x] Tasks 分区按 OMP 方式折叠
- [x] Agents 行名称后括号显示模型 ID（去掉 provider 前缀）
