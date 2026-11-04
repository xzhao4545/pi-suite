# 批量提问、多选与推荐

目标：一次收集多个独立回答，并明确推荐、选择和提交的区别。

当前状态：已完成。批量题目、独立题型、推荐标记与最终确认已接入 ask_user。

影响范围：questions、options、选项 ID、推荐展示与批量确认。

约束：默认每批最多 4 题；每题独立开启多选，推荐标记不改变提交规则。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 保留 2–4 题批量调用与每题配置
- [x] 实现题目切换及最终确认页
- [x] 添加稳定选项 ID 和推荐标记
- [x] 保留切题后的草稿、勾选和原始答案值

## 验收方式

核对不同题型混合、切题和批量确认；推荐显示不污染答案 ID 或自动提交。

## 关联计划

- [询问交互](../../../todo/pi-suite/ask/interaction.md)
- [默认答案与预选](default-answers.md)

### 4.1 批量提问、多选和推荐选项

沿用上游 `questions` 批量调用能力：当前上游一次支持 2–4 个相互独立的问题，每题各自设置 options、allowMultiple 和 allowFreeform。批量调用中的顶层 allowMultiple 不作用于各题，不能让模型误以为它开启了全部问题的多选。

手机默认显示当前问题和进度，通过题目切换和最终确认页完成整批回答；不把所有问题和选项同时堆在聊天区域。切换时保留每题草稿和勾选结果。第一版保留最多 4 题的默认上限。

上游 options 目前只有 title 和可选 description，没有 recommended 或 defaultValue 的结构化参数。标题中写“推荐”只能作为展示文字，不能作为稳定的选项元数据。

自定义包新增可选稳定选项 id 和 `recommended: true`：

```json
{
  "questions": [
    {
      "question": "使用哪种数据库？",
      "options": [
        {"id": "postgres", "title": "PostgreSQL", "recommended": true},
        {"id": "sqlite", "title": "SQLite"}
      ]
    },
    {
      "question": "启用哪些检查？",
      "allowMultiple": true,
      "options": [
        {"id": "types", "title": "类型检查", "recommended": true},
        {"id": "tests", "title": "单元测试", "recommended": true}
      ]
    }
  ],
  "timeout": 0
}
```

以上接口由本包提供；上游不能直接识别 recommended 语义。推荐选项显示推荐徽标，推荐理由可以放在 description；多选允许标记多个推荐项。推荐标记与默认勾选、最终提交分开，推荐本身不自动勾选或提交，超时也不采用推荐值。默认答案和预选项按照[默认答案和预选项方案](./default-answers.md)中的独立参数初始化。

返回结果保留选项 id 和原始标题；“推荐”徽标不拼入实际答案值，避免改展示文案或标题导致答案身份变化。

## 验收结论

混合单选、多选和文本的批量调用、独立默认值、切题保留勾选及文本、整批最终确认与原始选项 ID/标题返回已通过 Windows/Linux 的离线 TUI 检查。推荐标记不会自动选中；批量顶层题型或默认参数会报告错误。完整交互及模型等待联动的综合验收继续维护在 [实施计划](../../../todo/pi-suite/implementation.md)。
