# 类型、模型与 thinking 配置

`/subagents types` 或 `/subagents` 的 Types 页面配置启用状态、模型与 thinking；运行记录和 Transcript 的 `c Model / thinking` 操作配置单个 run。Types 页 Enter 或 `c` 配置类型默认值，对之后新建的执行生效；Runs 页与 Transcript 的 `c` 修改所选 run 的覆盖，从它下一次请求生效，Read only 记录不提供。模型修改依次选择模型与 thinking，任一步 Esc 取消整次修改。

Types 按无调用参数、无 individual 覆盖的默认启动设置解析来源，已配置 thinking 使用 Pi 的模型能力约束。模型来源为 inherited 时，列表与详情显示 `not configured`，而不是父级主会话当前模型；详情说明运行时使用启动时父级会话的当前模型。thinking 来源为 inherited 时同样显示 `not configured`，执行启动时继承父级当前思考强度并按实际模型能力收紧。此展示不改变运行时解析顺序。列表显示类型、●/○ 启用状态、模型名称和 thinking；窄列表中两个字段均未配置时合并为 `M/H not configured`（model/thinking），避免重复标记挤掉类型名，详情仍分别列出两个字段及来源。右侧显示配置的完整 provider/modelId 及各字段来源；不可用模型在详情显示具体错误并允许进入修正，预览不创建 child 会话。Enter 或 `c` 直接打开模型选择，返回保留筛选、所选类型和阅读位置。

模型列表来自 Pi 的 `modelRegistry.getAvailable()`，包含全部已认证模型，不受父会话 scoped models 限制。共享选择器复用 Pi 原生 Input、fuzzyFilter 与 SelectList，显示 provider/modelId 和模型显示名；直接输入文字按 provider、model ID 与显示名模糊过滤，Backspace 清除输入，无匹配时显示 `No matching items`。No override 作为可搜索候选保留。长行按可见宽度截断，完整值保持独立；↑↓ 和 PageUp/PageDown 移动，Enter 提交，Esc 取消，按键遵循宿主注入的 keybindings；resize 保留查询与选中对象，过滤输入时焦点与原生光标保持一致。thinking 使用 pi-ai 的模型能力列表，非推理模型仅提供 No override 与 off。

## 类型配置与写入

类型覆盖保存在 `pi-suite.json` 的 `agents.types.<规范类型名>.enabled/model/thinking`，模型写入精确的 provider/modelId，不修改 agent Markdown 文件。配置逐类型逐字段合并，启用状态与模型/thinking 单独写入，互相保留。

```json
{
  "agents": {
    "types": {
      "Explore": { "enabled": true, "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

model 与 thinking 分别定位写入文件：项目 `.pi/pi-suite.json` 已设置该字段时修改项目，否则修改用户 `<agentDir>/pi-suite.json`。界面说明各字段的位置；保存前读取最新内容，保留其他配置，校验共享 schema，再以临时文件与 rename 替换各文件。无变化不写入，无效文件拒绝覆盖并报告错误。

No override 删除对应位置的字段；删除项目字段后，用户级对应值可以生效。模型选择的 No override 按删除后实际生效的模型提供 thinking 选项。

保存后立即更新共享内存配置，之后的新执行和普通会话恢复直接读取，无需 /reload。已准入执行保留当时解析的类型、模型与 thinking，workflow 固定 child resume 沿用原契约。普通 child 的操作配置在实际开始执行时读取，见 [执行与记录](runtime.md)。会话重新绑定时读取外部修改的配置。

调度登记保存显式启动参数，触发时的新执行读取当前类型配置；登记后的类型修改可以作用于未来触发，显式 model/thinking 仍优先。workflow 的新 child 同样读取当前类型配置，显式 model/effort 优先；已准入 child 的固定 resume 保持原模型、thinking、类型与结构化 schema。

`@类型` 的会话克隆使用父模型整理任务，实际 child 经普通启动入口解析类型配置；`@handle` 对活动执行发送引导，对已结束记录恢复执行时读取新类型配置，记录的 individual 优先于类型配置。回收内存 Execution 后的持久恢复使用同一优先级，不改写历史实际模型。

## 类型启用状态

类型列表包含当前信任与包门控范围内的内置、包、项目和用户定义的全部类型，包括 disabled 类型。底部 `d` 按启用状态执行 Enable 或 Disable，存在 enabled 配置覆盖时显示 `u Use definition`，并提供 `c Model / thinking`。Enable/Disable 写入 enabled：项目已经设置该字段时写项目配置，否则写用户配置；Use definition 删除用户和项目两层的 enabled，回到 frontmatter 的 enabled 或默认 true，不修改 model/thinking。

启用状态按项目配置、用户配置、frontmatter、默认 true 解析，配置键使用 catalog 的规范类型名。普通新执行、普通会话恢复、嵌套、调度、workflow 新 child 和 RPC 共用 catalog 准入；已准入执行继续运行，workflow 的固定 child resume 沿用其原契约。

保存后立即刷新当前 @类型 补全和 workflow 的动态类型说明，无需 /reload；禁用类型保留在类型菜单中，便于重新启用。禁用类型不删除已有 agent 的 handle、历史记录或阅读入口；对话内容的可读范围遵循 [回收规则](runtime.md#执行引用回收)。

## 单个 agent

运行中通过 child 的 `setModel(..., {persist:false})` 与 `setThinkingLevel(..., {persist:false})` 修改下一次请求，当前请求不中断；不修改主会话、其他 agent 或 Pi 全局默认。尚未建立 child 会话的执行在第一请求前应用修改，thinking 由 Pi 按实际模型能力收紧。

覆盖保存在既有 `pi-suite:agent-record` 的 individual 字段；查看器将选中 runId 贯穿选择与写入，即使选择期间 agent 恢复为新 run，也不会改写新 run。已结束记录保持该次运行的实际模型与 thinking，编辑只改变之后恢复使用的覆盖。取消单独覆盖时，活动执行恢复其启动参数与启动配置；查看器打开选择器前关闭当前 custom UI，返回后保留原生 transcript 的滚动、搜索和展开状态。所选 run 的 retain 引用覆盖整次详情、输入与模型选择往返，直到最终退出阅读后释放。

workspace 发现的其他 owner 或当前分支之外的已结算记录只提供阅读；当前 owner/分支可见的结束记录仍可编辑 individual。历史合并保留本地编辑的新事实，不让较早保存记录覆盖，见 [持久历史](history.md)。
## 解析与来源

模型与 thinking 各自按本次调用参数、该 agent 的 individual、类型配置、frontmatter、agents.defaultModel（仅模型）、父级当前值依次取第一个有值的来源。单独编辑发生在启动之后，可覆盖当时的调用参数；下一次恢复显式传入参数仍优先。

agent_get 详情与记录操作界面显示实际模型、thinking 及来源：parameter、individual、type、frontmatter、default、inherited。显式模型不可用或匹配不唯一时报告来源与错误，不跨 provider 替换；调用参数和 frontmatter 可使用匹配唯一的模糊名，配置和界面存储使用精确身份。

认证目录变化后，模型选择仅提供当前可用模型及 No override。新准入或普通恢复引用失去认证的显式配置时报告 MODEL_UNAVAILABLE 并指出对应字段，在建立新 run 与请求前拒绝；用户可通过类型或 individual 配置选择可用模型或取消覆盖。

## 模型运行时桥接

普通 child 启动及 `@类型` 的任务整理克隆通过类型强转读取父 `ctx.modelRegistry.runtime`，沿用同一模型运行时，而不自行重建另一份 Provider/认证/路由状态。读取位于 `src/agents/runner.ts` 与 `src/agents/mentions/clone.ts`。原版 Pi 1.5.0 将该字段声明为 private；它不是公开 SDK 契约，也不依赖将字段公开的宿主补丁。

这一桥接存在版本兼容风险，Pi 升级可能改变字段及对象协议；不能以模型名相同、宽泛 peer 版本或 patched SDK 通过推定官方入口兼容。它与单个 child 的模型/会话选择隔离是不同边界，不承诺完整 runtime 状态独立。Provider、临时认证及虚拟路由继承仅按实际验证范围声明。

[返回 agents](index.md)
