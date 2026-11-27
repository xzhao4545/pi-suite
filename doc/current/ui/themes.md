# Oh My Pi 参考主题

本包通过 `package.json` 的 `pi.themes`（`./themes/*.json`）发布 `themes/oh-my-pi.json`，主题名 `oh-my-pi`，`appearance` 为 dark。配色参考 Oh My Pi 的 Titanium：蓝灰面板、电蓝强调色、浅灰文字与绿/橙/红状态色。源码与许可证见 [上游来源](../../../third-party/UPSTREAM.md)。

## 加载与切换

主题 JSON 使用 Pi 原生主题格式，也可以单独用于原版 Pi。包的加载入口与安装范围见 [宿主加载边界](../runtime/index.md#宿主加载边界)。

| 方式 | 操作 |
| --- | --- |
| 作为 Pi package 加载 | 执行 `/reload`，再在 `/settings` → **Theme** 选择 `oh-my-pi`。选择由 Pi 保存到设置文件，与 Suite 模块是否启用无关 |
| 开发时加载整个包 | `pnpm exec pi -e . --use-theme oh-my-pi`，只对本次启动生效 |
| 单独安装 | 复制到 `~/.pi/agent/themes/oh-my-pi.json`，再从 `/settings` 选择。同名主题只保留一个来源，避免与包内主题冲突 |

`pi -e ./src/index.ts` 只加载扩展文件，不加载包主题。

编辑包内主题后执行 `/reload`；用户主题目录中的活动主题由 Pi 热重载。自定义颜色集中在 `vars`，`colors` 只映射 Pi 原生的语义角色。

## 配色与边界

- 标题、选中标记与高亮边框为电蓝 `#00b4ff`；普通边框 `#4a5058` 与内部细线 `#343b46` 为不同亮度的蓝灰。
- 选中行背景为深蓝 `#16394d`，搜索匹配背景为暗金 `#403218`；正文 `text` 与次要文字 `muted` 在这两种背景上的对比度不低于 4.5:1。
- 用户消息使用亮灰背景 `#323232`（`vars.userPanel` → `colors.userMessageBg`）与纯白文字 `#ffffff`（`vars.userText` → `colors.userMessageText`）。待执行工具为深灰面板 `#0f1216`，成功/失败分别为低饱和的绿 `#11231d`、红 `#2a171d` 面板；结果状态仍由原生 success/error 角色表达。
- Markdown、语法高亮、diff、thinking 强度边框、Bash 模式与全屏滚动条都有对应角色。HTML 导出使用同一套深色面板（`export` 段）。
- 主题只控制 Pi 暴露的配色角色，不控制布局、图标、圆角边框字符、字体或终端默认背景。希望未着色区域也一致时，可把终端背景设为 `#151820`、前景设为 `#e8ecf4`。
- 助手正文的默认文字颜色由终端前景决定；`text` 角色只作用于编辑器和扩展等显式使用它的地方，不会覆盖全部 Markdown 正文。
- Suite 的 Dock、询问、列表与详情使用宿主主题角色；pi-starship 的 TOML 配色由其自身配置管理。

## 语法配色

语法颜色用独立变量映射 Pi 原生 `syntax*` 角色，与界面强调色、状态色分开：

| 角色 | 颜色 |
| --- | --- |
| 程序/函数 `syntaxFunction` | 浅青蓝 `#7dcfff` |
| 控制关键字 `syntaxKeyword` | 淡紫 `#bb9af7` |
| 命令选项/类型 `syntaxType` | 暖金 `#e0af68` |
| 变量 `syntaxVariable` | 蓝 `#7aa2f7` |
| 字符串 `syntaxString` | 柔绿 `#9ece6a` |
| 运算符/重定向 `syntaxOperator` | 浅青 `#89ddff` |
| 数字 `syntaxNumber` | 琥珀 `#ffb347` |
| 注释 `syntaxComment` | 灰 `#7e8795` |
| 标点 `syntaxPunctuation` | 浅灰 `#9ca3b0` |

普通命令参数与路径使用 `mdCodeBlock` 的浅灰前景 `#e8ecf4`。语法角色同时作用于原生代码块。Suite 的命令高亮见 [命令结构高亮](command-highlighting.md)，主题文件不增加识别规则，也不改变原版 Pi 的语法分类。

所有语法角色与 `mdCodeBlock` 在待执行、成功、失败三种工具背景上的对比度不低于 4.5:1，truecolor 与 Pi 的 256 色近似都满足。256 色近似可能合并相近的浅青色，不保证与 RGB 一一对应；实际观感需要在终端中确认。

[返回当前文档](../index.md)
