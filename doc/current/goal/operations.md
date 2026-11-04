# 接口与操作

| 命令 | 行为 |
| --- | --- |
| /goal <目标> | 建立目标并请求执行；替换未完成目标时由界面确认 |
| /goal --tokens 100k <目标> | 建立有显式 token 上限的目标，支持 k/m 数量单位 |
| /goal 或 /goal status | 查看完整文本、目标与调度状态、ID、用量、响应次数、耗时、进度和错误 |
| /goal edit <文本> | 修改目标文本与修订号；中止归属原修订的在途运行，按自动许可调度 |
| /goal edit --tokens 200k | 修改预算；达到上限立即限制；提高预算后使用 resume 恢复 |
| /goal pause | 显式暂停目标并中止归属该目标的运行 |
| /goal resume | 恢复未完成目标；已耗尽的预算需要先提高 |
| /goal clear 或 /goal stop | 清除目标、状态和期限，中止归属该目标的运行 |

目标文本最长 4000 字符；较长要求可引用文件。预算为正整数，省略时无限制。新用户输入可恢复 Esc 或询问未回答留下的 active 目标；明确 paused 等目标状态需使用 resume。

目标工具使用当前提示中的精确 goal_id，并由运行归属校验：

- goal_complete(goal_id, summary)：summary 提供逐项完成和验证证据；成功后 completed，并结束宿主循环。
- goal_blocked(goal_id, reason, evidence, repeated_turns)：同一外部障碍至少连续三轮，必须提供具体原因与证据；成功后 blocked，结束宿主循环。
- goal_wait(goal_id, reason, resume_after_ms?)：仅等待已安排的外部事件；可选 1–2147483647 毫秒单次期限；成功后 waiting_jobs，结束宿主循环。

完成判定仍需模型依据原目标逐项审计；运行归属与参数校验不能代替事实验收。普通未完成工作不能用 blocked 或 wait 替代推进。

详情通过 Markdown 与独立阅读位置呈现。↑/↓、PageUp/PageDown、Home/End 阅读，/ 搜索，n/N 查找下一/上一匹配；←/→ 选择 Previous page、Next page、Back，Enter 执行，Esc 关闭。关闭详情恢复 dock，不改变目标。

[返回目标管理](./index.md)
