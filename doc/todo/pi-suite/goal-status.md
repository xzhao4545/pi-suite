# goal 状态栏联动

目标：在 Pi 原生状态栏或 pi-starship 中显示准确、简短的 goal 状态，减少常驻面板占用。

当前状态：摘要发布、配置、会话归属与完成反馈已实现；Pi 1.5.0 原生 footer 及 @narumitw/pi-starship 0.65.2 实际 extension_status 模块通过离线检查。完整发布入口与真实 goal/tasks/child/jobs/ask 并存通过 Linux SDK 三尺寸检查，见 [footer 联动阶段](../../finished/pi-suite/footer-integration.md)；Windows、真实手机 SSH 与用户实际 footer 配置仍待验收，目标基础记录见 [已完成阶段](../../finished/pi-suite/goal-core.md)。

影响范围：goal 状态投影、当前会话绑定、ui 显示配置及外部 footer 互操作。

约束：目标与调度状态是唯一数据来源；复用 Pi 公共接口，不替换其他扩展的 footer，不增加模型调用或多语言支持。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [x] 根据目标与调度状态生成单条简短摘要
- [x] 复用 setStatus 的 goal 键并在变化时更新或清除
- [x] 实现 status/dock/hidden 显示配置与重复显示控制
- [x] 验证会话切换、reload 和完成反馈不会串用旧 goal 状态
- [x] 在原生 footer、完整 pi-starship 发布入口及 40×24、60×30、120×40 尺寸下核对可见性、占用、数量限制与显式 Dock 显示（Linux SDK）
- [ ] 在 Windows 和真实手机 SSH 核对用户实际 footer 配置、终端缩放与输入布局

## 验收方式

验证运行、待答、等待后台任务、宿主重试/压缩、Esc 待继续、显式暂停、最终请求失败、完成和预算耗尽的显示；无 goal、切换会话和旧绑定撤销时清除旧状态。原生 footer 与包含 extension_status 的 Starship 布局分别验收；窄屏、模块缺失、数量上限与自动换行需明确其实际边界。

## 关联计划

- [目标状态与续跑](goal.md)
- [统一面板布局](ui.md)
- [上游基线](upstream-baseline.md)
- [公共状态发布与活动数量](status.md)

## 接入接口与职责

Pi 提供 `ctx.ui.setStatus(key, text)`，状态由 footer 的 `getExtensionStatuses()` 读取；设为 undefined 可清除，更新会请求 TUI 刷新。原版 pi-goal 已使用稳定键 `goal`，本包继续使用此键，便于复用用户现有的 Starship 图标与样式配置。加载本包 goal 时应移除原版 pi-goal，避免两个提供者写同一状态。本包 goal 模块关闭时，StatusPublisher 不写入或清除 goal 键，绑定、new/resume/fork/tree、reload 和 quit 保留其他 provider 的状态；ownership 依据本次激活实际创建的 GoalManager，模块开关变更需 reload 生效。

```ts
ctx.ui.setStatus("goal", "goal 待答");
ctx.ui.setStatus("goal", undefined); // 当前会话没有 goal 时清除
```

以上为已实现的状态接口示例。goal 状态展示通过 setStatus 发布一条纯文本摘要；pi-starship 0.65.2 固定在开发依赖用于加载实际发布入口验收，其完整 MIT 版权保留在安装包中。本包发布运行不主动设置外部 footer，状态展示不注册额外模型工具或轮询状态栏。状态栏只负责呈现；隐藏、换主题或切换 footer 不改变 goal 的状态、预算和续跑逻辑。

摘要由既有目标状态与调度状态派生，不另存一份“状态栏状态”。目标更新、调度进入/退出等待、宿主恢复和绑定恢复时重新计算；文本不变时不重复发送。每个 token 不触发新的状态写入，预算摘要只在既有用量结算时更新。

## 状态映射

先判断目标是否有终态或显式暂停，再判断 active 目标的调度状态。显示等待状态不等于暂停目标。

| 目标与调度状态 | 默认摘要 | 含义 |
| --- | --- | --- |
| active + running | goal 运行 | 模型正在推进目标 |
| active + waiting_user | goal 待答 | 等待用户回答，不空转模型 |
| active + waiting_jobs | goal 待任务 | 等待后台任务结果 |
| active + waiting_host | goal 宿主恢复 | 等待宿主重试、压缩或恢复；已知阶段时可显示“goal 重试中”或“goal 压缩中” |
| active + idle，尚无继续排队，包括 Esc 后 | goal 待继续 | 保留目标，等待输入或继续操作 |
| active + idle，已有一次继续排队 | goal 待运行 | 等待统一调度器启动已排队的工作 |
| paused | goal 暂停 | 用户明确暂停目标 |
| failed | goal 请求失败 | 宿主恢复结束后仍有最终模型请求错误 |
| completed | goal 完成 | 目标已通过完成判定 |
| 用户配置的预算限制状态 | goal 预算耗尽 | 已达到明确启用的预算限制 |
| 无 goal 或非当前会话 detached | 不显示 | 清除当前发布槽位，不抹除持久目标 |

状态映射必须沿用 [goal 生命周期规则](goal.md)：不能只因 agent_end 出现 aborted 就显示暂停或失败。工具执行错误不直接等同于最终模型请求失败。预算耗尽只用于已配置限制达到上限，不能因为预算偏高或任务暂时阻塞而自行中断。

默认仅展示状态，不放长目标标题、等待原因或错误正文。需要预算摘要时可把已配置 token 预算的短用量附在末尾，例如 `goal 运行 12k/80k`，让裁剪优先影响用量；外部 footer 的剩余列宽无法可靠读取，因此第一版默认不附用量。任务完成数仍属于任务面板，不能作为 goal 验收百分比。

失败、暂停和预算耗尽保持可见，直到用户修改或清除对应目标。完成反馈短暂保留后清除；定时回调校验会话绑定代次与 goal ID，避免旧目标的完成定时器清除新目标状态。

## pi-starship 配置与边界

@narumitw/pi-starship 0.65.2 已有 `$extension_status` 模块，可读取原始 `goal` 键。无需为这次联动 fork pi-starship 或引入专用 `$goal` 模块。应在用户现有 format 的适当位置加入 `$extension_status`；不是所有预设都包含它，例如 minimal 预设没有。

以下是最小布局示例，不代表覆盖用户的完整配置：

```toml
format = "$model$thinking$context $extension_status"

[extension_status]
format = "[$statuses]($style)"
disabled = false
icons = { goal = "" }
styles = { goal = "fg:pi:accent" }
```

配置来源是 `<getAgentDir()>/pi-starship.toml`；手动编辑后可通过 reload 加载。示例关闭 goal 的默认扩展图标，避免手机字体差异占用额外空间；状态含有“goal”文字，不依赖图标识别。

Starship 的 max_statuses 按扩展状态插入顺序截取；Linux 完整发布入口检查确认 max_statuses=1 时较早的第三方状态可排挤 goal/runtime。数量上限过小、extension_status 被禁用或根 format 未引用模块时，goal 可能不可见。样式按状态键匹配，实际 emoji 与 24 位颜色可呈现；上述配置只设置 goal 的统一样式，不承诺运行、等待、失败会自动变色。

Starship 对整个格式化结果自动换行；把 goal 放进已有一行不保证 footer 总高度仍为一行。手机布局需要同时精简其他模块、选择模块位置并实际缩放核对。本包发布短摘要，不能单方面裁剪第三方 footer 的整体内容。

## 显示配置与统一预算

沿用本包用户级默认、项目级覆盖的配置优先级，增加 `goal.display`：

| 值 | 行为 |
| --- | --- |
| status，默认 | 发布 goal 状态栏摘要，dock 不重复显示 |
| dock | 清除本包发布的 goal 状态，改由统一 dock 分配一条摘要 |
| hidden | 清除本包发布的 goal 状态并隐藏常驻摘要，目标仍正常运行 |

Pi 公共接口没有可靠的“第三方 footer 已实际显示这个键”反馈，因此不猜测已安装扩展或自动在 status/dock 之间反复切换。使用不展示扩展状态的 footer 时，用户可以调整其配置或明确选择 dock。

Pi 原生 footer 具有两条基础行，在存在扩展状态时增加一条状态行；ui.maxRows 在本包预算内扣除这条额外状态行，Dock 预算可以为 0。询问至少保留一条可用回答行，ui.maxRows=1 且 footer 占用预算时允许这一交互例外。Starship 的额外换行和其他扩展占用属于外部布局边界，公共接口没有可靠的总高度反馈，不能承诺任意用户 format 都满足聊天高度比例。

完整目标、用量、等待原因和错误正文仍通过 goal 详情入口查看。status 模式下打开详情不再额外建立一份常驻摘要，关闭详情恢复原布局。

只发布当前绑定主会话的 goal。查看 subagent transcript 不实际切换主会话，因此不会把主 goal 状态替换为 child 的 goal；恢复其他主会话时按其目标重建摘要，旧绑定不得继续写入或清除新会话状态。

subagent 和 job 的活动数量另由同一个共享发布入口合成 pi-suite:runtime 状态槽位，不拼进 goal 的生命周期状态，也不由各模块重复写入。数量口径、显示配置和零数量隐藏见 [公共状态栏摘要](status.md)。
