# 模型工具参数与返回精简计划

状态：协议、返回、任务交互与验收已完成；下文保留记录时的根因和实施计划，最终行为见 current 与验收结论。与 [Tasks/Goal 交互专项](../tasks-goal-interaction.md) 共同实施，保留其 8 项需求及取消/恢复优先级。

## 新增需求

- [x] 消除 task_list 的 `INVALID_ARGS: id and parentId are exclusive` 重复失败，从参数设计提升首次调用正确率。
- [x] 精简 tasks、jobs、subagents 相关方法的模型返回，减少上下文占用，同时保留执行决策所需信息。
- [x] 对照 OMP 的真实协议、返回及全文读取方式，形成统一、可验证的实施方案。

## 根因与范围

实际会话中发现 13 次相同的 task_list 失败，参数均为 `{"detail":true,"id":"1","includeDone":true,"parentId":"1"}`。这是真实地同时传入两个 ID，不是 null 或省略字段的适配问题。

`src/tasks/tools.ts` 的 schema 声明 id 和 parentId 为独立可选字段，允许该组合通过形状校验；`src/tasks/query.ts` 执行时才拒绝。列表、单项、组子树三种意图共用一个对象，且错误只说明互斥，不提供可执行的修正调用。jobs/agents 的 list 同样混合 id 详情与列表筛选，`runtime/tools.ts` 也在运行时拒绝组合；后两者是同类设计风险，尚未证实出现相同重复失败。

返回方面，task_edit 回显操作字段、组进度和固定操作提示；job 单项回显大量元数据、最长 2000 字符命令和读取提示；agent 单项同时显示当前状态、统计、配置来源、历史执行和所属 jobs。多处固定操作说明每次重复，默认读取预算为 16 KiB。

Pi 的 OpenAI Responses/Completions 适配实际发送 toolResult.content，不序列化 details 为工具输出。**收起 TUI 或删掉本地 details 不能替代精简模型 content。** details 仍用于渲染、恢复和控制；实施时还要确认当前启用 Provider 的实际发送边界。

本专项覆盖 task_list/task_edit、job_start/list/read/write/stop、agent_start/list/read/send/stop，以及同路径的 wait、后台结果/问题/监视通知。agent_workflow、动态 agent_clone 的启动回执和结构化输出校验结果同步审查；复杂工作流语义与用户提供的输出 schema 不为缩短文本而删减。

## 方案索引

- [参数与查询入口](parameters.md)：列表与单项拆分、紧凑更新、错误自修正和框架接入。
- [返回契约与信息保留](results.md)：逐类最小字段、读取与分页、预算、通知和完整性约束。
- [OMP 对照与验收](reference-validation.md)：固定源码参考、适用边界和验证指标。

## 实施步骤

| 阶段 | 交付内容 | 完成条件 |
| --- | --- | --- |
| 1. 基线与协议 | 清点注册 schema、描述、返回 content、后台通知和内部调用；保留脱敏错误参数与代表性结果作为前后比较输入 | 明确实际发给模型的内容和各调用必需字段；不将 details 体积计入模型节省量 |
| 2. 查询正确率 | task/job/agent 列表和单项查询拆分；同步任务组查询、错误提示及所有内部调用和模型说明 | 原报错对应查询能用一个明确入口完成；列表 schema 中没有单项 id，单项 schema 中没有列表筛选字段 |
| 3. 任务变更 | start/done/block/unblock、显式 batch、原子回执和前后状态；接入任务同步修复 | 短参数完成同一操作，多个执行任务仍可并发，批量失败不部分提交 |
| 4. 返回与读取 | 所有相关方法使用按操作分类的紧凑 content；保留模型必要字段；统一全文入口、游标和通知去重 | 列表/回执明显缩短，失败/问题/清理和结果可用性没有遗漏，截断内容始终可定位读取 |
| 5. 界面与收尾 | tasks 常驻区与浏览器统一渲染；取消/恢复专项完成；局部更新 current 文档 | UI 不从模型短文本重建状态；专项验收完成，计划移入 finished |

阶段 1–4 与 Esc、resume 和刷新修复协调：取消/恢复的真实故障先定位；任务协议、回执与 UI 数据同步一并修改，避免短返回掩盖状态未提交。

不新增另一套对象存储、协议注册表、模型摘要服务或 Provider 适配系统。共同参数、分页、读取与错误继续扩展 runtime/tools.ts、runtime/read.ts、runtime/errors.ts；各模块负责自身字段与状态。

## 实施完成

list/get 独立注册并同步 child 白名单、错误示例、原生 UI 和模型说明；task_edit 使用短操作和原子 batch。普通回执删去固定重复指南，关键错误、退出/清理、运行期限、runId、问题、游标与全文入口保留在 content；本地 details 继续服务 UI 和控制。列表默认 10 条、约 4 KiB，读取默认 4 KiB、最大 64 KiB。wait、前台结果与 Notifications 保留原消费归属，workflow/clone 使用同一启动回执，结构化输出校验与 payload 保持完整。

参数、中文/多字节页、组计数、并发/原子性、真实控制与通知组合已通过。代表性回执下降而新增 get 增加固定 schema 成本，具体数值及统计边界见 [验收结论](reference-validation.md#本轮验收结论)。

[返回已完成专项](../../index.md)
