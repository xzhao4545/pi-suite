# Responses 密文失效恢复

## 目标

开启 `runtime.openAIResponsesAutoRecovery` 后，网关在多个上游账号间切换导致历史 reasoning 密文无法解密时，Suite 自动修复请求并继续，不需要用户介入。

## 现状与根因

- 实际报错：`OpenAI Responses bad request: The encrypted content gAAA...1NXI could not be verified. Reason: Encrypted content could not be decrypted or parsed. [trace_id=… code=30000]`。报错只有截断的密文片段，没有 item ID。
- `resourceMismatch`（`src/runtime/responses/payload.ts`）的密文分支要求错误文本包含请求中的上游 ID，因此识别不到这条报错。
- 即使识别到，现有修复只移除 `id`，`encrypted_content` 原样重放。密文由另一账号签发，重放必然再次失败。
- `beforeSettle` 要求 `request.ids` 非空。发生过 ID 隔离后，投影请求里已没有上游 ID，密文错误被直接放过。
- 同一阶段最多修复一次。资源 ID 错误修复后，重试紧接着遇到密文错误，仍处于同一阶段，无法再修。实际会话出现的正是这个序列。
- 官方 OpenAI 对其他组织签发的 reasoning 会静默移除（见 pi-ai `openai-responses-shared.js` 中的注释），网关则直接返回 400，因此需要在请求侧移除这些 reasoning。

## 设计

### 错误分类

`resourceMismatch` 改为返回修复种类 `'id' | 'cipher' | undefined`。排除规则（401/403/429/5xx、账单与额度、上下文超限）不变。

- `id`：现有的 resource、createdElsewhere、ownership 规则。
- `cipher`：错误文本表明密文验证或解密失败（覆盖 `could not be verified`、`could not be decrypted or parsed`），且失败请求中至少有一项带 `encrypted_content` 的 reasoning。不再要求错误点名 ID。
  - 错误中出现 `<前缀>...<后缀>` 形式的片段（两侧各至少 4 个 base64url 字符）时，请求中必须有一项密文以该前缀开头、以该后缀结尾，否则判定错误不属于本请求，不修复。
  - 没有片段时，按已有的请求与失败消息关联接受。

### 修复

- `cipher`：失败请求中所有 reasoning 项密文的 SHA-256 加入密文隔离集合；同时把失败请求中的全部上游 ID 加入 ID 隔离，与 `id` 修复相同。否则 `fc_`、`msg_` 项会因缺少配对的 reasoning 被拒。
- 请求投影：密文哈希命中的 reasoning 项整项移除；其余项按现有规则只移除命中的 `id`。正文、`phase`、`call_id`、`arguments` / `input`、工具输出和定义保持原样。只复制根对象和 `input` 数组；没有变化时沿用原 payload。
- 切换后由当前账号产生的新 reasoning 不在集合内，照常重放。

### 隔离记录

- 记录升为 `version: 2`：`{ version: 2, scope, ids, ciphers }`，`ciphers` 为 SHA-256 hex 列表。
- 读取时 `version: 1` 视为 `ciphers: []`；其他格式照旧抛出 `Invalid Responses isolation record`。
- 不保存密文、payload 正文或认证信息。

### 修复阶段

- 同一阶段内 `id` 与 `cipher` 各最多修复一次，成功响应结束阶段。因此一个阶段最多两次修复，保证终止。
- 修复必须带来新的隔离项（新 ID 或新密文哈希），否则不修复。
- 在途请求记录投影后请求中的上游 ID 和 reasoning 密文，仅保存在内存。`beforeSettle` 的前提由“`ids` 非空”改为“本次修复种类有可隔离的对象”。

## 影响范围

- 代码：`src/runtime/responses/payload.ts`、`src/runtime/responses/index.ts`。
- 测试：`tests/runtime/responses-recovery.test.ts`。
- 文档：`doc/current/runtime/responses-recovery.md`，以及 `docs/{en,zh}/configuration.md` 的 OpenAI Responses 恢复一节。

## 约束

- 只使用公开事件和 session entry，不修改宿主或 Provider adapter。
- 单文件不超过 500 行。

## 验收

- 新增一条契约测试，使用真实 SSE fixture，覆盖两个场景：
  1. 单独的密文错误：cpa 格式包装的报错，片段与 seed 密文匹配（`ciph...atim`）。修复后的请求不含 reasoning 项和上游 ID，其余 input 与失败请求一致；隔离记录 1 条，`ciphers` 含 seed 密文的哈希；Goal 完成；工具不重复执行。
  2. 同一阶段先资源 ID 错误、后密文错误：两种修复各发生一次，第三次请求成功，隔离记录 2 条。
- 片段与请求中任何密文都不匹配的密文错误不修复，作为一项加入现有“ordinary API errors”用例的 cases 列表。
- 现有 responses-recovery 测试和 typecheck 通过。

## 任务

- [x] 代码与测试
- [x] 文档同步
- [x] 在 cpa 网关的实际会话中验证：出现 `The encrypted content … could not be verified` 后自动继续
