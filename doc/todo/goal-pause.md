# Goal 暂停与用户轮

## 问题

目标暂停后，用户发消息，模型常常不处理请求，而是要求先 `/goal resume`。

工具层没有拦截普通工具，原因在两处：

- `src/goal/context.ts` 注入给模型的规则写着"只有 execute 权限允许 automatic work""complete 权限只能审计，不能恢复执行"。暂停时用户轮拿到 complete 权限，模型把它理解为这一轮不能干活。`goal_wait`/`goal_blocked` 的 `NOT_RUNNING` 错误信息（`src/goal/manager.ts`）也写着"execution requires /goal resume"。
- 需要显式 resume 的暂停原因过多：除 Esc、提问取消和 compact 失败外，外部阻塞、请求失败、自动保护、退出和启动都要求 `/goal resume`，用户的新消息只能"审计"。

## 设计

### 暂停只停止自动续跑

- 暂停的目标不再自动安排下一轮，`goal_wait` 与 `goal_blocked` 不可用。
- 用户发来的轮次是正常工作轮：模型按用户要求做事，可以使用所有普通工具；这一轮结束后不会自动续跑。所有要求都已验证时可以调用 `goal_complete`。
- 注入规则与 `NOT_RUNNING` 文本按此重写（由父会话撰写，见文本清理）。

### 用户消息恢复的范围

| 暂停原因 | 用户新消息后 |
| --- | --- |
| 手动 `/goal pause`、预算用完、退出（`shutdown`）、启动载入（`startup`）、历史停止（`historical_stop`）、`permission` | 保持暂停，需要 `/goal resume`；预算用完还需先调高预算 |
| 外部阻塞、最终请求失败、无工具活动、重复工具活动、Esc/提问取消、compact 失败 | 恢复自动续跑，自动保护计数重置 |

这一划分只由暂停原因决定。实现时以暂停原因推导是否需要显式恢复，不在各调用点分别传参。`resumeRequired` 字段删除，旧记录在读取时丢弃它。压缩成功不再恢复暂停的目标，只有用户消息与 `/goal resume` 能恢复。

## 验收

- 暂停（任一原因）后用户发消息，模型收到的规则允许它处理该消息；`goal_wait`/`goal_blocked` 返回 `NOT_RUNNING`。
- 上表两类原因的恢复行为各有测试覆盖；重启后首条消息不恢复自动续跑。
- typecheck 与 goal 相关测试通过；`doc/current/goal/` 与 `docs/*/modules/goal.md` 同步。

## 相关 current 文档

[Goal 生命周期](../current/goal/lifecycle.md)、[请求与续跑](../current/goal/context.md)、[Goal 操作](../current/goal/operations.md)

## 任务列表

- [x] 暂停原因推导显式恢复要求，用户消息按表恢复
- [x] 重写注入规则与 `NOT_RUNNING` 文本
- [x] 测试与文档同步
