# 命令结构高亮

## 入口与范围

`src/ui/rendering/command.ts` 的 `CodeComponent` 有两种模式，由调用方显式指定：

- code 模式调用 Pi 的 `highlightCode`。
- command 模式由 `src/ui/rendering/shell/` 的 Bash/PowerShell 扫描器生成源码区间，再用调用方传入的 Pi Theme 着色。

语言不从内容猜测。扫描器不执行命令，不查 PATH、文件或磁盘，不联网。

| 显示位置 | 模式与配置 |
| --- | --- |
| 模型 bash/powershell 工具的调用区 | command，由 `ui.highlightBuiltinCommands` 控制，默认 true |
| Jobs 顶部命令、Suite 工具的 `ToolCommand` 字段 | command，始终开启，不受上一项影响 |
| `ToolCode`、JSON 与明确语言的代码 | code，Pi 原生高亮；language 为 bash/powershell 时也保持 code 模式 |
| 普通日志、工具输出、任意正文 | 字面量 |
| 用户输入的 `!`/`!!` | Pi 原生 `BashExecutionComponent` |
| 第三方 `renderShell: 'self'` 的工具 | 第三方自己的显示 |

主会话、child、Ask History 与 Transcript 通过同一份 renderer 登记使用这些规则；阅读历史不重新执行命令，也不修改 command、content 或 details。

内置调用区（`rendering/builtin-command.ts`）只替换显示：每次仍调用原生 `renderCall`，由它维护计时和参数诊断；原生工具外壳、结果、流式更新、截断、超时、图片和展开都由 Pi 处理。命令为空或不是字符串时显示原生调用区。调用行带可信前缀 `$ `（powershell 为 `PS> `），设置了 timeout 时带后缀 ` (timeout Ns)`。`renderShell` 为 `'self'` 或没有 `renderCall` 的定义不做替换。

`ui.highlightBuiltinCommands` 在每个 cwd 首次显示（或 session_start）时读取并固定，修改后执行 `/reload` 生效。false 时恢复完整的原生调用区，Jobs 与 Suite 命令字段仍然高亮。

## Shell 词法规则

### Bash

- 按简单命令位置区分程序与参数：行首、换行、分隔符、管道、控制结构、函数、分组与命令替换之后是程序位置。命令前的普通环境赋值与重定向不占用程序位置。
- 选项名与 `--key=value` 的值分开着色；`--` 结束选项区。负数按数字处理。不查询 CLI 参数定义，也不推断 `git diff`、`pnpm exec tsc` 等子命令。
- 单/双引号、常见 ANSI-C 引号、转义、续行、变量与位置参数、`${...}`、`$()`、反引号、算术与条件表达式各自保持上下文。双引号内 `${...}` 中的单引号是字面字符，不阻止变量插值。
- 注释只从合法的词边界开始，`file#name` 和引号中的 `#` 是字面字符。函数体和 case 的普通模式（包括可选的起始 `(`）不作为执行位置。
- heredoc 分隔符先做引用移除；支持常见引用、ANSI-C 字面分隔符、一行多个文档和 `<<-` 的制表符规则。未引用文档按逻辑行处理反斜杠续行，先确定完整正文边界，再在正文范围内扫描展开；引用文档整体为字符串。正文不作为外层命令，不猜测嵌入语言。

### PowerShell

- cmdlet、别名与外部程序都按执行位置识别；命名参数、比较运算符、变量、字面常量、类型、控制关键字和管道/调用/重定向按词法上下文区分。赋值右侧可以是命令管道；命令参数中的 `=` 不当作赋值。
- 完整的命令路径与普通参数路径保持为一个词，其中的 `/`、`:` 不按运算符着色。相邻的引号片段与反引号转义的空格不产生新的选项位置。
- 单引号与成对引号转义、双引号插值、反引号转义与续行、块注释与行注释、`$()`、分组、here-string 和常见类型边界按 PowerShell 规则处理；hashtable 的普通键不作为程序名。
- `&` 后接字面路径、变量或带引号的程序；`--%` 之后到行尾保持字面内容。比较运算符只在表达式上下文中识别，不覆盖程序的普通参数及 `--` 之后的字面值。

### 边界

- 未闭合的引号、展开、类型或正文按已经确定的上下文显示，不阻断流式命令，不修正源码。无法分类的内容使用基础代码前景；实现错误照常抛出，不被吞掉。
- 扫描器是展示用的词法识别，不是完整的 Shell AST、语法检查或执行语义分析。以下不保证精确分类：Bash extglob 等模式内部的复杂括号、数组赋值语义、异常 ANSI-C 控制字符或无效码点分隔符，PowerShell 完整的成员、泛型与声明语义。
- 嵌套结构用递归扫描，任意深度的恶意输入没有资源上界保证。

## 配色与缓存

| 区间 | 主题角色 |
| --- | --- |
| 程序/函数 | `syntaxFunction` |
| 控制关键字 | `syntaxKeyword` |
| 选项、类型 | `syntaxType` |
| 变量 | `syntaxVariable` |
| 字符串 | `syntaxString` |
| 结构符号（运算符、重定向、分组） | `syntaxOperator` |
| 数字、常量 | `syntaxNumber` |
| 注释 | `syntaxComment` |
| 普通参数与路径 | `mdCodeBlock` |

RGB 由活动主题决定，扫描器中不写死颜色。本包主题的配色见 [语法配色](themes.md#语法配色)。

处理顺序：

1. 文本经 `sanitizeText` 清理。
2. 扫描完整源码，生成有序、不重叠的区间；真实制表符保留到扫描结束（`<<-` 需要）。
3. 按区间着色。跨行的区间每个物理行重新设置前景色，因为 Pi 在行尾重置样式。
4. 把制表符展开为四个空格，加上可信前后缀（不参与扫描），交给 Pi `Text` 处理 ANSI、中文、emoji 和换行。

每个 `CodeComponent` 只缓存最近一份源码的结果：

| 变化 | 处理 |
| --- | --- |
| 源码、语言或模式 | 丢弃区间并重新扫描 |
| 主题或前后缀 | 重新着色 |
| 只有宽度 | 只重新布局 |

Pi 传入的是实时 Theme 代理，对象身份不变，所以组件用所用角色的 ANSI 序列拼成指纹来判断主题是否变化。`ToolBody` 按展开行的位置复用组件，同一行在 code 与 command 之间切换时会重新扫描。

扫描与着色是线性的；heredoc 的边界收集与正文展开为两遍线性处理。PowerShell 未闭合的嵌套类型只向前扫描一次，不在每个 `[` 处重试。缓存属于组件，没有进程级源码缓存。

## 验证范围

语义检查覆盖代表命令、引用/嵌套/heredoc/流式边界、模式切换、主题缓存与文本保真。官方 Pi 1.5.0 实际 CLI 的终端检查覆盖 Bash 模型调用、Jobs 与 Suite 展开命令，在 40/80/120 列和 truecolor/256 色下核对颜色角色、Unicode、主题切换、用户主题热重载与配置 reload。PowerShell 只有词法与组件显示检查，没有实际 PowerShell 进程或 Windows 终端验收。

[返回统一界面](index.md)
