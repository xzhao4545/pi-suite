# 模型与 thinking 配置

`/agents types` 或 `/agents` 的 Types · model / thinking 入口配置类型；记录菜单和 Transcript 的 Model / thinking 操作配置单个 agent。依次选择模型与 thinking，任一步 Esc 取消整次修改。

模型列表来自 Pi 的 `modelRegistry.getAvailable()`，包含全部已认证模型，不受父会话 scoped models 限制。共享选择器复用 Pi 原生 SelectList，显示 provider/modelId，长行按可见宽度截断，完整值保持独立；↑↓ 和 PageUp/PageDown 移动，Enter 提交。thinking 使用 pi-ai 的模型能力列表，非推理模型仅提供 No override 与 off。

## 类型配置与写入

类型覆盖保存在 `pi-suite.json` 的 `agents.types.<类型>.model/thinking`，模型写入精确的 provider/modelId，不修改 agent Markdown 文件。配置逐类型逐字段合并。

```json
{
  "agents": {
    "types": {
      "Explore": { "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

model 与 thinking 分别定位写入文件：项目 `.pi/pi-suite.json` 已设置该字段时修改项目，否则修改用户 `<agentDir>/pi-suite.json`。界面说明各字段的位置；保存前读取最新内容，保留其他配置，校验共享 schema，再以临时文件与 rename 替换各文件。无变化不写入，无效文件拒绝覆盖并报告错误。

No override 删除对应位置的字段；删除项目字段后，用户级对应值可以生效。模型选择的 No override 按删除后实际生效的模型提供 thinking 选项。

保存后立即更新共享内存配置，之后的新执行和恢复直接读取，无需 /reload。已开始与已排队的执行保留启动配置。会话重新绑定时读取外部修改的配置。

## 单个 agent

运行中通过 child 的 `setModel(..., {persist:false})` 与 `setThinkingLevel(..., {persist:false})` 修改下一次请求，当前请求不中断；不修改主会话、其他 agent 或 Pi 全局默认。尚未建立 child 会话的执行在第一请求前应用修改，thinking 由 Pi 按实际模型能力收紧。

覆盖保存在既有 `pi-suite:agent-record` 的 individual 字段。已结束记录保持该次运行的实际模型与 thinking，编辑只改变之后恢复使用的覆盖。取消单独覆盖时，活动执行恢复其启动参数与启动配置；查看器打开选择器前关闭当前 custom UI，返回后保留原生 transcript 的滚动、搜索和展开状态。

## 解析与来源

模型与 thinking 各自按本次调用参数、该 agent 的 individual、类型配置、frontmatter、agents.defaultModel（仅模型）、父级当前值依次取第一个有值的来源。单独编辑发生在启动之后，可覆盖当时的调用参数；下一次恢复显式传入参数仍优先。

agent_list 详情与记录操作界面显示实际模型、thinking 及来源：parameter、individual、type、frontmatter、default、inherited。显式模型不可用或匹配不唯一时报告来源与错误，不跨 provider 替换；调用参数和 frontmatter 可使用匹配唯一的模糊名，配置和界面存储使用精确身份。

[返回 agents](index.md)
