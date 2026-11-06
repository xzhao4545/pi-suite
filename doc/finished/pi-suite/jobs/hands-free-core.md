# PTY hands-free 与 dispatch 基础阶段

目标：按上游保留范围，把 PTY 增量监督与一次性委派接入长期 JobManager、统一通知和共享等待。

## 完成项

- [x] 从 pi-interactive-shell 0.18.0 提取静默、宽限期与增量预算状态机，删除语义监督，接入同一 JobManager；timeout 与停止复用既有后端。
- [x] job_start.handsFree 配置 onQuiet/interval 更新、单次与总字符预算，超限保留增量尾部，用尽后仅状态。
- [x] dispatch 默认在宽限期后静默终止，实际退出才结算，明确 completionReason=quiet、timeout、exited 或 stopped。
- [x] 用户接管暂停更新与静默终止、撤销排队更新；交还恢复计时，不清零预算和运行期限。
- [x] 更新复用共享通知，以请求 ID 合并；wait 提前返回并撤销通知；goal_wait 接收被等待 job 的更新。
- [x] Linux 离线验证增量预算、定时器与暂停/释放、真实 PTY 静默终止的清理证据、宽限期、超时、自行退出，以及 reload 后目标唤醒和通知去重。

适用范围：Pi 1.5.0、Linux 现有 Node.js 24 环境。Windows 上的监督验收、CLI agent 预设与 launchPolicy 保留在 [监视与委派待办](../../../todo/pi-suite/index.md)；本阶段不代表完整 jobs 专项完成。

当前实现与操作见 [PTY 监督与委派](../../../current/jobs/hands-free.md)，来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

[返回完成索引](../../index.md)
