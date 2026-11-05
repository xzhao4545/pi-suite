# job 输出读取、搜索与截断

目标：模型能用有限 token 读到 job 输出中需要的部分：默认看到开头、结尾和错误行，按需分页或搜索，PTY 输出转为可读文本。

当前状态：实施中；共享默认截断、offset 分页与搜索已通过两平台基础检查（含 100 MiB 日志）。关键行前后上下文、truncated.keys 原始范围、超长返回文本的字节预算及 agent_read/job_read 实际续读提示通过 Linux SDK 聚合检查；统一 job 读取位于 src/jobs/output.ts。PTY 密码提示至换行的回显隐藏、横向重绘、全屏提示与完成预览通过 [读取组合阶段](../../../finished/pi-suite/jobs/output-core.md) 的 Linux 真实 PTY/通知验收；垂直光标、全屏线性片段与同进程最后屏幕的支持范围已由 [屏幕范围阶段](../../../finished/pi-suite/jobs/screen-range.md) 明确，完整二维历史还原不在 reader 范围内。[超长逻辑行阶段](../../../finished/pi-suite/jobs/long-line.md) 核对了 100 MiB 单行全文匹配、线性组装和明确的正则资源失败；Windows 与真实手机 SSH 组合验收待完成。

影响范围：JobStore 日志读取、PTY 可见文本转换、job_read 与 agent_read、完成通知摘要。

约束：偏移始终是原始日志字节，保证分页可续读；转换与截断只影响返回内容，不修改日志；输出是不可信数据，不作为指令。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 默认读取：小日志全量，大日志返回头部、尾部和中段关键行，并标注省略范围
- [x] 显式 offset 分页读取，处理 UTF-8 边界
- [x] search/context 正则搜索，流式扫描大日志并限制匹配数量
- [x] PTY 输出转为可见文本：去除控制序列、按回车和横向 CSI/BS 覆写、折叠进度刷新（Linux 真实 PTY）
- [x] agent_read 复用同一读取、搜索与截断实现（Linux 真实 SDK child 默认截断、UTF-8 连续分页与搜索累计命中）
- [x] 关键行包含前后各 1 行，返回所选 keys 原始范围；搜索按正文、上下文与前缀合计字节预算，实际 more 提示保留 search/context/limitBytes
- [x] 验证密码回显隐藏、横向 CSI/BS/字素重绘、重复行和全屏标志的真实 PTY 组合，以及至多 2 KiB 的结算预览（Linux 真实 PTY；既有真实 SDK 通知聚合核对预览同条投递）
- [x] 核对大单逻辑行的完整正则搜索内存及性能边界（100 MiB 单行、中文跨块、全文锚定与续读；组装线性，单行内存随行长增长，V8 资源失败明确报错）
- [x] 明确垂直光标与全屏程序历史输出的线性还原支持范围（Linux 真实 PTY；线性 reader 不保证二维画面，同 owner 当前/最后屏幕复用既有 xterm，重启仅有历史日志）
- [ ] Windows 与真实手机 SSH 综合验证上述读取及终端边界

## 验收方式

用 1 KiB、1 MiB 和 100 MiB 日志核对默认读取的头尾与关键行、省略标注和续读偏移；中文与 emoji 跨页边界不出现乱码；搜索命中计数、上下文行和匹配上限正确；PTY 的同物理行进度条与横向重绘在读取片段内转换为可见内容，垂直/全屏日志按线性片段读取，当前或最后画面通过既有 xterm 查看；偏移仍可用于原始分页，读取取消不影响 job。

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

limitBytes 默认 16384，最大 65536。pipe 默认读取 stdout 时，结果首行同时给出 stderr 大小，stderr 非空且退出失败时提示读取 stderr。job_read 与 agent_read 的 more 提示保留当前 search、context 和 limitBytes，搜索续读沿用原查询；省略的字段继续使用默认值。

## 智能截断

日志超过 limitBytes 时，默认读取在预算内组合三部分：

1. 头部约 20%：命令启动输出、配置与版本信息。
2. 中段关键行约 30%：按行匹配 error、fail、fatal、exception、traceback、panic、denied、not found、warning、exit code 等常见模式（不区分大小写），每处带前后 1 行，从中段开头到结尾按出现顺序取，超出预算时保留首个与最后若干个匹配。
3. 尾部约 50%：最终结果与错误摘要。

各部分之间插入省略标记，写明省略的字节范围与匹配行数，例如 `[… 3.2 MiB omitted (bytes 4096–3359012), 41 matching lines, read with offset or search …]`。头尾各自按行边界与 UTF-8 边界裁齐。返回的 truncated 包含 head、所选 keys 范围数组、tail、omittedBytes 和 keyLines；keys 指向原始日志中匹配行及其上下文，供模型用 offset 精确续读。过长关键行或上下文按 UTF-8 边界裁剪并标注 truncated，仍为匹配正文保留配额；省略说明等固定标记在正文分配外占用少量字节。

运行中的 job 默认读取同样适用；尾部随输出增长变化。完成预览使用同一 reader 生成并通过共享 boundedText 限制在 2 KiB 内，在 job 终态发布前捕获，由既有结算通知路径发送；pipe 同时包含 stdout/stderr，PTY 使用密码隐藏后的 output，不新增通知队列。

## 搜索

search 为正则字符串，可写成 /pattern/flags，省略 flags 时不区分大小写；context 默认 2、最大 20。按固定块读取并逐行扫描日志，最多返回 50 个匹配或 limitBytes 字节；计费包含上下文、行号、偏移前缀与分隔符，超长行显式裁剪，超出时返回下一未处理原始行的 nextOffset，从该位置继续搜索。每个匹配返回行号、该行起始字节偏移与上下文。无效正则返回 INVALID_ARGS。PTY 输出先隐藏密码回显再转为可见文本匹配，返回偏移指向原始日志。

完整 JavaScript 正则匹配需要保留单条逻辑行；reader 只扫描新读入的块，遇到 LF 或 EOF 时合并一次，组装为线性成本。匹配使用完整文本，返回和暂存上下文才按预算裁剪；单行缓冲与解码内存随最长逻辑行增长。100 MiB 文件的单行普通正则、末尾锚定、中文跨块、原始 offset 续读和默认预算通过 Linux 验收。

Node.js 24.22.2 的 V8 在 100 MiB 含中文单行与 `/^START.*END$/u` 组合下可触发 `Maximum call stack size exceeded`；求值 RangeError 返回 REGEX_RESOURCE_LIMIT，包含该行原始字节数、offset、引擎错误与分页建议，整次搜索失败。不会静默裁剪匹配输入、漏报为零命中或替换引擎；任意正则及行长不承诺常量内存或执行时间，可用原始 offset 分页按需读取。

## PTY 可见文本

PTY 日志保存原始字节。读取与搜索前逐行转换：

- 在去除传输控制序列前处理横向 CSI 的列定位、左右移动和行清理，以及 CR、BS；换行保留，制表符按终端列展开。
- 回车和横向重绘按终端列覆写当前行，中文宽字素与组合字素按 Pi 可见宽度处理，进度条等反复刷新保留最终可见内容；转换规则以上游 normalizeSelectorVisibleText 为基础扩展。
- 连续重复的相同行折叠为一行并标注重复次数。
- 识别 password、passphrase、passcode、PIN、密码或口令等带冒号/问号的提示，提示之后至下一个 LF 的回显以等量空白隐藏；从提示之后的原始 offset 开始分页或搜索也沿用该行上下文。原始日志保持原字节，sensitive 输入不写入 input 通道正文。

可见文本转换只处理当前读取片段内单条物理行的横向操作；垂直移动、跨行定位、清屏与备用屏幕切换不会回写已输出的线性行，文本片段可能包含已覆盖的内容，不能作为最终二维画面。搜索和完成预览使用同一转换范围，原始日志字节与 offset 保持原值。

PTY 会话通过已有 xterm headless 曾进入 alternate buffer 的标志记录 fullScreen，程序返回主屏后该标志仍保留。读取结果提示通过 /jobs 查看当前或最后屏幕：同 owner 运行时的 attach 视图复用该屏幕缓冲，结束/停止后保留释放时的当前 viewport 与退出提示；如果程序已返回主屏，最后屏幕就是主屏。重启后历史仅有日志，没有屏幕与 PTY 控制权。现有 xterm 和上游 SerializeAddon 保存当前缓冲状态，不保存被覆盖的历史帧；完整二维历史还原不在 reader 支持范围内。

## input 通道

input 通道按 JSON Lines 记录发送时间、来源（model、user、parent agent）、方式（text、keys、paste）和内容；sensitive 输入只记录时间、来源与已发送标记。读取时转为每条一行的文本，同样支持 offset 与 search。

[返回执行任务待办](index.md)
