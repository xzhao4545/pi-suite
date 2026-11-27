# 技能

[文档索引](index.md)

本包通过 `pi.skills` 发布两个技能。Pi 在系统提示中列出它们的名称和说明，任务匹配时模型会阅读全文。

| 技能 | 用途 |
| --- | --- |
| [`pi-suite-jobs`](../../skills/pi-suite-jobs/SKILL.md) | 后台命令、交互式 CLI 和受监督的编码 agent 终端：选择 pipe 或 PTY、输入、有界日志、等待、监视器、终端交接、停止和历史清理。 |
| [`pi-suite-workflow`](../../skills/pi-suite-workflow/SKILL.md) | 编写、运行、迭代和恢复 `agent_workflow` 脚本。只在用户明确选择多代理编排后阅读。 |

即使相关模块被禁用，技能仍可被发现。`pi-suite-jobs` 技能要求模型先核对有哪些 job 工具；缺少所需工具时，有 `ask_user` 就用它询问用户，否则说明限制，不自行修改配置。
