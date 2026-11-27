# 用户文档首版与审查修正

## 目标与状态

README（中英文）、`docs/en`、`docs/zh` 用户文档首版、MIT `LICENSE` 与 `package.json` 的 `license` 字段已写入，尚未提交。独立模型审查核对了源码、`doc/current`、技能与上游登记；所有相对链接与锚点可解析，中英文目录结构一致。下列问题按"改代码"或"改文档"分别处理，完成后中英文同步并交付审阅。

## 一、改代码

| 问题 | 根因与位置 | 修改 |
| --- | --- | --- |
| 未安装 git 时 jobs 不可用 | `src/jobs/workspace.ts` 只把 git 的 `fatal: not a git repository` 视为非仓库；git 程序不存在（ENOENT）时抛出 `WORKSPACE_QUERY_FAILED` | ENOENT 同样回退到 cwd 作为工作区；用户文档不将 git 列为 jobs 前提 |
| `goal_wait` 模型描述与行为不一致 | `src/goal/tools.ts` 描述只列 `job_`/`agent_`，未说明 monitor/update 唤醒；schema 与实现接受 `wf_` 并因所列 job 的事件唤醒 | 描述与 schema、`src/goal/manager.ts` 的唤醒规则一致 |
| workflow 工具描述的来源表述 | `src/agents/workflow/tool-description.ts` 注释要求跟随 Claude Code 措辞 | 以独立文字重写描述正文与注释，保留使用前提、参数与后台返回语义；`third-party/UPSTREAM.md` 同步说明 |

## 二、改用户文档（docs 中英文与 README）

### 收敛超出实现保证的表述

- Jobs 停止：只能确认停止前捕获的受管范围，结果可能为 `unconfirmed`；SIGKILL 仅在 250 ms 后仍有存活进程时发送；根进程确认退出后 `unconfirmed` 不再计入活动。README 功能表同步。
- `/exit` 与退出：执行清理并等待结算，jobs 共用 10 秒期限，清理可能未确认（README、concepts、configuration）。
- README 快速上手的 goal 示例改为"目标保持活动时跨轮继续"，不承诺直到 `goal_complete`。
- 工具展开显示各工具的详情与预览，完整输出使用 `job_read`/`agent_read`；sensitive 输入保持隐藏。
- Explore/Plan 由提示词约束为只读并不含编辑工具，不是沙箱（仍有 `bash`）。
- RPC 兼容版本 2 的受支持子集；未知与内部选项被拒绝，不是任意上游调用方的直接替换。
- workflow Worker 是确定性与误用边界，不是安全沙箱；只运行可信脚本，`gate` 会执行 shell 命令。

### 补充遗漏的条件与形式

- Windows WSL `bash.exe`：PTY 拒绝；pipe 可运行但无法 `job_write`；建议 Git Bash。
- `job_write` 可只传 `submit` 或 `endInput`（后者仅 pipe）。
- `attach: true` 打开即处于输入接管态；Dock 与 `/jobs` 打开为浏览态。
- 删除 job 历史需已结算且清理已确认；只读视图与缺少 clear 控制桥时不提供。
- PTY 终态快照尽力保存，受 1000 行与 4 MiB 上限约束，写入可能失败，缺失时仍可读日志。
- `ask_user` 主会话需要 TUI，child 的问题交给直接父级；超时结果可能是当前选择、自动选择或未回答。
- `goal_wait` 会被任意直接子代理提问唤醒，不限于 `waitFor`；`goal_complete` 可在新的用户审计轮完成 paused 目标，`NOT_RUNNING` 只针对执行类操作。
- `task_edit` 的 `add` 拆为创建组（可带 `children`，不可带 `status`）与创建子任务（可带 `status`，不可带 `children`）。
- `/subagents workspace [queued|finished|all]` 与 `runs` 参数。
- RPC `consume`：成功时回复不带 data；agent 不存在或仍在运行时回复错误（审查原称返回布尔值，与 `src/agents/rpc/handlers.ts` 不符）。
- workflow 冲突：异名工具时显式 `agents.workflows: true` 可并存；同名 `agent_workflow` 由 Pi 保留首个注册，需禁用另一扩展。
- `resumeFromRunId` 限当前会话当前分支可见的已结束运行。
- Responses 恢复还要求失败请求的历史可独立重放，含 `previous_response_id`、`item_reference` 等服务端状态时不接管。

### 范围与路径表述

- 可见范围按 jobs 与 agents 分别说明；列表可见与可控制分开描述。jobs 工作区为 git 顶层或 cwd，agents 历史按配置目录。
- JSON 存储：写明使用共享锁的存储（配置、任务、目标、调度、workflow）；job 元数据与 PTY 快照仅原子重命名。
- 项目配置为会话 cwd 下的 `.pi/pi-suite.json`，不向上查找 git 根。
- `nextOffset`：运行中日志末尾可能为不完整字符，偏移可能暂不前进。

### 索引与说明

- 错误码表改为"常用错误码"，补充 `TASK_GENERATION_REQUIRED`、`WORKSPACE_CAPACITY`、`NOT_OWNER`、`INVALID_ANSWER`；`MODEL_UNAVAILABLE` 含模型名匹配不唯一。
- skills 页：缺少工具时以 `ask_user` 询问（可用时）属于 jobs 技能的规则。
- README：安装命令旁说明消费者安装路径尚未验收；补充版本 0.1.2 与 tag `v0.1.2`；单独安装主题的方式写入 interface，lockfile 与工作区文件的版本控制说明写入 development。

## 三、维护文档与规则

- `doc/current/jobs/index.md`：清理未确认的活动计数表述与 `isActive` 规则一致；`job_write` 表格补充只传 `submit`/`endInput` 的形式。
- `AGENTS.md`：修正指向不存在的 `doc/current/client-server/operations.md` 的链接；第 8 条同时链接中英文索引，并写明用户可见的修复同样需要同步文档。

## 验收

- 每项修改与源码一致；中英文内容逐节对应。
- 链接与锚点检查通过；typecheck 与受影响测试通过。
- 交付审阅，审阅前不提交。

## 相关 current 文档

[当前文档索引](../../current/index.md)、[执行任务](../../current/jobs/index.md)、[目标操作](../../current/goal/operations.md)、[Workflow 操作](../../current/agents/workflow/operations.md)

## 任务列表

- [x] README、docs 中英文首版，LICENSE 与 package.json license
- [x] 独立模型审查
- [x] 改代码三项
- [x] 用户文档修正（中英文同步）
- [x] doc/current 与 AGENTS.md 修正
- [x] 链接检查、typecheck 与受影响测试
- [x] 交付审阅
