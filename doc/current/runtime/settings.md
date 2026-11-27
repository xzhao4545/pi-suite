# 设置与退出操作

## `/suite`

TUI 使用 Pi 原生 `SettingsList`。输入文字搜索，用方向键选择，Enter 打开编辑，Esc 返回。字段来自[配置 schema](index.md#配置)。每项显示保存后的有效值、来源、默认值、用户值和项目值。模块和命令还显示本次加载时实际采用的值。非 TUI 只输出有效配置的 JSON。

1. 选择字段和要编辑的层。字段已有项目值时默认选项目层，否则选用户层。项目值存在时，修改用户值不会改变有效值。
2. 选择编辑方式：

   | 字段 | 编辑器 |
   | --- | --- |
   | 布尔、枚举 | 选项列表 |
   | 整数、文本、快捷键 | 输入框 |
   | 包白名单、CLI 预设、类型覆盖 | JSON 编辑器；`agents.types` 另可打开类型菜单 |

3. 保存时只修改选定层的字段。清除该层的值会删除字段和由此产生的空对象，使该层继承下层。配置必须通过校验；文件损坏或 I/O 失败会报错。写入见 [JSON 存储](index.md#json-存储)。
4. 用 `/reload` 应用通用设置。保存本身不重绑会话，也不停止执行。类型菜单的即时更新和 `Use definition` 清除两层启用覆盖的规则见[类型配置](../agents/models.md)。

`ui.highlightBuiltinCommands` 的范围见[命令结构高亮](../ui/command-highlighting.md)。主会话按配置目录保存显示选项的快照，`/reload` 重新读取。child 从 `run.config`（启动时的配置快照）取得此值，不按 child 执行目录重读。历史与 child 使用同一 renderer 登记和查询入口。

## `/exit`

`commands.exit` 控制是否注册 `/exit`，与业务模块开关独立。忙碌时，命令调用 Pi 的 `abort()` 取消操作，等 `waitForIdle()` 返回后再调用 `shutdown()`；空闲时直接请求关闭。Pi 原生退出流程恢复终端并触发 [`session_shutdown`](index.md#会话绑定)，等待后台执行清理。原生 `/quit` 始终可用。

[返回公共运行时](index.md)
