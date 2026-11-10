# 交互与生命周期细化

## 状态与权限

本专项记录用户新增的七项需求及可行性分析，尚未实施。方案仅使用官方 Pi 1.5.0 的公开 UI/生命周期能力并复用现有 Ask、GoalManager、TaskStore 和 reading 框架，不修改宿主；完成权限、停止范围和任务清理策略在实施前确认。

## 需求与方案索引

- [Ask 返回和题目字段](ask.md) — 区分模型正文与本地 details，精简题号/短题目/选中答案，题目 context 的去留。
- [Goal 完成与退出恢复](goal.md) — 非 active 的结案权限、stopped 状态、正常退出和冷恢复，保留绑定与取消代次。
- [Tasks 完成后清理](tasks.md) — 单项/整组/整清单粒度、退役与物理删除、编号和执行引用。
- [Subagents 导航和底部高度](reading.md) — 关闭/重建 overlay 的绘制间隙、共享导航交接、1/2 行自适应状态区。

## 任务列表

- [ ] 1. 确认 Ask 简短返回格式，实施后验证实际模型 content，不把本地 details 或原始调用参数当成回传正文。
- [ ] 2. 确认题目字段仅删除 context 还是同时取消选项 description，再同步 schema、UI、renderer 与操作说明。
- [ ] 3. 为非 active Goal 增加独立完成授权，不借 resume 启动工作，不绕过 ID/revision/Binding/取消代次校验。
- [ ] 4. 定义 quit 后 stopped 和手动恢复规则，覆盖异常退出后的冷加载，不把 reload/普通切换当退出。
- [ ] 5. 确认 Tasks 清理粒度、历史保留与编号策略，在 Store 原子事务和 owner 权限内实现。
- [ ] 6. 在共享 reading 导航中消除主会话中间帧，保留旧页面至新页就绪及焦点/生命周期清理。
- [ ] 7. 按底部信息实际行数回收正文预算，保证首次末尾、暂停、搜索、Editor 和 resize 不回归。
- [ ] 实施后使用必要契约及真实官方 CLI 的中间帧验收，局部同步 current，归档并提交。

[返回待办索引](../index.md)
