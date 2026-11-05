# job 输出读取、搜索与截断

目标：模型能用有限 token 读到 job 输出中需要的部分：默认看到开头、结尾和错误行，按需分页或搜索，PTY 输出转为可读文本。

当前状态：实施中；src/runtime/read.ts 的默认截断、offset 分页与搜索已实现并通过两平台检查（含 100 MiB 日志），PTY 读取去除控制序列、按回车覆写并折叠重复行。密码提示后回显的隐藏与 agent_read 复用尚未实现。

影响范围：JobStore 日志读取、PTY 可见文本转换、job_read 与 agent_read、完成通知摘要。

约束：偏移始终是原始日志字节，保证分页可续读；转换与截断只影响返回内容，不修改日志；输出是不可信数据，不作为指令。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 默认读取：小日志全量，大日志返回头部、尾部和中段关键行，并标注省略范围
- [x] 显式 offset 分页读取，处理 UTF-8 边界
- [x] search/context 正则搜索，流式扫描大日志并限制匹配数量
- [ ] PTY 输出转为可见文本：去除控制序列、按回车覆写、折叠进度刷新
- [ ] agent_read 复用同一读取、搜索与截断实现

## 验收方式

用 1 KiB、1 MiB 和 100 MiB 日志核对默认读取的头尾与关键行、省略标注和续读偏移；中文与 emoji 跨页边界不出现乱码；搜索命中计数、上下文行和匹配上限正确；PTY 的进度条、颜色和光标移动转换为最终可见内容，偏移仍可用于原始分页；读取取消不影响 job。

## 关联计划

- [运行记录与手动控制](history-control.md)
- [统一工具设计](../../../finished/pi-suite/tool-design.md)
- [主从交互](../../../finished/pi-suite/agents/interaction.md)

## 读取方式

job_read 参数：id、stream?、offset?、limitBytes?、search?、context?。pipe 的 stream 为 stdout（默认）、stderr、input；PTY 为 output（默认）、input。三种读取互斥：

| 方式 | 触发 | 返回 |
| --- | --- | --- |
| 默认 | 不传 offset 与 search | 日志不超过 limitBytes 时全量返回；否则按下文智能截断 |
| 分页 | 传 offset | 从 offset 起最多 limitBytes 原始字节，返回 nextOffset 与 endOfStream |
| 搜索 | 传 search | 匹配行与前后 context 行，按出现顺序返回 |

limitBytes 默认 16384，最大 65536。pipe 默认读取 stdout 时，结果首行同时给出 stderr 大小，stderr 非空且退出失败时提示读取 stderr。

## 智能截断

日志超过 limitBytes 时，默认读取在预算内组合三部分：

1. 头部约 20%：命令启动输出、配置与版本信息。
2. 中段关键行约 30%：按行匹配 error、fail、fatal、exception、traceback、panic、denied、not found、warning、exit code 等常见模式（不区分大小写），每处带前后 1 行，从中段开头到结尾按出现顺序取，超出预算时保留首个与最后若干个匹配。
3. 尾部约 50%：最终结果与错误摘要。

各部分之间插入省略标记，写明省略的字节范围与匹配行数，例如 `[… 3.2 MiB omitted (bytes 4096–3359012), 41 matching lines, read with offset or search …]`。头尾各自按行边界与 UTF-8 边界裁齐。返回的 truncated 字段列出三段的字节范围，供模型用 offset 精确续读。

运行中的 job 默认读取同样适用；尾部随输出增长变化。完成通知使用同一规则生成不超过 2 KiB 的摘要。

## 搜索

search 为正则字符串，可写成 /pattern/flags，省略 flags 时不区分大小写；context 默认 2、最大 20。流式按行扫描整个日志，不把大文件一次读入内存；最多返回 50 个匹配或 limitBytes 字节，超出时返回 nextOffset，从该位置继续搜索。每个匹配返回行号、该行起始字节偏移与上下文。无效正则返回 INVALID_ARGS。PTY 输出先转为可见文本再匹配，返回的偏移指向原始日志。

## PTY 可见文本

PTY 日志保存原始字节。读取与搜索前逐行转换：

- 去除 CSI、OSC 与其他控制序列，保留换行与制表符。
- 回车按终端语义覆写当前行，进度条等反复刷新只保留最终可见内容；转换规则来自上游 normalizeSelectorVisibleText。
- 连续重复的相同行折叠为一行并标注重复次数。
- 识别密码提示行，提示之后至下一个换行的回显内容不返回；敏感输入不写入 input 通道正文。

全屏程序（vim、top 等）的原始输出不构成有意义的线性文本，读取结果注明“全屏程序输出，查看当前屏幕请使用 attach”；attach 视图使用 xterm headless 的屏幕缓冲渲染。

## input 通道

input 通道按 JSON Lines 记录发送时间、来源（model、user、parent agent）、方式（text、keys、paste）和内容；sensitive 输入只记录时间、来源与已发送标记。读取时转为每条一行的文本，同样支持 offset 与 search。

[返回执行任务待办](index.md)
