# job 历史主动清理阶段

目标：允许用户明确删除已结算 job 的保存记录与全部日志，并保持执行控制和通知生命周期一致。

## 完成项

- [x] 执行协议可用的原生 job 操作菜单提供 Clear history，确认后调用同一 JobManager 和 JobStore.remove；取消确认保留历史，确认后删除单项元数据与所有输入/输出日志。
- [x] 只允许终态且 cleanup 非 pending/unconfirmed 的对象；JobStore 删除前重读磁盘状态，拒绝活动或未确认记录。
- [x] manager 等待实际 settlement、inputQueue 和 saveQueue，必要时保存最新终态；删除期间拒绝重复清理，并阻止晚写入与 reload 接管。
- [x] 删除撤销未送达结果/monitor 通知及 quietWakes；晚消费不重建目录，更新通知继续由已有生命周期处理。
- [x] 当前 manager 可删除保存的 foreign 历史记录，但没有历史进程控制权；只读 agents 历史隐藏 Clear history、attach 和 stop，受限执行协议隐藏 Clear history 与 attach，查询和停止继续通过既有控制桥处理。

1 项 Linux（Node 24.22.2）真实 SDK/进程聚合检查通过，覆盖拒绝边界、队列落盘与目录删除、通知阻塞期间撤销、原生取消/确认以及 foreign 历史清理。Windows 的查看流程、停止竞争与级联组合仍由 [历史控制专项](../../../todo/pi-suite/index.md) 验收。

历史保留至用户主动清理，不增加 TTL 删除、模型工具或控制桥协议。稳定操作见 [执行任务](../../../current/jobs/index.md#用户操作)。

[返回已完成专项](../../index.md)
