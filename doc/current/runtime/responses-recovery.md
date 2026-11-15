# Responses 历史 ID 恢复

## 开关与接入

`runtime.openAIResponsesAutoRecovery` 默认 `false`，通过 `/suite` 或用户/项目 `pi-suite.json` 明确开启，按默认、用户、项目逐字段继承。保存后 `/reload` 应用；已准入 child 使用其 `run.config` 快照，不以 child 的执行 cwd 重新读取策略。

```json
{
  "runtime": { "openAIResponsesAutoRecovery": true }
}
```

主会话和 child 各有独立恢复实例。实现位于 `src/runtime/responses/`，仅通过公开 `before_provider_request`、`turn_end`、`agent_before_settle` 与 append-only session entry 工作，不修改宿主、Provider adapter、全局网络函数或其他扩展配置。

## 准入与无损边界

恢复只适用于当前 `openai-responses` 模型、与该模型匹配的最终请求，以及明确匹配历史项所有权、资源不匹配、依赖缺失或相关密文验证的空内容 assistant 错误。请求、失败源 entry、绑定代次与当前分支必须对应；仅有 HTTP 400 不足以触发恢复。网关包装的错误可不带具体 item ID；`item was created under/in a different … resource` 这类明确创建来源冲突按资源错误识别，资源名称允许含限定词或脱敏标记，普通 schema 文本仅提及不同资源不满足该条件。

- 已有部分内容或工具调用的失败不自动重放，避免重复副作用。
- 普通参数/schema 400、401/403、账单/额度或限流 429、上下文超限不作为资源修复候选。
- 请求含 `store:true`、`previous_response_id`、`item_reference`、compaction、未知资源项或不能确认可独立重放的 reasoning 时不接管。
- Pi 1.5.0 的 `custom_tool_call` 使用独立 `call_id` 和字符串 `input`；它与普通 `function_call/arguments` 均按实际序列化字段处理，不将工具关联 ID 当成资源项 ID。

修复成组隔离失败请求携带的 reasoning/message/function_call/custom_tool_call 上游 ID；`msg_pi_*` 本地占位 ID 不参与隔离。投影只移除命中项的 `id`，正文、phase、`encrypted_content`、`call_id`、arguments/input、工具输出与工具定义保持。只复制根对象、input 数组与命中项；没有命中时不替换 payload。保留密文不代表目标资源一定能够解密；移除 ID 后仍失败会保留真实错误，不删除 reasoning 来制造成功。

## 持久化、作用域与重试

`pi-suite:responses-isolation` custom entry 的 version 为 1，只保存隔离 ID 与 provider/API/model/baseUrl 的哈希作用域，不保存 payload 正文、密文、认证信息或密钥。失败 assistant 通过 `context_edit` 从模型投影省略，原始 JSONL 仍可排障。分支重建只读宿主内存中的当前分支；祖先记录可继承，兄弟分支记录不串入。关闭开关不投影或追加记录，也不删除原始历史。

第一次资源错误在最终可动作边界追加隔离记录和必要的失败源省略，请求一次修正后的继续；保留前序扩展 `entries`。恢复阶段不会在下一次 `turn_end(error)` 提前结束：修正后的 429、可恢复 5xx 或网络错误交给 Pi 原生重试预算、退避和取消。原生重试关闭或耗尽后不重新打开预算，不另发 prompt 或重放用户消息。

成功响应结束本恢复阶段；之后新产生的合法历史 ID 可以参与新的独立资源修复。同一恢复阶段没有第二次修复继续，防止相同错误或其他扩展生成新 ID 导致无限请求。取消、最终结算及 session/tree/reload/shutdown 会释放在途状态；tree/reload/session 绑定只从当前分支重建隔离记录。

前序边界已省略本失败源并安排继续时，Suite 不重复接管；Suite 的提案同样供后序扩展观察。仅有外部 `continue=true` 而没有本失败源投影变化，不被视作已经安全修复。

## Goal 与通知

主会话边界顺序为恢复提案、Goal 决策、普通通知，child 复用恢复优先级。恢复等待保留 Goal 的执行许可与进度，并冻结有效运行计时；尝试错误不触发无工具自动暂停。Goal 在 `agent_settled` 才确认不可恢复失败，因此后序扩展在同一边界提出恢复也不会被提前暂停。最后真实错误作为暂停原因保留，显式 pause/clear/编辑、取消代次和绑定撤权始终优先于旧响应。

通知沿用 requestId 与 segments.source；已有继续或宿主消息优先，通知提案保留前序 entries，最终暂停后不由 flush 重新唤醒 Goal。Goal 恢复展示与权限见 [Goal 请求与续跑](../goal/context.md)。

[返回公共运行时](index.md)
