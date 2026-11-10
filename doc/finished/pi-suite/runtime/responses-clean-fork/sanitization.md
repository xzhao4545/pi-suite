# Responses 协议净化与后续正常重放

## 实施前问题根因与范围（历史）

Responses 历史除了普通文本和工具记录，还可能保留提供商输出 item ID、响应 ID，以及 reasoning 的 encrypted_content。目标服务可能检查资源所属账号、组织或加密数据绑定，跨来源重放会出现资源由另一个账号创建、invalid_encrypted_content、组织不匹配或解密/解析失败。

当前 `pi-ai` 的通用消息转换以 provider/api/model 判断是否同源；这一判断不能识别同名 Provider 改 endpoint、换账号，以及中转站内部轮换上游。普通 Responses 请求的 store:false 并不表示不再重放客户端保存的加密推理。原生 fork 仅复制这些字段时，换一个本地会话 ID 不能消除不兼容内容。

本专项对 fork 时已有的 Responses 私有状态做一次性净化，不尝试解密，不依赖目标账号可识别，不对之后新产生的正常状态做持续删除。

## 有类型的字段处理

| 内容或标识 | 一次性处理规则 |
| --- | --- |
| 用户消息、可见 assistant 文本 | 保留原文、角色和顺序；不能将隐藏 thinking 拼成普通回复 |
| 工具名称、参数、真实结果及错误结果 | 保留，不重新执行、不改业务数据，不编造成功结果 |
| Responses 消息输出 item ID | 去掉旧服务端身份；需要标识时按公开协议生成合法本地标识，不能继续携带旧资源 ID |
| Responses function/custom tool 输出 item ID | 去掉旧资源部分，保留有效 call ID 与结果配对 |
| thinkingSignature 中的 Responses reasoning 项 | 移除不透明加密推理项及其私有关联信息；不只删 encrypted_content 后留下不符合协议的空 reasoning 项 |
| Responses 响应 ID 与已有续接状态 | 不用于新会话；新会话以完整净化上下文开始 |
| assistant 消息 phase | 保留 commentary/final_answer 语义，不因清除签名而丢失 |
| 其他提供商的正常内容 | 不凭名字包含 id/signature 或普通文本中出现密文字符串就删除；跨 API 转换继续由公共 adapter 按协议处理 |
| session/entry/parent 等本地结构 ID | 使用正常复制规则生成或映射，不作为远端 item ID 删除 |
| 文件、容器、业务参数中的 ID | 不由本净化器迁移或删除；缺少可迁移内容时明确提示依赖 |

清理字段必须基于消息来源、内容类型与已知序列化格式；禁止递归删除所有 id、call_id 或 signature 字段。日志文本、工具参数、描述和用户输入里的同名字段属于业务内容。

## 工具调用配对与 phase

当前 Responses 工具块可能把 call ID 和输出 item ID 编码为 `callId|itemId`。净化须使用统一解析/转换能力去掉旧 item 部分；toolResult.toolCallId 使用相同映射，避免出现未配对结果。需要规范化时保证稳定且不引入冲突，function_call 和 custom_tool_call 的类型按目标正常 adapter 转换。

工具调用参数原样保留。遇到已有不完整调用或缺失结果，沿用宿主既有协议处理及明确错误，不在 fork 中重新执行工具补结果。

当前 Responses textSignature 会编码 id 与 phase。不能直接删除整个签名并丢掉 phase；应将可迁移消息语义与私有 item 身份分离，必要时扩展公共消息/签名转换能力。跨 Provider 转换时也须保留适用的 phase，不能通过伪造历史 provider/model 来规避转换。

如使用合法本地标识保存 phase，必须保证本地标识不复用旧上游资源，不被当成旧账号资源引用；相关编码与转换复用公共协议实现，不由命令拼装一套 wire payload。

## 分支、context edit 与压缩

- 使用 SessionManager 的当前分支及有效投影，不能复制全文件所有兄弟分支，也不能忽略当前叶子之后的选择边界。
- 当前分支中的 context_edit 需要按最新有效贡献处理；被省略的消息不能重新进入新上下文，被替换的内容使用替换结果。净化同样适用于替换内容，避免 reload 或原生投影重新引入旧签名。
- 新会话的完整选中历史中若保留可导航的旧消息，也要净化这些消息；不能只净化当前请求窗口，却让树导航到压缩前再次恢复旧私有状态。
- Pi 的可阅读 compaction/branch summary 保留其内容和必要系统/工具 checkpoint。重建条目时统一映射 firstKeptEntryId、targetId、fromId、label 等引用，避免失效结构指向。
- 若使用物化后的有效贡献构造新分支，应保持普通摘要、模型配置、系统/工具状态与可追溯来源，不把压缩前完整历史无条件展开成超大请求。
- 不调用模型“先做一次摘要再 fork”，因为旧历史可能正是无法成功请求的原因；命令本身不发模型请求。
- 只有加密压缩项、没有本地原文或可阅读摘要时，不能无损净化。默认在预检中明确拒绝当前不可安全迁移的部分，不静默丢弃唯一上下文。
- 原会话 raw history、context edits、结构引用和统计不被改写；使用原生会话读取能力，不在命令里修复源 JSONL。

## 新会话的正常请求

源 A 的普通消息与工具记录保留，A 的私有状态不进入净化副本；新会话第一次对 B 发完整净化上下文。B 返回的新 item ID 和 reasoning 状态正常保存，下一轮仍使用 B 时按正常协议重放。

- 不安装永久 before_provider_request 清理器，不为新会话保存 portable 策略，不继承另一修复功能的持续清理标记。
- 以新 session ID 使用正常 Provider 会话/缓存范围，不能复用源连接的 continuation、lastResponseId 或增量输入基线。仅更换显示名称不算隔离。
- 第一次请求不引用源响应；后续是否使用新响应的 SSE/WebSocket 缓存与续接由正常 adapter 决定，不永久关闭这些优化。
- store、reasoning effort、采样参数、工具声明与认证使用当前正常配置；不为避免错误强制关掉思考或改用另一 API。
- 用户切换 Provider 不属于 fork 命令职责；后续跨 API 适配仍由统一消息转换负责。

## 无法保证的范围

- 密文推理不能解密或迁移，模型只能依据保留下来的可见上下文重新推理，效果不保证完全一致。
- B 下一轮被中转改路由至不兼容账号 C 时，新生成的状态仍可能报错；需要服务端会话粘性或另行选择持续可迁移策略。
- 账号专属文件、容器和纯密文压缩依赖不能靠删 ID 迁移；需要原内容、重新上传或回到原账号。
- 工具 schema、模型参数、认证/额度或其他普通 400 不属于本功能的修复承诺。

协议参考：[OpenAI reasoning 与无状态重放](https://developers.openai.com/api/docs/guides/reasoning)、[Responses 创建接口](https://developers.openai.com/api/reference/resources/responses/methods/create)、[LiteLLM 跨组织加密内容路由事故](https://docs.litellm.ai/blog/responses-api-encrypted-content-incident)。实现与验收以当前实际 Pi/目标协议为准，不仅依赖错误消息的模糊关键词。

## 任务列表

- [x] 实现基于消息类型与来源的私有状态净化，区分远端 item ID、本地结构 ID 和业务 ID。
- [x] 保留工具调用/结果映射及 phase，必要能力回到公共消息转换框架。
- [x] 核查 context edit、压缩、分支摘要和条目引用，避免重放被省略内容或恢复旧签名。
- [x] 保留正常模型请求配置，确保新 session 的传输续接与源会话隔离。
- [x] 验证新产生的 item/推理状态可在第二轮正常重放，不被持续清理。
- [x] 明确不可迁移依赖、账号轮换及其他 400 的限制，不静默丢失上下文。

[返回专项索引](index.md)
