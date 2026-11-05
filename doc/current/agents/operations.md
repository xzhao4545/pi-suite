# 工具与操作

| 入口 | 当前行为 |
| --- | --- |
| agent_start | prompt、type?、name?、background?、model?、thinking?、maxTurns?、taskId?；background 默认 true |
| agent_list | id 查进度详情和历史 run；列表 state 为 active/queued/finished/all，默认 active；scope 为 session/workspace，默认 session；cursor/limit 分页，默认 20、最多 100 |
| agent_read | id、runId?；活动默认 transcript，结束默认 result；offset/limitBytes/search/context 使用 [共享读取规则](../jobs/index.md) |
| agent_send | id、message；返回 answered、steered、queued 或 resumed，只有直接父级可以发送 |
| agent_stop | id、runId?；取消运行子树及其创建的活动 job，返回真实状态和 cleanup |
| wait | 接受 job 与 agent ID 的 any/all 等待；结果、问题与其他事件使用统一返回结构，超时只结束调用 |

模型工具默认返回摘要，完整输入、thinking、工具调用和输出通过 agent_read 或原生 transcript 按需读取。workspace 列表覆盖当前进程已经加载的记录；session 列表与状态数量使用同一直接子级和分支归属过滤。

## /agents

`/agents` 选择 active、queued、finished 或 all；也可使用 `/agents all` 等直接指定筛选。选择一条 run 后可查看 Transcript、修改该 agent 的 Model / thinking，或选择“Stop child, nested agents and jobs”停止该运行范围。菜单的 Types · model / thinking 和 `/agents types` 配置类型，写回位置和作用范围见 [模型配置](models.md)。

查看器复用共享 Transcript 与 DetailsView；Markdown、thinking、工具调用/结果由 Pi 原生组件渲染。工具优先使用对应 child 的渲染定义，持久历史缺少定义时使用 Pi 标准渲染。稳定消息缓存组件及宽度渲染，活动尾部与工具部分输出随事件更新；在底部时跟随，向上阅读保留位置。

- ↑↓、PageUp/PageDown、Home/End 滚动；鼠标滚轮滚动。
- `/` 搜索；n/N 查下一个/上一个；搜索内 Esc 退出搜索。
- ←→ 选择 Tools、Thinking、Model / thinking 或 Back；Enter 执行动作；Esc 返回。模型选择返回后保留阅读与搜索位置。

进入查看器持有公共通知阻塞令牌；关闭后恢复通知投递，主会话保持原绑定。关闭查看器只结束阅读。

## 父级回答

child ask_user 使用共享 schema 与 response/details，工具挂起期间为 waiting(parent)。问题只交给直接父级，包含选项 ID、标题和 agent_send 提示；顶级通过统一 Notifications，嵌套通过父 child 的通知边界/共享等待返回。

message 与选项 ID/标题精确匹配时返回 selection，否则在 allowFreeform=true 时返回 freeform。多选可发送 JSON 字符串数组；批量问题发送对应题数的 JSON 数组，每题元素为文本或选择数组。返回标记 source=parent，不能把父级回答声称为用户直接授权。期限默认使用 ask.timeout，timeoutMs=0 无期限；超时和取消保留非回答状态，并使 child 以 stopped 结算。

## 类型与模型

核心类型文件依次加载用户 `<agentDir>/agents`、项目 `.agents/agents`、项目 `.pi/agents`；后加载的同名类型覆盖前者，精确名称优先，大小写匹配必须唯一，enabled=false 禁止启动。支持 name、display_name、description、tools、disallowedTools/disallowed_tools、model、thinking、max_turns、persist_session、allowed_subagents、prompt_mode 和 enabled。正文为系统提示词；allowed_subagents 默认不开放嵌套，可为 all 或类型名单。

模型与 thinking 分别按调用参数、该 agent 的 individual、agents.types 的对应字段、frontmatter、agents.defaultModel（仅模型）、父级当前值解析。配置逐类型逐字段合并；显式 provider/modelId 在认证目录中不可用时报错指出来源，不跨 Provider 替换；调用参数和 frontmatter 的模糊名仅在匹配唯一时接受。实际 thinking 由 Pi 按模型能力收紧。单独修改从下一次请求生效，结束后的修改用于恢复，详细规则见 [模型配置](models.md)。

[返回 agents](index.md)
