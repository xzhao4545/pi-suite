# 公共运行时与配置

唯一扩展入口为 src/index.ts；工具、命令和宿主事件由入口与对应模块注册。当前工具为 ask_user、goal_complete、goal_blocked、goal_wait，命令为 /goal、/suite。

## 配置

配置按内置默认、用户文件 `<getAgentDir()>/pi-suite.json`、项目 `.pi/pi-suite.json` 的顺序覆盖，各节逐字段合并。getAgentDir() 遵循 Pi 的 PI_CODING_AGENT_DIR。缺失文件表示无覆盖；无效 JSON、未知字段、数值范围错误及读取失败会报告错误。

```json
{
  "modules": { "ask": true },
  "ui": { "maxRows": 6 },
  "ask": { "timeout": 120000, "historyKey": "ctrl+h" },
  "goal": { "display": "status" },
  "agents": { "display": "status" },
  "jobs": { "display": "status", "detachKey": "ctrl+b", "returnKey": "ctrl+g", "transferKey": "ctrl+t" }
}
```

modules.ask、modules.goal 与 modules.jobs 在扩展加载时决定是否注册对应模块；改变开关后使用 /reload。会话绑定时重新读取配置。maxRows 范围为 1–6；timeout 为 0–2147483647 的整数毫秒，0 不设期限。historyKey 与 jobs 终端视图的 detachKey（离开视图）、returnKey（交还模型）、transferKey（发送屏幕）使用 Pi 的按键标识。公共显示配置接受 status/dock/hidden，不接管 footer。

## 会话和通知

SessionBinding 为当前主会话保存上下文、会话 ID 和绑定代次。session_start 建立绑定；session_shutdown 保存目标、取消询问、清除本包 UI 并撤销绑定。session_tree 在所选分支恢复目标并更换绑定，不向所选分支写入离开分支的目标。旧绑定的排队询问不得在新会话展示。

Notifications 按主会话 ID 保存消息，以请求 ID 合并尚未投递的通知。询问与目标详情占用阻塞令牌；释放后仅在当前宿主 idle 且没有待处理消息、目标允许自动工作时投递合并 follow-up。非当前会话的通知保留到对应会话绑定。agent_before_settle 的 completed 边界把合并消息作为一份 custom_message 请求一次继续；已存在宿主继续或待处理消息时保留批次。agent_settled 检查 idle 投递。Pi 1.5.0 的手动压缩与树切换成功事件先于 busy 标记清除，仅在这些事件存在待投递消息时使用受绑定代次限制的短期 idle 检查。界面查看器没有模型调度或进程控制权。

[返回当前文档](../index.md)
