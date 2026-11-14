# UI 文案、Goal 状态与 Responses 跨资源恢复

## 状态、授权与目标

本专项方案已经用户确认，当前为待实施状态。本次授权范围仅为将修订后的详细方案写入 `doc/todo` 并更新索引，不修改运行时代码、用户配置或当前实现文档，不执行功能验收。本文件中的目标行为、字段名和模块拆分属于待实施设计，不代表已经落地。

五项原始需求分别为：

1. 排查 UI 中展示功能需求、内部设计说明的文本，提出并实施局部文案调整；需求与完整实现规则进入文档和必要注释。
2. `/goal resume` 默认仅显示一行恢复提示，更多信息由用户展开后查看。
3. 精简 Goal 状态及重复控制入口，降低用户理解成本。
4. 参考 `npm:pi-model-manager` 的 Responses 跨资源自动恢复，在 Suite 增加启用设置，并修复恢复请求遇到 429 等其他错误后过早结束恢复的问题。
5. 修复可恢复错误导致 Goal 提前停止，避免请求恢复成功后目标仍不能继续工作。

### 用户明确修订

- **保留包含 `control bridge v3` 的告警。** 这类诊断信息需要说明清楚，方便故障排查；不将它作为违规 UI 文案处理，不删除或泛化协议版本、真实故障原因和恢复条件。
- **`/goal pause` 与 `/goal stop` 不同时保留。** 两者当前均中止归属运行、保留目标并要求恢复，统一保留 `/goal pause`，删除 `/goal stop` 的命令分支、帮助和当前操作说明，不提供兼容别名或隐藏的第二入口。
- 其他已提出的方案方向接受，包括精确历史 ID 隔离、原生有限重试、最终结算协调和现有框架复用。

## 检查依据与现有根因

下列事实来自只读源码调查；未启动 TUI，未重放用户请求，不作为已通过运行验收的证据。行号为调查时定位，实施时以最新符号和代码为准。

| 位置 | 当前事实 | 修改方向 |
| --- | --- | --- |
| `src/runtime/settings/view.ts:49` | 两项设置描述混入 Ask 高度预算和跨模块高亮规则 | 在具体描述生成点局部收敛，不改变配置语义 |
| `src/goal/context.ts:6`、`src/runtime/notifications.ts:104-109` | Goal 续跑信号是模型控制文本，空闲投递使用可见自定义消息 | 展示与控制分离，通过原生 renderer 提供一行摘要和展开详情 |
| `src/goal/state.ts:7-24` | 七种持久状态、六种调度状态，另有自动许可、等待和恢复字段 | 三种持久生命周期，统一派生四种用户状态 |
| `src/goal/commands.ts:28-30,38-44` | 详情直接显示领域状态和调度状态；pause/stop 同时存在 | 展示状态与原因；仅保留 pause 控制入口 |
| `src/goal/manager.ts:247-250` | `agent_before_settle` 的 outcome 为 error 时无条件停止为 failed | 恢复先决策，最终失败在真正结算时确认 |
| `src/runtime/suite.ts:168-173` | 先 Goal 边界处理，再通知协调，settled 后清理并 flush | 统一恢复、Goal 与通知的优先级，防重复继续 |
| `src/agents/child.ts:23-29,58-70` | 子会话不加载主 Suite factory，拥有自己的生命周期和通知 | 主会话和 child 分别安装同一恢复能力、持有独立实例 |

### 参考实现与宿主能力

- 参考版本为 `pi-model-manager@0.4.6`，包许可证为 `AGPL-3.0-only`。公开来源：[npm 元数据](https://registry.npmjs.org/pi-model-manager/latest)、[恢复核心](https://cdn.jsdelivr.net/npm/pi-model-manager@0.4.6/openai-responses-recovery.ts)、[请求 pipeline](https://cdn.jsdelivr.net/npm/pi-model-manager@0.4.6/request-pipeline.ts)、[入口](https://cdn.jsdelivr.net/npm/pi-model-manager@0.4.6/index.ts)。实施前记录参考版本和许可证边界，不直接复制其源码或引入整个扩展作为依赖；通过公开协议与 Pi API 独立实现所需能力。
- 该参考实现按当前分支隔离失败请求携带的历史 item ID，移除相应 `input[].id`，保留正文、reasoning 密文和工具 `call_id`，并通过 context_edit 省略失败 assistant 的模型视图。
- 参考实现 `observeResult` 在下一次匹配的 `turn_end` 先清除 pendingRecovery；该次为任意 error 时即提示停止。这早于宿主对 429 的原生重试判断。它没有直接调用取消原生重试的函数，但恢复状态与提示会过早终结，随后成功不能正确结束原恢复阶段。
- Pi 1.5.0 提供 `before_provider_request` 替换最终 payload、`agent_before_settle` 返回 entries/continue、持久 context_edit、`agent_settled` 最终通知和自定义消息 renderer 的 expanded 选项。公开说明见 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，实现以项目实际固定版本为准，不以 main 文档替代版本验证。
- 本地宿主顺序为：message_end、turn_end、agent_end，随后原生瞬态重试/压缩/队列，再进入无原生后续工作的 agent_before_settle；提交边界修改后重建上下文并决定能否 continue，最终才 agent_settled。
- 用户错误说明历史状态项与当前 OpenAI resource 不匹配。资源切换、路由或同名 provider 配置改变是可能原因；未读取实际失败 payload，不能断言具体路由原因，也不能保证所有跨资源密文均可无损重放。

## 一、UI 文案收敛

### 判定边界

UI 展示用户当前需要操作、判断的状态、数据、权限和错误；完整功能要求、渲染预算、实现保证和模型控制规则放入文档与必要注释。不按字符串长度、英文术语或是否包含数字机械判断违规，不建立全局文案过滤器。

明确保留：快捷键、设置范围与来源、危险确认、历史只读权限、完整真实错误、协议版本告警、用户输入、日志、工具结果、模型专用 description/promptGuidelines，以及用户主动查看的 agent 定义、系统提示词和 workflow 脚本。工具原文不能为界面精简而被改写。

### 逐项处理清单

| 位置 | 现有内容 | 计划处理 |
| --- | --- | --- |
| `src/runtime/settings/view.ts:49` | `Idle Dock rows: 1–30 (default 12). Ask uses its own 70% height limit.` | 保留 Dock 的范围/默认值，删除 Ask 独立高度预算句；预算规则维护在当前 UI/Ask 文档 |
| 同上 | `Native model bash / powershell command syntax highlighting... Jobs and Suite command fields always highlight; ! / !! stays native.` | 简化为内置 Bash/PowerShell 命令高亮设置说明；跨模块恒定高亮规则留在文档；确有必要时仅保留简短的 !/!! 不受影响说明 |
| `src/agents/ui/types.ts:24-26` | 两段 `At runtime, uses the parent session...` 的模型和 thinking 继承解释 | 合并进 Model/Thinking 字段，如 inherit from parent at start；保留模型能力调整的实际含义，不再附两段实现解释 |
| `src/goal/commands.ts:40` | 等待当前 response、cancellation、host operation 的长通知 | 默认一行恢复结果，等待原因进入展开详情 |
| `src/goal/context.ts:6`、`src/runtime/notifications.ts:108` | `Continue the current goal using the latest request contract.` 可见 | 模型控制信号不直接呈现；用户获得独立摘要 |
| `src/goal/activity.ts:6-7` | 自动停跑通知混合轮数、检测规则和 goal remains active | 默认简短暂停原因；完整检测规则与证据在文档和 Goal 详情，不新增常驻解释段 |
| `src/jobs/viewer/component.ts:133,141` | 缺少 owned terminal/readable final snapshot 的长展示 | 底栏可用 Logs only，详情准确说明画面不可用、日志可读；不删数据缺失事实 |
| `src/tasks/index.ts:108` | `in-memory source` 的 fork 告警 | 去掉存储实现术语，保留独立任务列表及未复制来源任务的结果 |
| `src/jobs/index.ts:152-153` | `control bridge v3` 受限告警 | **保持诊断信息，不列入文案清理** |

修改局限于展示生成点，不改 sanitizeText、不截断错误、不移除工具协议。现有 `doc/current/ui/index.md` 的文本精简规则及各模块文档做局部维护，不全量重写。

## 二、恢复提示与折叠展示

### 用户可见行为

- `/goal resume` 正常恢复默认仅显示 `Goal resumed`；已运行时为 `Goal already running`；宿主尚忙时为 `Goal resumed · waiting`。
- 展开后查看目标、恢复前暂停原因、用量/预算、进度和必要等待信息；不在折叠态重复完整目标、模型控制合同或多段实现说明。
- 展开与收起只影响阅读，不发模型请求、不变更目标或执行许可。
- 失败情况保留真实错误，不能用成功的恢复行覆盖预算不足、无目标等错误。

### 实现边界

1. `/goal resume` 是命令，当前恢复产生的是自定义通知，不为满足外观而伪造一个可执行模型工具。
2. 复用 Pi `registerMessageRenderer`、MessageRenderOptions.expanded 和原生展开交互；历史重建也能使用同一显示定义，不新增点击模拟或第二套终端组件。
3. 模型继续接收短控制信号及请求级 Goal 合同；用户展示与模型输入各司其职，不用可见说明承载执行规则。
4. 复用 notifications 的 requestId 和 segments.source。混合批次中的 job 结果、agent 提问、monitor/update 原样保留；不能把含 Goal 控制片段的整批通知隐藏。
5. 一次显式恢复只有一份可见结果，不同时出现长 notify 与重复通知。边界内正常自动续跑不新增可见恢复行，避免每个自动轮刷屏。
6. 无 TUI 路径继续提供准确文本/结构化结果，不依赖用户必须点击才能得到错误或控制反馈。

## 三、Goal 生命周期与唯一暂停入口

### 目标模型

持久生命周期仅保留 `active / paused / completed`。调度仍是运行时内部事实，不作为第二套用户状态并排展示。统一派生以下四种 UI 状态：

| 用户状态 | 含义 | 当前状态归并 |
| --- | --- | --- |
| 进行中 | 执行或已安排继续 | 正常 active |
| 等待中 | 等用户、外部工作、宿主或错误恢复/重试 | active 的各等待阶段 |
| 已暂停 | 不会自动继续，需要用户处理原因或恢复 | paused、blocked、failed、budget_limited、stopped 和自动停跑 |
| 已完成 | 经审计完成并保留证据 | completed |

`detached` 只表示未绑定，不作为第五种用户状态。active 与 automatic=false 等组合必须归一化到清晰的暂停/等待语义，不能继续出现“active 但实际已停”的用户矛盾。

### 原因与控制信息

- 暂停原因覆盖手动暂停、外部阻塞、最终请求失败、预算耗尽、无进展保护、退出/冷启动及需要用户重新授权的取消；历史显式 stop 可保留为历史原因，但不是新入口。
- 保留实际错误、阻塞证据、等待对象/期限、自动停跑原因及预算，原因不是新的顶层生命周期枚举。
- 原 `stoppedFrom` 的必要诊断事实归入原因/详情，不为已经消失的七态模型继续维持并行运行逻辑。
- 内部执行许可、目标 ID/revision、Binding、AbortSignal 和控制取消代次继续作为权限守卫；状态精简不能替代归属校验。
- 普通输入是否能恢复 Esc 导致的暂停，按现有许可语义明确建模；自动无进展保护、显式暂停、退出/冷启动等仍须显式 resume。不能因显示统一而扩大自动执行权限。

### 命令切换

- 保留 `/goal pause`：撤销自动许可，取消待续跑与安排的等待，中止归属该目标的运行，保留目标、进度、错误、用量和耗时。
- 删除 `/goal stop`：移除命令分支、公开帮助、补全、模型说明及当前操作文档中的入口，不保留 alias/shim，不让未知 `stop` 意外被当成新目标正文执行。
- 保留 `/goal resume` 作为统一显式恢复入口；预算不足先提高预算，不绕过预算。
- `/goal clear` 才删除目标；仍中止归属运行并释放等待资源。
- `/goal` 与 `/goal status` 展示用户状态、原因和必要数据；不再直接并列 `goal.status · manager.schedule`。
- goal_complete/goal_blocked/goal_wait 继续使用同一 GoalManager 和模型工具框架。暂停后新用户审计只可取得结案权限，不自动恢复执行；完成仍要求原需求逐项审计，幂等完成保留原证据和时间。

### 持久快照与历史读取

- 新快照采用明确新版本。读取现有 version 1 时归一化为新模型：failed/blocked/budget_limited/stopped 映射为 paused 并保留对应原因；active、automatic、waiting、resumeRequired 等组合按许可语义转换。
- 原始 JSONL 不重写，不覆盖历史，不在树切换时把出站状态写到新分支。历史 stop 数据可读，但不继续注册 stop 命令。
- 保留 ID/revision、预算与累计用量、有效运行耗时、进度、完成证据和时间；无效快照仍明确报错。
- 保留冷启动恢复撤权、同目标修订的持久手动恢复要求、分支不能绕过自动停跑限制的规则；不为迁移增加另一份权限存储。
- 迁移全部调用方、renderer、工具合同和相关行为测试；不保留旧状态 re-export 或两套状态判断。

## 四、Responses 跨资源自动恢复

### 设置及接入

计划新增二级布尔字段，示例：

```json
{
  "runtime": {
    "openAIResponsesAutoRecovery": true
  }
}
```

- 默认 false，用户明确启用后工作；`/suite` 按现有 schema 自动列出字段，沿用默认/用户/项目优先级、来源展示、恢复继承和字段原子保存。
- 同步登记 configSchema、SuiteConfig、defaults，不绕过 additionalProperties=false。沿用保存后 `/reload` 应用，不临时热替换正在执行的恢复阶段。
- 建议在 runtime 内实现小型 Responses 恢复模块。仅负责请求投影、失败快照、分支隔离记录和恢复阶段，不负责模型管理、工具执行或第二套请求队列。
- 每个 createSuite/childSuite 创建独立实例；child 使用 run.config 的准入快照，不能假设主会话 handler 覆盖 child，也不读取任意 child cwd 的配置偷换策略。
- reload/tree/session 切换/shutdown 清除在途快照和恢复阶段；持久隔离记录只从当前分支重建。关闭功能后不再投影或新增恢复记录，不删除原始历史记录。

### 窄错误分类与准入

恢复候选必须同时满足：功能开启、当前 API 为适用的 openai-responses、实际 payload 与模型/作用域相符、失败源 entry 对应本次请求、assistant.stopReason=error、没有部分内容或工具调用、有尚未隔离的上游 item ID，并明确匹配跨资源或相应历史 item 所有权/依赖错误。

- 不对所有 400 重试；普通 schema/参数 400、401/403、上下文超限、账单/额度型 429、用户取消不能套用该修复。
- 密文验证/解密错误仅在有可修正旧 ID 且可无损重放时作为候选；移除 ID 后仍失败就真实终结，不能以删除 reasoning 伪造成功。
- 失败 HTTP 回调并非所有 provider 路径都会触发；按 SDK 归一化 assistant 错误作窄分类，不仅依赖 after_provider_response.status。
- 已有部分输出或工具调用时不自动重放，避免重复副作用；继续交宿主已有错误、重试或压缩处理。

### 只隔离失败历史的上游 ID

- 请求快照关联 session、当前分支/绑定及请求代次、provider/API/model/baseUrl 的非敏感作用域标识，以及实际失败 input 的上游 ID 集合；不保存 payload 正文、reasoning 密文、认证头或密钥。
- Pi 的同模型比较主要依据 provider/API/model，不能据此推断上游 resource 没有变化。故恢复投影位于最终 before_provider_request，处理实际序列化字段，不笼统清空 context。
- 将失败请求中允许重放的 reasoning/message/function_call 历史 ID 成组隔离，避免残留关联校验；Pi 本地产生的 `msg_pi_*` 占位 ID 不作为上游资源 ID 隔离。
- 只移除命中 item 的 `id`，保留正文、phase、reasoning encrypted_content、工具 call_id、arguments 和 function_call_output。toolCall.id 的 item 部分与 call_id 不能混为一谈。
- 不清空全部 assistant、不删 thinkingSignature、不去掉工具结果或历史完成证据。保留密文并不等于保证目标资源可以解密，不向用户作“完整恢复思维链”的无条件承诺。
- 拒绝 store:true、顶层 previous_response_id、item_reference、compaction 和不能确认无损重放的资源项；custom_tool_call 需先核实 Pi 1.5.0 的协议，不能机械当成 function_call。
- 无匹配 ID 时返回 unchanged；有变化只复制根对象、input 数组及命中 item，不深复制整段会话或工具定义。分支读取复用宿主内存记录，避免每请求重扫磁盘 JSONL。
- 隔离状态只追加版本化 custom 记录；失败 assistant 通过公开 context_edit 在模型投影中省略，原始历史仍保留可排障。

### 恢复阶段与重试所有权

恢复生命周期独立于某一次 provider 请求，最小区分未恢复、恢复中和成功/最终失败/取消；结束后释放在途状态，不额外建立常驻 UI 状态机。

1. 特征 400 到最终可动作边界，追加隔离记录与失败 entry 的 context_edit，保留前序 event.entries，并返回 continue 请求一次修正后的上下文续跑。
2. before_provider_request 更新本次请求快照，不清除仍在恢复中的阶段；turn_end(error) 只记录本次失败，不立即宣告整个恢复失败。
3. 修正后遇到 429、可恢复 5xx 或网络错误，由 Pi 原生有限预算、退避、取消和失败省略处理，恢复阶段保持；不另发 prompt/sendMessage，不重复提交用户输入。
4. 成功 assistant 后结束原恢复阶段；取消、永久错误、原生重试耗尽或真正最终结算时才按实际结果终结。最终错误保留最后的真实原因，不能用笼统“跨资源失败”覆盖 429。
5. 不在原生重试耗尽后因仍处恢复中而再返回 continue，避免重开相同错误的预算。若宿主关闭重试或 maxRetries=0，尊重该设置，不暗中改全局配置。
6. 采用实际进展约束而非 recoveredOnce：同一失败请求的旧 ID 已移除、没有新可修正项时，不重复原样发送；后续正常成功产生的新合法 ID 再遇资源切换，可以开启新的恢复阶段。
7. 请求/错误必须绑定恢复阶段和代次，不能靠其他扩展不断生成不同 ID 无限续跑。后续成功与新的独立失败不能混入上一恢复阶段。

### 作用域、共存与安全边界

- 会话、当前分支、provider/API/model/baseUrl 隔离；祖先记录可随当前分支继承，兄弟分支的新隔离记录不能串入。不能用 provider 曾失败作为永久删除所有模型签名的标志。
- 不 monkeypatch 全局 fetch/stream/runtime，不注册第二套 Provider adapter，不读写 Model Manager 私有配置，不自动停用用户其他扩展。
- 与 pi-model-manager 同时开启时，检查本失败源是否已被前序边界省略并安排继续；一方已经接管则不重复追加同一修复或 continuation。合并 event.entries，不能覆盖别人的提案。
- 支持两种扩展注册顺序；Suite 不能仅凭 continue=true 就假定任意外部请求已经完成安全恢复，须结合失败源投影和最终结果判断。

## 五、恢复与 Goal 最终结算协调

1. Suite 统一边界中先计算恢复提案，再处理 Goal 与普通通知；child 复用同一恢复优先级。
2. 已确认恢复接管时保留 active 和执行许可，界面派生为等待中；冻结有效运行计时，不清理目标或进度，不另排重复 Goal 续跑。
3. 错误边界暂存失败候选，真正不可恢复的暂停在 agent_settled 最终确认；这样后序扩展才提出恢复也不会被前序 Goal 提前终结，不依赖扩展加载顺序。
4. 不伪造 event.outcome=completed，不把 400/429 尝试计入无工具自动停跑轮；正常工具后续与恢复成功仍按原自动轮归属处理，用量按宿主真实消息累计。
5. agent_end 仅代表底层运行结束，不据此永久暂停；最终失败保留最后错误并暂停一次，状态原因与恢复阶段结论一致。
6. 显式 pause、clear、编辑/替换、取消代次和会话撤权优先于旧请求的成功。恢复期间发生用户控制后，迟到成功不能重开目标、旧工具权限或等待期限。
7. 保留通知 requestId 去重和现有宿主工作优先级。job/agent 事件、用户输入、压缩和已有 pending continuation 不因恢复重复投递；最终失败后不能由 flush 偷偷启动已暂停目标。

## 影响范围与实施顺序

### 主要代码与既有框架

- Goal：`src/goal/state.ts`、manager、commands、context、activity、tools、render 和生命周期注册。
- Runtime：config/schema/defaults、现有设置列表及 config-fields、notifications、suite 结算协调、共享 renderer 登记及新的最小恢复模块。
- Child：`src/agents/child.ts` 中的会话恢复注册；session.ts 只管理会话目录/生命周期，不把请求修复无谓塞入该层。
- 文案：settings/view、agents/ui/types、jobs/viewer/component、tasks/index 的具体展示点；不修改 control bridge v3 告警。
- 调用与测试：修改导出符号前用 LSP 查全部引用，更新相关现有契约测试；删除只固化旧文案/内部实现的断言，不把新措辞重新固定成行为契约。
- 与 [源码入口启动性能优化](source-startup-performance.md) 的共同边界：新增 renderer 不能引入完整执行依赖到 factory；请求恢复不能连接多余 UI/资源栈。该方案对 Goal 控制命令的描述在实施时同步去除 stop，不重复实施启动专项。

### 实施阶段

1. 明确并迁移 Goal 三态模型、原因、历史快照和唯一 pause 入口，更新所有消费者。
2. 局部调整文案，接入恢复消息一行/展开展示，保持模型控制和真实事件完整。
3. 实现最小 Responses 恢复模块、严格开关、分支隔离和主/子会话接入。
4. 统一恢复、Goal 和通知的边界顺序与最终结算，处理取消竞争和扩展共存。
5. 运行有针对性的实际行为验收，局部维护文档并提交；不把方案中的目标行为提前写成 current 已实现事实。

## 验收计划

以下均为待执行场景，不是现有验收结论。行为变化需实际 smoke，不能只证明类型检查或 mock 转发正确。

| 场景 | 必须观察的结果 |
| --- | --- |
| `/goal resume` 空闲、忙碌、已运行 | 默认一行，展开完整详情；只有必要的一次模型启动，无长控制协议外露 |
| 混合 Goal/job/agent 通知与历史重建 | Goal 控制折叠不丢真实事件，历史 renderer 可用，阅读不触发请求 |
| Goal pause/resume/clear 与命令帮助 | 只有 pause 暂停入口；stop 无 alias、不误建名为 stop 的目标；clear 才删除 |
| 新三态与 version 1 历史 | 四种用户展示一致；历史错误、阻塞、预算、进度、ID、耗时与许可不丢失 |
| 退出/冷启动、reload/tree/fork | 不绕过手动恢复/自动停跑要求，分支不串写，离线时间不计运行耗时 |
| 开关关闭与用户/项目继承 | 关闭无投影/自动恢复，字段保存不改其它值，reload 生效；child 使用准入快照 |
| 资源 400 → 成功 | 修正请求仅少隔离 ID，正文/密文/phase/call_id/工具结果保持；原始错误仍可排障，Goal 继续 |
| 资源 400 → 429 → 成功 | 恢复不在 429 turn_end 提前结束，宿主退避继续；不重复用户消息/工具执行，Goal 不误停 |
| 资源 400 → 5xx/网络错误 → 成功 | 复用宿主瞬态策略和恢复投影，无第二套请求预算 |
| 资源 400 → 持续瞬态错误 | 有限预算耗尽终结一次，保留最后错误，Goal 暂停，不重开预算 |
| 已无新可修正 ID 的同类 400、无法解密 | 不原样无限重试，不删 reasoning 或伪称恢复成功 |
| 普通 400、401/403、账单型 429、上下文超限 | 不误识别为跨资源恢复；已有压缩/错误流程不被接管 |
| 部分输出/工具调用、previous_response_id、item_reference、compaction、未知资源项 | 拒绝不安全自动重放并真实报错，不重复副作用 |
| 恢复中 Esc/pause/clear/edit/替换/切换 | 旧响应不重新激活或覆盖新控制意图，资源与计时按归属释放 |
| 并发 child、不同模型/端点、兄弟分支 | 快照/隔离记录/最终结果不串扰，新合法 ID 不被无差别删除 |
| 与 Model Manager 两种加载顺序、已有边界提案 | 无重复隔离/续跑，entries 完整保留，Goal 不因先后次序误停 |

### 验证方式与成本

- 实际 Pi TUI 检查恢复消息鼠标展开/键盘展开、窄宽屏、Goal 状态与控制入口；至少覆盖 40、80、120 列代表宽度，不将纯组件字符串渲染当成实际界面证明。
- 使用本地受控 Responses HTTP/SSE 服务注入错误序列，走实际 SDK serializer、payload hook、边界提交和原生重试，观察真实 payload、请求次数、工具副作用计数和 Goal 最终状态；不使用收费真实资源制造故障。
- 保留少量确有多处回归风险的行为测试：恢复跨瞬态错误、最终预算、状态/许可迁移与取消竞争等。小文案调整不新增永久文本断言；纯接线/转发采用临时 smoke，不扩充无意义测试数量。
- 修改完成后集中运行 typecheck、受影响行为测试与必要全量检查；日常检查不超过 5 分钟、全量不超过 10 分钟，超出先优化无必要测试。
- 区分项目固定 Pi 1.5.0 与实际用户宿主环境的结果；未执行的平台或交互明确标注，不把本地受控结果宣称为所有上游资源均可恢复。

## 文档与完成标准

当前稳定事实在实施并验证后局部更新到：

- [Goal 索引](../current/goal/index.md)、[生命周期](../current/goal/lifecycle.md)、[上下文与续跑](../current/goal/context.md)、[操作](../current/goal/operations.md)：三态/原因、唯一 pause 命令、恢复展示与最终结算。
- [公共运行时](../current/runtime/index.md)、[设置](../current/runtime/settings.md)：开关、作用域、继承、reload、生效与原生重试边界；恢复协议较长时按现有小文件/索引规则组织。
- [统一界面](../current/ui/index.md)、[命令高亮](../current/ui/command-highlighting.md)、[模型继承](../current/agents/models.md) 及相关模块操作说明：局部收敛文案，保留诊断告警与真实数据边界。
- [上游登记](../../third-party/UPSTREAM.md)：参考版本、独立实现与许可证边界；不得把 AGPL 来源误标为 MIT 复制代码。

完成后移动专项到 `doc/finished` 并更新两侧索引；current 不写临时流水账、会话调度、本机产物路径或未执行验收结论。历史已完成专项保留其时代事实，不为删除 stop 全量改写历史记录。提交使用简短中文类型前缀，禁止把用户其他变更混入本专项。

## 任务清单

- [ ] 1. 完成 UI 文案局部收敛，保留 control bridge v3 等排障告警、错误全文、权限与原始数据。
- [ ] 2. `/goal resume` 默认一行，原生展开保留详情，混合通知与模型控制不丢失且不重复启动。
- [ ] 3. 迁移 Goal 三种持久状态/四种用户展示，统一 pause，删除 stop 入口并保留历史数据与权限规则。
- [ ] 4. 接入 Responses 跨资源恢复设置、精确 ID 隔离、主/子会话作用域和跨瞬态错误的有限重试生命周期。
- [ ] 5. 修复 Goal 过早失败结算，处理取消竞争、最终失败及与 Model Manager 的两种顺序共存。
- [ ] 6. 完成实际 TUI、受控 Responses 故障序列和必要行为检查，记录适用范围与未通过项。
- [ ] 7. 局部更新当前文档、上游来源及操作说明，归档完成专项并提交。

[返回待办索引](index.md)
