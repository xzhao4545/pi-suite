# 默认答案与预选项

目标：支持文本预填、单选预选和多选预勾选。

当前状态：已完成。三种默认值通过 ask_user 接入；Windows 与 Linux 的离线宿主及 TUI 契约检查通过。

影响范围：默认参数校验、首次初始化、筛选与回答提交。

约束：默认值只初始化一次；引用稳定 ID，用户确认后才提交。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 添加 defaultAnswer、defaultOptionId 和 defaultOptionIds
- [x] 校验题型、参数冲突和选项引用
- [x] 保留用户编辑与取消默认项的结果
- [x] 确保默认值不成为超时回退答案

## 验收方式

核对三种默认值、修改/取消、切题、搜索、缩放及超时；不得复活取消的默认项。

## 关联计划

- [批量与多选](batch-selection.md)
- [说明与滚动](../design/ask/details-scroll.md)

### 4.2 默认答案和预选项

新增三种明确的初始化参数。单题放在顶层，批量调用则放在各 questions 项内部，不在整批顶层设置默认答案。

| 参数 | 用途 | 行为 |
| --- | --- | --- |
| `defaultAnswer: string` | 自由输入的默认答案 | 预填输入框，允许直接确认或修改 |
| `defaultOptionId: string` | 单选预选项 | 初始选择指定选项 ID，允许修改后确认 |
| `defaultOptionIds: string[]` | 多选预选项 | 初始勾选指定 ID 集合，允许增加或取消后确认 |

选择题默认值引用稳定 options.id，不依赖展示标题、排序位置或筛选后的索引。自由输入默认值适用于没有 options 的问题；有 options 时只在 allowFreeform 为 true 时允许，并直接进入自由输入模式。同一题不能同时配置自由输入默认值和选项预选值；单选与多选参数必须匹配 allowMultiple，引用不存在的选项应在展示前报告参数错误。

例子：

```json
{
  "question": "使用哪种数据库？",
  "options": [
    {"id": "postgres", "title": "PostgreSQL", "description": "适合服务端并发访问和复杂查询。", "recommended": true},
    {"id": "sqlite", "title": "SQLite", "description": "配置简单，适合单机或轻量应用。"}
  ],
  "defaultOptionId": "postgres"
}
```

```json
{
  "question": "启用哪些检查？",
  "allowMultiple": true,
  "options": [
    {"id": "types", "title": "类型检查"},
    {"id": "tests", "title": "单元测试"},
    {"id": "lint", "title": "Lint"}
  ],
  "defaultOptionIds": ["types", "tests"]
}
```

```json
{"question": "分支名称是什么？", "defaultAnswer": "feature/pi-suite"}
```

默认值只初始化一次。切题、搜索、查看说明、隐藏面板和终端缩放不重置用户编辑或勾选。多选使用实际勾选集合提交，不把当前光标所在项当成隐式选中，不复活已被用户取消的默认选项。推荐、键盘焦点、实际选择和最终提交分别记录。

用户明确确认后才提交；仅存在默认值不会自动回答。无回答超时仍为 timed_out，默认值不作为超时回退答案。

## 验收结论

单选、多选、文本默认值与冲突校验、切题编辑、多选取消默认项、搜索隐藏预选项、终端缩放和超时不作答均通过离线契约检查。适用范围为 Pi 1.5.0、新作用域依赖、Windows 与 Linux。当前操作与接口见 [ask](../../../current/ask/index.md)；Windows 全部业务面板并存的综合验收统一维护在 [Windows 待办](../../../todo/pi-suite/index.md)。
