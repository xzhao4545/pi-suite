# Responses 历史 ID 恢复

## 开关与接入

默认关闭。在 `/suite` 或[配置文件](index.md#配置)中开启后，用 `/reload` 应用。child 取启动时的 `run.config` 快照，不按执行 cwd 重读策略。

```json
{
  "runtime": { "openAIResponsesAutoRecovery": true }
}
```

主会话和 child 各有独立恢复实例。实现位于 `src/runtime/responses/`，仅通过公开 `before_provider_request`、`turn_end`、`agent_before_settle` 与 append-only session entry 工作，不修改宿主、Provider adapter、全局网络函数或其他扩展配置。

## 何时恢复

只有同时满足以下条件才尝试恢复：

1. 当前模型使用 `openai-responses`，最终请求的 `model` 匹配。请求、失败消息、当前会话绑定与分支必须对应。
2. 请求可独立重放。`store: true`、`previous_response_id`、`item_reference`、服务端 `compaction`、未知项或缺少非空 `encrypted_content` 的 reasoning 都不符合条件。
3. assistant 以错误结束，且没有正文或工具调用。已有内容的失败不重放，以免重复产生副作用。
4. 错误明确指向历史项的所有权、资源、缺失依赖或相关密文验证。普通参数/schema 400、401/403、账单/额度、限流 429、5xx 和上下文超限不触发修复。网关错误可以省略具体 item ID；明确的 `item was created under/in a different … resource` 算资源错误，资源名可以带限定词或脱敏标记。普通 schema 错误只提到不同资源不算。
- Pi 1.5.0 的 `custom_tool_call` 使用独立 `call_id` 和字符串 `input`；它与普通 `function_call/arguments` 均按实际序列化字段处理，不将工具关联 ID 当成资源项 ID。

修复把失败请求中的 `reasoning`、`message`、`function_call`、`custom_tool_call` 上游 ID 一起标记为隔离；本地 `msg_pi_*` 占位 ID 除外。下次生成请求时只移除命中项的 `id`。正文、`phase`、`encrypted_content`、`call_id`、`arguments` / `input`、工具输出和定义保持原样。只复制根对象、`input` 数组和命中项；没有命中则沿用原 payload。目标资源仍可能无法解密，届时保留真实错误和 reasoning。

## 持久化、作用域与重试

1. 第一次符合条件的错误在 `agent_before_settle` 追加隔离记录。失败消息仍可见时追加 `context_edit`，使它不进入模型上下文；原始 JSONL 保留。保留前序扩展的 `entries`，并请求继续一次。
2. 修正后的请求仍使用 Pi 的重试预算、退避和取消规则。`turn_end` 的错误不结束恢复阶段：429、可重试的 5xx 或网络错误交给 Pi。原生重试关闭或耗尽时，Suite 不追加请求、另发 prompt 或重放用户消息。
3. 同一阶段最多修复一次，即使其他扩展生成了新 ID。成功响应结束本阶段；之后出现的新历史 ID 可以触发独立修复。取消后的结算、最终结算、重新绑定或关闭时清除在途状态。

隔离记录是版本为 `1` 的 `pi-suite:responses-isolation` custom entry。仅保存隔离 ID 和 `[provider, api, model, baseUrl]` 的 SHA-256，不保存 payload 正文、密文或认证信息。绑定时从宿主内存中的当前分支重建：可继承祖先记录，不读兄弟分支。开关关闭时不读写隔离记录，不修改历史。

前序边界已省略本失败源并安排继续时，Suite 不重复接管；Suite 的提案同样供后序扩展观察。仅有外部 `continue=true` 而没有本失败源投影变化，不被视作已经安全修复。

## Goal 与通知

主会话的处理顺序见[通知投递](index.md#通知投递)。child 也先计算 Responses 修复，再处理通知。等待修复时，Goal 保留进度和运行许可，暂停累计有效运行时间。尝试失败不计入无工具自动暂停。Goal 在 `agent_settled` 才根据最终失败暂停，并保留真实错误，因此后序扩展仍可在同一结算边界提出恢复。用户暂停、清除、编辑、取消和会话切换优先于在途结果。

普通通知按[通知消息格式](index.md#通知消息格式)排队。最终暂停后，空闲通知不会让 Goal 恢复自动执行。见 [Goal 请求与续跑](../goal/context.md)。

[返回公共运行时](index.md)
