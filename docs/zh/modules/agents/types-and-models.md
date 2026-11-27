# Agent 类型、模型与资源

[Agents](index.md) · [文档索引](../../index.md)

## 类型来源

类型按以下顺序加载，后加载的同名定义替换先前的定义：

1. 内置类型：`general-purpose`、`Explore`、`Plan`。
2. 已安装 Pi 包声明的类型（`agents.packageAgents`）。
3. 用户类型：`<agentDir>/agents/`。
4. 项目类型：`<project>/.agents/agents/`。
5. 项目类型：`<project>/.pi/agents/`。

项目目录和项目包只在 Pi 信任该项目时使用。名称先精确匹配；不区分大小写的匹配必须唯一。

## 类型文件

类型是一个 Markdown 文件：frontmatter 配置类型，正文是它的系统提示词。未知字段会报错。

```markdown
---
name: reviewer
display_name: Code reviewer
description: Reviews a diff for bugs and missing tests
tools: read, grep, find, ls, bash
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 30
---
你负责审查代码变更。指出具体问题，并给出文件和行号。
```

| 字段 | 含义 |
| --- | --- |
| `name`、`display_name`、`description`、`color` | 身份与显示。 |
| `tools` | 允许的工具：Pi 工具名、通配符、`*`/`all`、`ext:foo`（扩展 foo 的全部工具）、`ext:foo/bar`、`mcp__server`（某个 MCP 服务器的全部工具）。默认为内置工具加本套件的任务、job 和 wait 工具。 |
| `disallowed_tools`（或 `disallowedTools`） | 在其他规则之后移除的工具，支持通配符。 |
| `extensions` / `exclude_extensions` | 子代理加载哪些 Pi 扩展。默认 `true`（Pi 已配置的扩展）；`false` 不加载任何扩展。 |
| `skills` | `true`（默认）使用 Pi 的技能发现，`false` 关闭技能，列表则预加载指定技能。 |
| `model`、`thinking` | 默认模型（`provider/modelId`，或唯一匹配的模糊名称）和 thinking 等级（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`）。 |
| `max_turns` | 轮数上限，达到后运行以 `limited` 结束。 |
| `prompt_mode` | `replace` 只使用本提示词；`append` 把它追加到父级稳定的提示前缀之后。 |
| `inherit_context` | 传入父级的对话文本。 |
| `run_in_background` | 强制后台或前台。 |
| `isolated` | 不加载外部扩展、技能，不允许嵌套。 |
| `allowed_subagents` | 嵌套子代理：默认关闭；`true`/`all`/`*` 或类型名列表。 |
| `persist_session`、`session_dir` | 是否以及在哪里保存子会话。 |
| `memory` | `user`、`project` 或 `local`：持久记忆目录，其中 `MEMORY.md` 的前 200 行会进入提示词。 |
| `enabled` | `false` 时禁止启动该类型的新运行。 |

子会话不会自动加载项目的 `AGENTS.md`、提示模板或 `APPEND_SYSTEM.md`，提示词由类型决定。

记忆目录：`<agentDir>/agent-memory/<类型>`（user）、`<cwd>/.pi/agent-memory/<类型>`（project）、`<cwd>/.pi/agent-memory-local/<类型>`（local）。拥有 `write` 或 `edit` 工具的类型得到可写记忆，否则为只读。

MCP 工具使用 Pi 规范化后的名称 `mcp__<server>__<tool>`，例如 `mcp__context7__query_docs`。

## 模型与 thinking 的解析

模型和 thinking 等级分别取以下第一个有值的来源：

1. `agent_start` 参数。
2. 针对这一个 agent 的覆盖，在 `/subagents` 中用 `c` 设置。
3. `pi-suite.json` 中的 `agents.types.<类型>`。
4. 类型的 frontmatter。
5. `agents.defaultModel`（仅模型）。
6. 父会话当前的值。

显式的 `provider/modelId` 没有凭据时返回 `MODEL_UNAVAILABLE` 并指出来源，从不替换为其他 provider 的模型。Pi 会把 thinking 等级降到所选模型支持的范围。

单个 agent 的覆盖从该 agent 的下一次请求生效，不打断当前请求。类型默认值作用于之后新启动的运行。

## 配置覆盖

`/subagents types` 把覆盖写入 `pi-suite.json`，不修改类型的 Markdown 文件：

```json
{
  "agents": {
    "types": {
      "Explore": { "enabled": true, "model": "anthropic/claude-haiku-4-5", "thinking": "low" }
    }
  }
}
```

每个字段：项目文件已设置该字段时写入项目文件，否则写入用户文件。选择 **No override** 会删除该字段。这些修改立即生效，无需 `/reload`。启用状态依次按项目、用户、frontmatter、`true` 解析。

模型选择器列出 Pi 拥有凭据的全部模型，包括不在会话限定模型列表中的模型。

## 包中的类型

Pi 包可以在 `package.json` 中声明附带的 agent 类型和 workflow：

```json
{
  "pi": {
    "extensions": [],
    "subagents": { "agents": ["./agents"], "workflows": ["./workflows/review.js"] }
  }
}
```

没有 `pi.subagents` 时，也接受顶层的 `pi-subagents` 键；数组是 `agents` 的简写。条目可以是目录（取其直接包含的文件）或单个文件；`!path` 排除某个文件。不支持 glob。文件必须位于包内，且不超过 1 MiB。只提供资源的包应声明 `"extensions": []`。
