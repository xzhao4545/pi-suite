# 工具与原生操作

agent_workflow 仅由主会话使用，参数为 script、scriptPath 或 name 三选一，args?、resumeFromRunId?。工具始终后台启动，初始文件写入后返回 wf_ ID、保存的 scriptPath 和 resultPath。使用前提是用户明确要求编排、调用要求编排的技能或指定保存的 workflow；工具描述保留完整脚本、并发、结构化结果与恢复指引。

`wait({"ids":["wf_…"]})` 使用公共 any/all 等待，问题、其他对象结算、monitor/hands-free 更新和用户插话仍可提前返回。结束后可通过返回的 resultPath 使用 read 读取完整输出。

## /agents workflows

Workflows 菜单显示当前会话与分支的运行，按开始时间倒序排列；Saved workflows 选择保存资源，可查看源码或输入 JSON args 启动。运行详情展示名称、说明、状态、agent 进度、阶段、实际模型/thinking、尝试原因、用量、提示/结果预览、错误、日志与最终结果。metadata 阶段标题精确匹配；未声明阶段的 agent 保留独立 Agents 分组。

| 动作 | 行为 |
| --- | --- |
| Pause / Resume | 暂停或释放新启动；暂停期间已有 child 继续结算 |
| Stop | 取消 Worker、child 及所属 job，等待真实清理 |
| Children / gates → Transcript | 使用公共 child Transcript 查看会话 |
| Children / gates → Gate stdout / Gate stderr | 使用公共 job 查询与日志查看器读取当前或持久 gate 输出 |
| Children / gates → Skip | 跳过尚未结算的排队或运行调用，脚本收到 null |
| Children / gates → Retry | 停止当前运行尝试并重跑，脚本继续等待原调用 |
| Replay journal | 对结束运行使用保存脚本和原 args 创建新运行，复用成功且未改变的前缀 |

resumeFromRunId 限定当前主会话和分支，目标必须结束并具有 journal。恢复先检查文件，未完成末行的 truncated 前缀在运行日志中明确提示；中间损坏和读取错误拒绝启动。含 child 会话 resume 的 journal 按完整执行规则处理，见 [编排与 journal](index.md)。

查看器复用原生 Text、DetailsView、ScrollView 和值选择。↑↓、PageUp/PageDown、Home/End 阅读；`/` 搜索，n/N 查下一/上一项；←→ 选择动作，Enter 执行，Esc 返回。返回 child 会话、gate 日志或控制操作后保留详情阅读与搜索位置。菜单值使用运行 ID 与 agent index，长名称的显示截断不改变选择身份。浏览期间由公共通知阻塞令牌保持阅读。

## 开关与冲突

agents.workflows 默认 true，控制 agent_workflow 启动和菜单入口；初始关闭时不注册该工具，绑定时可按配置启用。绑定通过公共工具注册刷新描述，使模型使用当前启用的类型列表。关闭开关后使用 /reload，运行 owner 与保存文件按生命周期保留。agents.packageWorkflows 为 boolean 或包名/source 数组；false 与空数组关闭包 workflow 发现。

默认开启时，检测其他扩展的 agent_workflow、SubagentWorkflow、Workflow 或 workflow 工具；发现冲突后本入口退让并报告来源。用户在配置中显式设置 `"agents": {"workflows": true}` 时保留并列工具；同名注册被 Pi 选择第一项时报告冲突。工具撤销只影响本入口，由本入口撤销的选择可在重新启用时恢复，手动禁用的工具选择保持不变。

[返回 Workflow](index.md)
