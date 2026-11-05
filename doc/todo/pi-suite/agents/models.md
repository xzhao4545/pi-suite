# subagent 模型与 thinking 配置

目标：在 TUI 内配置 subagent 的模型和 thinking，从已配置认证的模型中直接选择，修改立即生效，不需要编辑文件或 /reload。

当前状态：共享 agents.types 配置、逐字段写回、类型选择界面、单 agent 下一请求修改与持久恢复、模型来源和认证错误已接入；5 项 Linux 契约检查覆盖实际 SDK 请求与原生选择组件，见 [模型配置基础阶段](../../../finished/pi-suite/agents/models-core.md)。Windows 与后续调度/workflow/@handle 入口的综合验收待完成。需求与取舍已由用户确认。

影响范围：/agents 菜单、subagent 查看器与列表、共享配置加载与写入、AgentManager 启动参数解析、agent 记录与 agent_list 详情。

约束：可选模型来自 Pi 的 modelRegistry.getAvailable()；配置写入 pi-suite.json，不修改 agent 的 .md 文件；类型配置只影响之后启动的执行；配置的模型不可用时明确报错，不静默换成其他模型。

相关当前文档：[公共运行时与配置](../../../current/runtime/index.md)。

## 任务列表

- [x] 共享配置增加 agents.types 节，支持界面写回并保留其他字段
- [x] /agents 中按类型选择模型与 thinking，写入后立即更新内存配置
- [x] subagent 查看器与列表中修改单个 subagent 的模型与 thinking
- [x] 启动时按优先级解析模型与 thinking，记录实际值及来源
- [x] 配置的模型不可用时报错并指出配置来源
- [x] 同步操作说明与 doc/current 配置文档
- [ ] Windows 核对 40/120 列的原生选择与类型写回、运行中修改、恢复；后续调度/workflow/@handle 入口接入时复核同一解析路径

## 验收方式

用离线 faux provider 注册多个已认证模型：按类型配置后新启动的 subagent 使用新模型与 thinking，配置前已在运行的同类型 subagent 不变，且无需 /reload；单个运行中 subagent 修改后从下一次模型请求起使用新值，当前请求不中断，其他 subagent 不受影响；agent_start 传入 model/thinking 时覆盖类型配置；类型配置覆盖 frontmatter；未认证模型不出现在列表；配置的模型失去认证后启动报错并指出来源。两平台分别核对选择界面在 40 列与 120 列下可用。

## 关联计划

- [扩展能力：自定义类型与 frontmatter](extensions.md)
- [运行记录与手动控制](runs.md)
- [原生会话查看](viewer.md)
- [统一工具设计](../tool-design.md)

## 入口

| 入口 | 操作 | 影响 |
| --- | --- | --- |
| /agents → 选择类型 → 模型与 thinking | 选择模型（或“不覆盖”），再选 thinking（或“不覆盖”） | 该类型之后启动的所有执行，包括恢复、调度触发、workflow 内的 child 与 @handle 启动 |
| subagent 查看器或 /agents 记录 → 选择某个 subagent → 模型与 thinking | 同上 | 只影响这个 subagent：运行中的从下一次模型请求起生效，已结束的影响之后的恢复执行；不写配置 |

模型列表为 modelRegistry.getAvailable() 返回的已配置认证的全部模型，与 Pi 的 /model 一致，不受 scoped models 范围限制。优先复用 Pi 导出的 ModelSelectorComponent 与 ThinkingSelectorComponent；Pi 1.5.0 的模型组件需要 ModelRuntime 且没有“不覆盖”选项，通用 ui.select 会换行并列出所有选项，因此扩展通过公共 ui.custom 复用 Pi 原生 SelectList 和主题，按高度分页并分离完整值与显示标签。thinking 选项按所选模型的能力列出，模型不支持 thinking 时只显示“不覆盖”与 off。窄屏下每行显示 provider/modelId，超出宽度截断。

## 实时应用

- 类型配置：写入文件后立即更新内存中的配置，下一次启动直接读取，不需要 /reload；已在运行与已排队的同类型执行保持启动时的模型与 thinking。会话绑定时重新读取配置文件，其他 Pi 进程或手动编辑的改动在此时生效。
- 单个 subagent：运行中时对其 child 会话调用 setModel 与 setThinkingLevel（仅限本会话，不写 Pi 全局默认），当前模型请求不中断，下一次请求使用新值；thinking 由 Pi 按模型能力收紧。修改记录在该 agent 的记录中，之后的恢复执行沿用；不改变类型配置与其他 agent。

## 优先级

启动时模型与 thinking 各自按以下顺序取第一个有值的来源：

1. agent_start 的 model / thinking 参数
2. TUI 类型配置（agents.types.<类型>）
3. agent 文件 frontmatter 的 model / thinking
4. agents.defaultModel（仅模型）
5. 父 agent 当前的模型与 thinking

单个 subagent 的修改在启动之后发生，覆盖其当时的值。之后恢复时，本次调用参数优先于记录中的单独修改，单独修改优先于类型配置；清除单独覆盖时，活动执行恢复启动参数与启动配置。已结束记录只更新之后恢复的 individual，不改写历史实际模型。这一顺序与上游 pi-subagents（frontmatter 优先于调用参数）不同，只适用于 model 与 thinking；max_turns、tools 等其他字段仍按 [扩展能力](extensions.md) 的 frontmatter 优先规则。agent_list(id) 与查看器显示实际模型、thinking 及其来源（参数、类型配置、frontmatter、默认、继承、单独修改）。

配置或参数指定的模型不在已认证列表中时，启动返回错误并指出来源（例如“agents.types.explore.model 指定的 anthropic/claude-haiku-4-5 未配置认证”），不按上游的容错逻辑换成同名的其他 provider 模型。模糊名（haiku、sonnet）仅用于 agent_start 参数与 frontmatter；界面写入的始终是精确的 provider/modelId。

## 存储

```json
{
  "agents": {
    "types": {
      "explore": { "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

默认写入用户级 `<agentDir>/pi-suite.json`；项目级 `.pi/pi-suite.json` 已为该类型设置对应字段时写入项目级文件，避免用户级的修改被项目覆盖而看似无效，界面标明写入位置。选择“不覆盖”删除该字段；删除项目字段可以露出用户级值，thinking 列表按删除后实际生效的模型提供。写入时读取最新文件内容，只改动目标字段，其他配置原样保留，文件按两空格缩进重新格式化；按 schema 校验后以临时文件加重命名替换各文件，无变化不写入。文件本身无效时拒绝写入并显示原因，不覆盖用户文件。

[返回子代理待办](index.md)
