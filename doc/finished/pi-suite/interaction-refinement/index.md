# 交互与生命周期细化

## 状态与权限

本专项记录用户新增的七项需求及可行性分析，全部七项源码、测试与文档实施及逐项验收已完成。用户已确认只删除题目 context、Tasks 全部完成后清空且不保留历史并允许模型主动清空、`/goal stop` 停止并保留目标。方案仅使用官方 Pi 1.5.0 的公开 UI/生命周期能力并复用现有 Ask、GoalManager、TaskStore 和 reading 框架，不修改宿主、不执行安装验收。Tasks 清空后编号从 1 开始，以清单代次使旧引用失效且不停止 child/job；首次启用也处理当前会话已全部完成的存量清单，不扫描其他会话或工作区，不清理持久 fork 源清单。

## 需求与方案索引

- [Ask 返回和题目字段](ask.md) — 区分模型正文与本地 details，精简题号/短题目/选中答案，题目 context 的去留。
- [Goal 完成与退出恢复](goal.md) — 非 active 的结案权限、stopped 状态、正常退出和冷恢复，保留绑定与取消代次。
- [Tasks 完成后清理](tasks.md) — 全部完成/owner clear、原子清空、重新编号、清单代次和执行引用。
- [Subagents 导航和底部高度](reading.md) — 关闭/重建 overlay 的绘制间隙、共享导航交接、1/2 行自适应状态区。

## 验收结论

七项逐条证据与适用范围见 [专项验收](validation.md)。当前 Ask、Goal、Tasks、Agents 与 UI/终端操作文档已局部同步；用户会话源、执行 owner、官方宿主和全局配置保持边界。消费者安装验收继续按用户指示延期。

## 任务列表

- [x] 1. 确认 Ask 简短返回格式，实施后验证实际模型 content，不把本地 details 或原始调用参数当成回传正文。
- [x] 2. 按用户确认仅删除题目 context，保留选项 description，同步 schema、UI、renderer 与操作说明。
- [x] 3. 为非 active Goal 增加独立完成授权，不借 resume 启动工作，不绕过 ID/revision/Binding/取消代次校验。
- [x] 4. 定义 quit 后 stopped 和手动恢复规则，覆盖异常退出后的冷加载，不把 reload/普通切换当退出。
- [x] 5. 全部完成或 owner 主动 clear 后不保留任务历史、编号重置及旧引用失效，在 Store 原子事务内实现。
- [x] 6. 在共享 reading 导航中消除主会话中间帧，保留旧页面至新页就绪及焦点/生命周期清理。
- [x] 7. 按底部信息实际行数回收正文预算，保证首次末尾、暂停、搜索、Editor 和 resize 不回归。
- [x] 实施后使用必要契约及真实官方 CLI 的中间帧验收，局部同步 current，归档并提交。

[返回已完成专项](../../index.md)
