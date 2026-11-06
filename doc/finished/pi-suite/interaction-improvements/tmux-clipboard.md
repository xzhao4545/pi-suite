# Tmux 中选择文本未实际复制

状态：已完成。Linux、SSH、Pi 全屏拖选；tmux 通道阻断已定位，原生 OSC 52 中文/多行协议验证通过，用户确认本机粘贴恢复。

- [x] 定位并复现 tmux 对 Pi 原生 OSC 52 请求的阻断。
- [x] 在统一绑定修复 tmux 通道，中文/多行协议验收通过。
- [x] 用户确认 Pi 全屏拖选文本后可在本机其他窗口粘贴；Pi 的 Copied! 不能通过协议证明客户端接收，当前结果说明见终端操作文档。

## 现状与已确认的代码问题

用户现象：Pi 在 tmux 内运行，选择文本后提示已复制，但实际没有复制。用户已确认 Linux、SSH、Pi 全屏拖选。当前 tmux 的客户端具有 clipboard 能力，服务器 set-clipboard=external；已将实际会话调整为 on，用户已确认现在可以复制；本机 SSH 终端具体应用名未提供，验收限于该实际链路。

本项目 `src` 没有实现通用鼠标选择复制或系统剪贴板写入。安装的 Pi 1.5.0 中，相关路径为：

1. pi-tui 的 `TuiAltScreen.copySelectionToClipboard` 取选区文本，调用宿主传入的 `copySelection`。
2. pi-coding-agent 的 `modes/interactive/tui-renderer` 调用 `utils/clipboard.copyToClipboard`，未抛错即返回成功。
3. clipboard 优先尝试本机剪贴板后端；远程会话或无显示环境会尝试 OSC 52。`emitOsc52` 只校验长度并向 stdout 写裸 OSC 52，没有 tmux 专用封装或接收端确认。
4. OSC 52 发出后会把 `copied` 置为成功，TUI 随即显示 `Copied!`。这只能证明已发出请求，不能证明终端或 tmux 已接受，因而存在成功提示失真的代码路径。

已确认 tmux 的 external 会拒绝应用 OSC 52。独立 tmux 会话使用 Pi 原生 copyToClipboard 验证：external 不向客户端转发，on 正确转发中文与多行内容。本扩展在统一 TUI 绑定时检查客户端 clipboard 能力并设置当前服务器 on，缺少能力或操作失败明确提示；未修改宿主提示或复制实现。

## 排查与修改方案

先确认选择入口及最终粘贴目标，区分 tmux buffer、运行 Pi 所在机器的剪贴板与 SSH 客户端的剪贴板。在 tmux 内外比较同一选择动作，并用非敏感短文本验证本机后端和 OSC 52 是否到达目标。检查实际相关的终端能力与 tmux `set-clipboard`、`Ms`，采用 DCS 透传路线时再核对 `allow-passthrough`；同时关注长驻 tmux 会话的 SSH 环境标记是否失真。

按证据选择最短路径：本地桌面优先修复可用的原生剪贴板后端；远程/无显示环境使用终端剪贴板通道。tmux 可由自身接收应用 OSC 52 并向外转发，也可在明确支持时用 tmux DCS 封装透传，不能假定所有环境都需要同一配置组合。若终端拒绝写剪贴板，应明确说明实际需要的设置。嵌套 tmux/SSH 只按复现链路处理，不预先实现多层自动探测体系。

若问题由宿主 clipboard 引起，优先升级到经过验证的 Pi 修复版本，或将修复落到宿主公共 clipboard/TUI 接口；所有选择复制、消息复制和 `/copy` 共用同一能力。不可只给 suite 某个查看器增加独立复制实现，也不可 monkey-patch stdout、修改 `node_modules` 后当作可交付修复。确需依赖补丁时必须可版本控制、可重装复现并登记来源。

结果提示区分原生后端确认成功、OSC 52 请求已发送但无法确认、通道失败。OSC 52 通常没有可靠的写入确认，不能承诺通过协议证明剪贴板已更新；此路径的最终验收必须在目标终端外实际粘贴。不能以尝试写入本机剪贴板成功来冒充已写入远程客户端。

## 验收与范围

使用同一目标终端比较 tmux 外/内，验证中文、多行文本和实际粘贴结果；覆盖用户确实使用的 SSH 链路。通道禁用或后端失败时不得虚报已复制，超过传输限制时有明确提示。验证 Pi 选区复制与共享 clipboard 的其他入口一致，同时确认普通终端选择没有受到影响。

已有 Windows 验收结论不能替代此次 tmux 验收。稳定的平台条件、必要配置和结果提示说明在修复后写入 [统一界面](../../../current/ui/index.md) 或其终端操作子文档；具体验收范围归入 `doc/finished`，不向 `doc/current` 追加临时调试过程。

[返回已完成需求](index.md)
