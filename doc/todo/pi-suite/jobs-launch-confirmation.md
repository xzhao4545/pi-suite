# 删除 job 启动确认

状态：用户已决定删除，未实施。

## 原始需求

- [ ] 1. job_start 不再弹出启动确认，与 Pi 内置命令执行保持一致。

## 现状与原因

- 来源：[CLI 预设与启动授权基础阶段](../../finished/pi-suite/jobs/cli-launch-core.md) 从 pi-interactive-shell 0.18.0 导入了精确命令匹配规则 `jobs.launchPolicy`（allow/ask/deny）。`src/jobs/launch/config.ts` 第 43 行对未匹配的命令返回 `'ask'`，规则为空时也一样，所以默认每次 job_start 都询问用户。
- Pi 自身不这样做：Pi 1.5.0 的 `docs/security.md` 写明 Pi “does not ask for approval before every tool call”，内置 bash 直接执行；需要确认的用户可以安装权限扩展，在 `tool_call` 事件里拦截（`docs/extensions.md` 的 permission-gate 示例）。
- 结果是同一条命令走 bash 不需要确认，走 job_start 却要确认，只增加打断；确认超时或取消时还会 terminate 并结束本轮。

## 方案

直接删除启动授权，不保留默认放行的规则表，也不提供兼容入口：

| 位置 | 改动 |
| --- | --- |
| `src/jobs/launch/authorize.ts` | 删除文件 |
| `src/jobs/manager.ts` 103–117 | `start` 删除 `authorize` 参数及命令、detector 命令的两次授权调用 |
| `src/jobs/tools.ts` | 删除 `authorizeLaunch` 导入、`LAUNCH_NOT_CONFIRMED` 的 terminate 分支；`registerJobTools` 的第四个参数删除 `ask` 与 `parentQuestions`；job_start 描述删除 launchPolicy 一句 |
| `src/jobs/launch/config.ts` | 删除 `policySchema`、`LaunchRule`、`LaunchDecision`、`rank`、`compileLaunchPolicy`，保留预设部分；文件头注释改为只说明预设来源 |
| `src/runtime/config.ts` | 删除 jobs 节的 `launchPolicy` schema、类型、默认值与第 96、104 行的用户层专用处理。配置文件中仍有该字段时由现有严格 schema 报错，提示删除字段 |
| `src/runtime/config-fields.ts` 55 | 删除 launchPolicy 用户层专用检查 |
| `src/runtime/settings/view.ts` 35、42–43、64、78 | 删除 launchPolicy 的特殊展示与仅用户层操作 |
| `src/runtime/suite.ts` 41、54 | `registerJobTools` 不再传 `ask`；`AskManager` 只在 `modules.ask` 为 true 时创建 |
| `src/agents/child.ts` 39 | 子代理的 `registerJobTools` 不再传 `ask` 与 `parentQuestions` |
| `skills/pi-suite-jobs/SKILL.md` 27 | 删除启动策略与 `LAUNCH_CONFIRMATION_REQUIRED` 的说明 |
| `third-party/UPSTREAM.md` | pi-interactive-shell 行删除 launch-policy 的导入说明 |

- 本机用户与项目的 `pi-suite.json` 当前都不存在，没有需要迁移的配置。
- monitor 的 detector 命令随 job 一起启动，不再单独确认。

## 测试调整

- 删除 `tests/jobs/launch.test.ts` 中 launchPolicy 合并/优先级（30–43 行）、deny/cancel 启动确认（198–207 行起）与非交互 `LAUNCH_CONFIRMATION_REQUIRED`（231–245 行起）的用例，保留预设与 RPC 参数检查。
- `tests/agents/progress.test.ts`、`tests/agents/runtime.test.ts`、`tests/ask/coordination.test.ts`、`tests/jobs/launch.test.ts` 第 103 行、`tests/jobs/visibility.test.ts` 为绕过确认写入的 `launchPolicy` allow 配置全部删除。
- `tests/agents/models.test.ts` 79 行与 `tests/runtime/settings.test.ts` 56 行的 user-only 断言删除；models 测试的无效配置样例改用其他未知字段。

## 验收

- [ ] 全量测试与类型检查通过。
- [ ] 实际 Pi CLI 中模型调用 job_start（command、agent 预设、带 detector 的 monitor）直接启动，不出现询问。
- [ ] `/suite` 不再出现 jobs.launchPolicy。
- [ ] 完成后更新 `doc/current/jobs/launch.md`（删除“启动策略”一节及第 21 行授权说明）、`doc/current/jobs/index.md` 第 103 行、`doc/current/runtime/index.md` 第 28 行、`doc/current/runtime/settings.md` 第 5 行。

[返回 Pi Suite 待办](index.md)
