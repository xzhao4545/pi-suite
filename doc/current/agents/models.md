# 类型、模型与 thinking 配置

模型和 thinking 可以在两处配置：

| 入口 | 作用对象 | 生效时间 |
| --- | --- | --- |
| `/subagents types` 或 `/subagents` 的 Types 页，Enter 或 `c` | 类型默认值 | 之后新建的执行 |
| Runs 页或 Transcript 的 `c Model / thinking` | 所选 run 的 individual 覆盖 | 该 agent 的下一次请求 |

Read only 记录没有 `c`。每次修改先选模型，再选 thinking；任一步按 Esc 都取消整次修改。

## 解析与来源

模型和 thinking 各自取下表中第一个有值的来源（`resolveSettings`，`models.ts`）：

| 顺序 | 来源标记 | 模型 | thinking |
| --- | --- | --- | --- |
| 1 | parameter | 本次调用的 model | 本次调用的 thinking |
| 2 | individual | 该 agent 的 individual.model | individual.thinking |
| 3 | type | `agents.types.<类型>.model` | `agents.types.<类型>.thinking` |
| 4 | frontmatter | 类型文件的 model | 类型文件的 thinking |
| 5 | default | `agents.defaultModel` | — |
| 6 | inherited | 父会话当前模型 | 父会话当前 thinking，没有时为 off |

- individual 是启动后编辑的，可以覆盖当时的调用参数。之后恢复时显式传入的参数仍然优先。
- 调用参数和 frontmatter 可以写模糊名。先精确匹配 `provider/modelId`，或在不带 `/` 时匹配 model ID；没有精确匹配时才在 model ID 和显示名中做不区分大小写的子串匹配，且结果必须唯一。配置和界面写入的值只按精确身份匹配。
- 带 provider 前缀的名称只匹配该 provider，不会换成其他 provider 的同名模型。
- 显式模型不可用或匹配不唯一时报 MODEL_UNAVAILABLE，错误中给出来源字段，例如 `agents.types.Explore.model`。新执行和普通恢复在建立 run 和发送请求前就报错。修正方法：在类型或 individual 配置中选可用模型，或取消覆盖。
- 来源为 inherited 且父会话没有模型时，同样报 MODEL_UNAVAILABLE。

agent_get 详情与记录操作界面显示实际模型、thinking 和来源标记。

## 模型选择器

- 候选来自 Pi 的 `modelRegistry.getAvailable()`，即全部已认证模型，不受父会话 scoped models 限制，按 `provider/modelId` 排序。第一项是 No override。认证变化后列表只含当前可用的模型。
- 选择器（`src/ui/select.ts`）复用 Pi 原生 Input、fuzzyFilter 与 SelectList。每行显示 `provider/modelId` 和模型显示名。
- 直接输入文字按 provider、model ID 和显示名模糊过滤；No override 也参与过滤。Backspace 删除输入；无匹配时显示 `No matching items`。
- ↑↓、PageUp/PageDown 移动，Enter 提交，Esc 取消，按键遵循宿主注入的 keybindings。长行按可见宽度截断。resize 后保留查询和选中项；过滤输入时原生光标跟随焦点。
- thinking 候选是 No override 加 pi-ai `getSupportedThinkingLevels` 对实际模型给出的级别；非推理模型只有 No override 与 off。

## Types 页

类型列表包含当前信任与包门控范围内的全部类型：内置、包、项目和用户定义，包括 disabled 类型。

每个类型按默认启动设置（无调用参数、无 individual 覆盖）解析：

- 列表每行显示类型名、启用状态（● 启用、○ 禁用）、模型和 thinking。宽度小于 48 列且两个字段都未配置时，合并显示为 `M/H not configured`。
- 来源为 inherited 的字段显示 `not configured`，不显示父会话当前的模型。详情的 Model 字段注明 `inherit from parent at start`，Thinking 字段注明 `inherit from parent at start, adjusted to model capabilities`。
- 已配置的 thinking 按模型能力收紧后显示（pi-ai `clampThinkingLevel`）。
- 详情显示完整的 `provider/modelId` 和每个字段的来源。模型不可用时显示 `unavailable` 和具体错误，仍然可以进入修改。
- 预览不创建 child 会话。

操作键：

| 键 | 操作 |
| --- | --- |
| Enter、`c` | Model / thinking：打开模型选择，返回后保留筛选、所选类型和阅读位置 |
| `d` | Enable 或 Disable，见 [类型启用状态](#类型启用状态) |
| `u` | Use definition，只在存在 enabled 配置时出现 |

## 类型配置与写入

类型覆盖保存在 `pi-suite.json` 的 `agents.types.<类型名>`，字段为 `enabled`、`model`、`thinking`。类型名使用 catalog 的规范名（精确大小写）。模型写入精确的 `provider/modelId`。不修改 agent Markdown 文件。

```json
{
  "agents": {
    "types": {
      "Explore": { "enabled": true, "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

加载时用户与项目配置逐类型、逐字段合并，项目字段优先。

写入（`src/runtime/config-edit.ts`、`config-fields.ts`）：

1. 每个字段单独确定写入层：项目 `.pi/pi-suite.json` 已有该字段时写项目，否则写用户 `<agentDir>/pi-suite.json`。界面在修改前提示 model 和 thinking 各自的写入文件。
2. No override 删除对应层的字段。删除项目字段后，用户层的值生效。模型选 No override 时，thinking 候选按删除后实际生效的模型给出。
3. 要删除的字段不存在时，该层不写入。
4. 写入任一层之前，先按共享 schema 校验两层修改后的结果。
5. 每层在文件锁内重新读取、修改、再次校验，然后写临时文件并 rename 替换。
6. 现有配置文件无效时拒绝写入并报错。

两个字段写在不同文件时，一个文件写入失败不撤销另一个；无论成败都会重新加载配置。

### 生效时机

- 保存后立即重新加载共享内存配置，并刷新 `@类型` 补全和 workflow 工具中的类型说明，无需 /reload。会话重新绑定时也会重新读取配置，所以外部修改同样生效。
- 新执行和普通会话恢复读取当前配置。已经启动的执行保留启动时解析的类型、模型与 thinking。普通 child 的配置读取时间见 [执行与记录](runtime.md)。
- 调度：登记时保存显式启动参数；每次触发都是新执行，读取当前类型配置，显式 model/thinking 仍优先。
- workflow：新 child 读取当前类型配置，显式 model/effort 优先。workflow 的固定 child resume 沿用原 run 的类型、模型、thinking 与结构化 schema。
- `@类型`：会话克隆使用父模型整理任务，实际 child 经普通启动入口解析类型配置。
- `@handle`：对活动执行发送引导；对已结束记录恢复执行，按上表解析，individual 优先于类型配置。内存中的 `Execution`（单次 run 的运行对象）被回收后，从持久记录恢复也按同一顺序，不改写历史记录中的实际模型。

## 类型启用状态

启用状态按以下顺序取第一个有值的来源：项目配置、用户配置、frontmatter 的 enabled、默认 true。

| 操作 | 写入 |
| --- | --- |
| Enable / Disable | enabled。项目已有该字段时写项目，否则写用户 |
| Use definition | 删除用户和项目两层的 enabled，回到 frontmatter 或默认值；不改 model/thinking |

- 所有新执行都由 catalog 检查启用状态：普通启动、普通会话恢复、嵌套、调度、workflow 新 child 和 RPC。类型被禁用时报 AGENT_TYPE。
- 已经启动的执行继续运行；workflow 的固定 child resume 沿用原 run。
- 禁用类型仍留在 Types 页，可以重新启用。已有 agent 的 handle、历史记录和阅读入口不受影响；对话内容能读多久见 [回收规则](runtime.md#执行引用回收)。

## 单个 agent

- 覆盖保存在该 run 的 `pi-suite:agent-record` 的 `individual` 字段。
- 选择模型时立即校验，不可用的模型在编辑时就报错，空闲 agent 也一样。
- 活动执行：通过 child 的 `setModel(..., {persist:false})` 和 `setThinkingLevel(..., {persist:false})` 修改，从下一次请求生效，当前请求不中断。不修改主会话、其他 agent 或 Pi 的全局默认。尚未建立 child 会话的执行在第一次请求前应用；thinking 由 Pi 按实际模型能力收紧。
- 取消 individual 覆盖时，活动执行回到启动时的调用参数和启动时的配置，启动后的类型修改不会进入该执行。
- 已结束记录保留该次运行的实际模型与 thinking，编辑只改变之后恢复时使用的覆盖。
- 查看器把所选 runId 带到写入为止。选择期间 agent 恢复成新 run 时，修改仍然写入打开时的 run。
- 查看器打开选择器前关闭当前 custom UI，返回后保留原生 transcript 的滚动、搜索和展开状态。所选 run 的 retain 引用保持到退出阅读，覆盖详情、输入和模型选择的整个往返。
- 当前 owner 和分支可见的结束记录可以编辑 individual。workspace 发现的其他 owner 的记录、或当前分支之外的已结算记录只能阅读。历史合并不会让较早保存的记录覆盖本地编辑，见 [持久历史](history.md)。

## 模型运行时桥接

child 与父会话共用同一个模型运行时（Provider、认证和路由状态），由 `models.ts` 的 `parentModelRuntime` 取得：

1. 读取父 `ctx.modelRegistry.runtime`。Pi 1.5.0 把该字段声明为 private，这个依赖不属于公开 ModelRegistry SDK 契约。
2. 检查它有 `getModel`、`streamSimple`、`resolveModel` 三个方法。按方法结构判断，不用 instanceof，因为 CLI bundle 与 SDK 模块的类身份可能不同。
3. 把同一个 runtime 传给 `createAgentSession`。

字段或方法不存在时报 MODEL_RUNTIME_UNAVAILABLE，不另建独立 runtime；否则 `createAgentSession` 会静默创建新的 runtime。

检查位置：

| 位置 | 时机 |
| --- | --- |
| `AgentManager.start`（`manager.ts`） | 任务 I/O 和分配 run 之前 |
| `runner.ts` | 加载资源和启动 SDK 会话之前，针对启动时捕获的父 registry；reload 后仍保留的排队执行也会检查 |
| `mentions/clone.ts` | `@类型` 克隆的异步准备之前，同时捕获父 runtime |

桥接不向 `Execution` 增加持久字段。

共享 runtime 意味着 child 只隔离模型和会话选择，Provider、认证和路由状态与父会话相同。Pi 升级可能改变私有字段及对象协议，支持的 Pi 版本与 peer 依赖都固定为 `1.5.0`；升级后需要重新核实兼容性。Provider、临时认证及虚拟路由的继承只在已验证范围内保证。

[返回 agents](index.md)
