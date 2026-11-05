# 子代理定时调度基础阶段

按职责导入 @tintinweb/pi-subagents 0.23.0 的 schedule.ts、schedule-store.ts、ui/schedule-menu.ts 与 index.ts 调度接入。保留六字段 cron、相对/ISO 单次时间、周期、按会话恢复、绕过排队但计入池、普通 child 与后台通知，以及查看/确认取消。croner 锁定 10.0.1，nanoid 使用 node:crypto 替代。

时间解析不创建活动计时器，长延时向绝对期限分段重设。存储与 tasks 共用异步锁和原子 JSON 提交，损坏文件禁止覆盖；同一期限在锁内准入一次。类型和模型在触发时重新解析，不静默替换模型。调度开启状态同步工具 schema；取消使用共享原生值选择器。会话撤销取消未准入触发，已启动 child 和结算文件保留原归属，quit 等待 child 清理与调度落盘。

4 项 Linux SDK/faux 与真实计时器检查覆盖格式和边界、竞争准入与损坏文件、原生工具参数互斥、远期单次任务、长名称取消与 40/120 列、配置关闭、实际 once/interval/cron、满池时即时触发与计数、触发时更新的类型选项、普通 run 与通知，以及真实 new/resume/reload 和不可用模型错误。共享存储复用 tasks 的真实多进程锁与宿主会话检查。

Windows、真实 CLI/手机 SSH 与本地时区的综合调度场景由 [扩展专项](../../../todo/pi-suite/agents/extensions.md) 继续验收。稳定事实见 [定时调度](../../../current/agents/schedules.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。
