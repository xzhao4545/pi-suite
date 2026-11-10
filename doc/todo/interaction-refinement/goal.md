# Goal：非运行结案与退出手动恢复

## 根因

`src/goal/manager.ts` 的 complete 共用 requireOwned：先要求 status=active，再校验当前 runGoalId、revision 与 Binding。NOT_RUNNING 是错误代码，不是可写的 Goal 状态。仅删除 active 校验仍会因 beforeStart 不关联非 active 目标或结算撤权而被拒绝；删除 ownership 则会放行旧请求或非所属运行。

Suite 在 session_shutdown 对 Goal 调用无 reason 的 shutdown，它只保存和解绑；restore 忽略 reason，读取 active+automatic 后请求继续或恢复 deadline。界面 schedule 的 detached 不等于持久 Goal stopped。正常 quit 与异常终止也不同：SIGKILL/紧急退出不能保证执行保存，因此只修改退出 handler 不足以保证冷启动不续跑。

## 完成方案

由 GoalManager 区分“执行权限”和“结案权限”：

- wait/block/自动执行维持 active 要求。
- complete 可覆盖 failed、paused、blocked、budget_limited 以及拟新增 stopped；仍需当前精确目标 ID、revision、所属会话 Binding 和本轮请求/取消代次匹配。
- 新的用户驱动审计轮可取得仅结案关联，不把 automatic 设为 true、不执行 resume；旧请求、撤销绑定、其他 child/会话继续拒绝。
- completed 可定义为幂等，不改已完成时间或重放反馈；无目标/错误 ID 仍不能完成。
- 若必须由机器判定用户明确授权结案，可增加 `/goal complete <证据>`，复用同一转换；它与模型完整验收是不同权限入口，不通过自然语言猜测授权。

## 退出与恢复方案

增加持久 stopped（或先确认是否复用 paused+原因）并使生命周期按 reason 分派：quit 前取消目标请求/等待监听，冻结耗时，撤销自动许可，清除自动恢复期限，保存停止状态；正常 reload/new/resume/fork/tree 使用其独立绑定规则。

冷加载即使发现崩溃遗留的 active，也转换为要求手动恢复的状态，不自动请求、注册 deadline 唤醒或因普通输入重新获取自动许可。`/goal resume` 明确恢复；预算耗尽仍需先调整预算。持久 Goal 通过正常 append 状态恢复，不重写源会话；内存 Goal 不为此偷偷落盘。

停止时保留目标文本、进度、用量、耗时与错误。推荐仅把 active/自动等待转换为 stopped，failed/blocked/paused/budget_limited 保留其原因；若用户要求所有未完成目标都写 stopped，需同时保留停止前状态/错误，不能抹掉故障信息。completed 不应被退出改为未完成。

`/goal stop` 当前是 clear 的别名，需要确认是否改成“停止并保留目标”，将删除仅留给 `/goal clear`。

## 待确认与任务

- [ ] 确认非运行目标的结案由用户审计轮直接调用工具，还是还需要显式 complete 命令。
- [ ] 确认退出统一 stopped 的状态范围，以及 stop/clear 命令语义。
- [ ] 在现有 Manager/状态 schema/生命周期实现权限和 reason-aware 转换；旧记录不得校验失败后静默当空数据。
- [ ] 验证正常 quit、强杀冷恢复不续跑、reload 保持原合同、显式 resume、旧请求完成拒绝及迟到结算。
- [ ] 同步状态摘要、参数指引和操作说明，不绕过 ownership 或修改宿主。

[当前 Goal 生命周期](../../current/goal/lifecycle.md) · [操作与接口](../../current/goal/operations.md) · [返回专项](index.md)
