// Type precedence and frontmatter discovery adapted from pi-subagents custom-agents.ts (MIT).
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { defaultTypes } from './defaults.ts';
import type { AgentType } from './types.ts';

export const thinkingSchema = Type.Union([Type.Literal('off'), Type.Literal('minimal'), Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh'), Type.Literal('max')]);
const frontmatter = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()),
  display_name: Type.Optional(Type.String({ minLength: 1 })),
  tools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  disallowedTools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  disallowed_tools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  model: Type.Optional(Type.String({ minLength: 1 })), thinking: Type.Optional(thinkingSchema),
  max_turns: Type.Optional(Type.Integer({ minimum: 0 })), persist_session: Type.Optional(Type.Boolean()),
  allowed_subagents: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Array(Type.String())])),
  prompt_mode: Type.Optional(Type.Union([Type.Literal('append'), Type.Literal('replace')])), enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
function csv(value: string | string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : Array.isArray(value) ? value : value === 'none' ? [] : value.split(',').map(item => item.trim()).filter(Boolean);
}
export function agentTypes(cwd: string, agentDir = getAgentDir()): AgentType[] {
  const types = new Map(defaultTypes.map(type => [type.name, type]));
  for (const dir of [join(agentDir, 'agents'), join(cwd, '.agents', 'agents'), join(cwd, '.pi', 'agents')]) {
    let files: string[];
    try { files = readdirSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const file of files.sort()) {
      if (!file.endsWith('.md')) continue;
      const path = join(dir, file);
      const { frontmatter: raw, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
      if (!Value.Check(frontmatter, raw)) throw new ToolError('AGENT_CONFIG', `Invalid agent frontmatter: ${path}`);
      const name = raw.name?.trim() || basename(file, '.md');
      if (name.includes(':')) throw new ToolError('AGENT_CONFIG', `${path}: ':' is reserved for package type scopes`);
      const allowed = raw.allowed_subagents;
      const subagents = allowed === true || allowed === 'all' || allowed === '*' ? 'all' : allowed === false ? undefined : csv(allowed);
      const tools = csv(raw.tools)?.flatMap(tool => tool === '*' || tool.toLowerCase() === 'all'
        ? ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'powershell'] : [tool.toLowerCase() === 'glob' ? 'find' : tool.toLowerCase() === 'multiedit' ? 'edit' : tool]);
      if (tools?.some(tool => tool.startsWith('ext:'))) throw new ToolError('AGENT_CONFIG', `${path}: extension selectors are pending import; specify Pi tool names`);
      types.set(name, { name, displayName: raw.display_name, description: raw.description ?? '', systemPrompt: body.trim(), promptMode: raw.prompt_mode ?? 'replace',
        tools, excludeTools: csv(raw.disallowed_tools ?? raw.disallowedTools), model: raw.model, thinking: raw.thinking,
        maxTurns: raw.max_turns, persistSession: raw.persist_session, allowedSubagents: subagents,
        enabled: raw.enabled, sourcePath: path });
    }
  }
  return [...types.values()];
}
export function resolveType(cwd: string, name: string): AgentType {
  const types = agentTypes(cwd), exact = types.find(type => type.name === name);
  const matches = exact ? [exact] : types.filter(type => type.name.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || matches[0].enabled === false) throw new ToolError('AGENT_TYPE', `Unknown, ambiguous or disabled agent type: ${name}`);
  return matches[0];
}
