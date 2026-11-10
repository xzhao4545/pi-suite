# Ask：简短回传与题目字段

## 当前边界

- `src/ask/result.ts` 的 askToolResult 返回 `content` 和 `details`：content 是状态与答案的简短文本；details 保存完整问题、context、全部选项和答案，供本地 renderer/历史使用。
- 官方 Pi 1.5.0 的 Responses 适配器使用 toolResult.content 生成 wire output，不把 details 自动序列化为模型文本。模型自己的 tool_call 参数仍包含它提出的问题/选项；不能把这部分上下文与工具结果混为一谈。自定义 Provider 的额外序列化须另按实际链路核对。
- 批量答案已包含题号、最多 60 个 Unicode 码点的题目摘要、所选标题及选项 ID；单题正文只有状态和答案。未选项及选项描述不在 content 中。自定义文本、补充评论、timed_out/skipped 的不授权标志及 parent 来源会保留。
- 题目没有名为 description 的数据字段，补充描述实际为 context；options[].description 是独立的选项说明。JSON Schema 的 description 是参数文档，不是题目内容。

## 建议方案

在现有 askToolResult 内统一单题/批量格式，不另建结果系统。例如：

```text
answered
1. 数据库方案 → PostgreSQL
2. 是否添加缓存 → 暂不添加
```

题目摘要建议缩短到约 24 字；答案、自定义文本和评论不因精简而丢弃。通常不回显自动生成的 option-N；同名选项需要保留紧凑序号/ID 消除歧义。仍明确保留 unanswered、自动提交/非授权和来源语义。完整 details 保留给 UI，不改写已有历史调用或会话。

若“题目不需要描述”仅指补充说明，则从单题及 questions[] 删除 context，同步 normalize、布局、详情、renderer 和参数指引；保留选项 description 及合法的 schema 参数文档。不把所有名称为 description 的属性统一删除。

## 待确认与任务

- [ ] 确认题目摘要长度及同名选项的紧凑身份表示。
- [ ] 确认只移除 context，还是也不需要选项 description；建议只移除题目 context。
- [ ] 局部实现格式与字段调整，保留四种结束状态、自定义/多选/评论和父级回答协议。
- [ ] 扩展现有 Ask 契约验证输出正文与本地详情分离，不新增无关测试或重写旧 JSONL。

[当前 Ask](../../current/ask/index.md) · [工具契约](../../current/runtime/tools.md) · [返回专项](index.md)
