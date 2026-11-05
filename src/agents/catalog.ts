// Type precedence and frontmatter discovery adapted from @tintinweb/pi-subagents 0.23.0 src/custom-agents.ts (MIT).
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../runtime/errors.ts';
import { defaultTypes } from './defaults.ts';
import type { AgentType, AgentTypeSettings } from './types.ts';
import { packageResources, type PackageGate } from './resources/packages.ts';

export const thinkingSchema = Type.Union([Type.Literal('off'), Type.Literal('minimal'), Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh'), Type.Literal('max')]);
const frontmatter = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })), description: Type.Optional(Type.String()),
  display_name: Type.Optional(Type.String({ minLength: 1 })),
  color: Type.Optional(Type.String()),
  tools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  disallowedTools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  disallowed_tools: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  model: Type.Optional(Type.String({ minLength: 1 })), thinking: Type.Optional(thinkingSchema),
  max_turns: Type.Optional(Type.Integer({ minimum: 0 })), persist_session: Type.Optional(Type.Boolean()),
  allowed_subagents: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Array(Type.String())])),
  prompt_mode: Type.Optional(Type.Union([Type.Literal('append'), Type.Literal('replace')])), enabled: Type.Optional(Type.Boolean()),
  extensions: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Array(Type.String())])),
  exclude_extensions: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
  skills: Type.Optional(Type.Union([Type.Boolean(), Type.String(), Type.Array(Type.String())])),
  session_dir: Type.Optional(Type.String({ minLength: 1 })), inherit_context: Type.Optional(Type.Boolean()),
  run_in_background: Type.Optional(Type.Boolean()), isolated: Type.Optional(Type.Boolean()),
  memory: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('local')])),
}, { additionalProperties: false });
function csv(value: string | string[] | undefined): string[] | undefined {
  return value === undefined ? undefined : Array.isArray(value) ? value : value === 'none' ? [] : value.split(',').map(item => item.trim()).filter(Boolean);
}
function resourceChoice(value: boolean | string | string[] | undefined): boolean | string[] {
  return value === undefined || value === true ? true : value === false ? false : csv(value) ?? false;
}
export type CatalogOptions = { trusted?: boolean; packageGate?: PackageGate; typeSettings?: Record<string, AgentTypeSettings> };
export function agentTypes(cwd: string, agentDir = getAgentDir(), options: CatalogOptions = {}): AgentType[] {
  const types = new Map(defaultTypes.map(type => [type.name, type]));
  const sources = packageResources(cwd, 'agents', options.trusted ?? false, options.packageGate, agentDir);
  const local: { path: string; packageName?: string }[] = [];
  for (const dir of [join(agentDir, 'agents'), ...options.trusted ? [join(cwd, '.agents', 'agents'), join(cwd, '.pi', 'agents')] : []]) {
    let files: string[];
    try { files = readdirSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const file of files.sort()) if (file.endsWith('.md')) local.push({ path: join(dir, file) });
  }
  for (const { path, packageName } of [...sources, ...local]) {
    const { frontmatter: raw, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    if (!Value.Check(frontmatter, raw)) throw new ToolError('AGENT_CONFIG', `Invalid agent frontmatter: ${path}`);
    const name = raw.name?.trim() || basename(path, '.md');
    if (name.includes(':')) throw new ToolError('AGENT_CONFIG', `${path}: ':' is reserved for package type scopes`);
    const allowed = raw.allowed_subagents;
    const allowedNames = typeof allowed === 'boolean' ? undefined : csv(allowed);
    const subagents = allowed === true || allowedNames?.some(name => name === '*' || name.toLowerCase() === 'all') ? 'all' : allowedNames?.length ? allowedNames : undefined;
    const normalize = (tool: string) => ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'powershell'].includes(tool.toLowerCase())
      ? tool.toLowerCase() : tool.toLowerCase() === 'glob' ? 'find' : tool.toLowerCase() === 'multiedit' ? 'edit' : tool;
    const tools = csv(raw.tools)?.flatMap(tool => tool === '*' || tool.toLowerCase() === 'all'
      ? ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'powershell'] : [normalize(tool)]);
    if (csv(raw.exclude_extensions)?.some(name => /[/\\*~]/.test(name))) throw new ToolError('AGENT_CONFIG', `${path}: exclude_extensions accepts canonical names only`);
    if (raw.memory && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.length > 128)) throw new ToolError('AGENT_CONFIG', `${path}: memory requires a simple agent name`);
    types.set(name, { name, displayName: raw.display_name, description: raw.description ?? '', systemPrompt: body.trim(), promptMode: raw.prompt_mode ?? 'replace',
      tools, excludeTools: csv(raw.disallowed_tools ?? raw.disallowedTools)?.flatMap(tool => [...new Set([tool, normalize(tool)])]), model: raw.model, thinking: raw.thinking,
      maxTurns: raw.max_turns, persistSession: raw.persist_session, allowedSubagents: subagents,
      extensions: resourceChoice(raw.extensions), excludeExtensions: csv(raw.exclude_extensions), skills: resourceChoice(raw.skills),
      sessionDir: raw.session_dir, inheritContext: raw.inherit_context, runInBackground: raw.run_in_background,
      isolated: raw.isolated, memory: raw.memory, color: raw.color,
      enabled: raw.enabled, sourcePath: path, packageName });
  }
  // Configuration uses exact catalog identities, as model/thinking pins do. Keep definition
  // objects untouched so another caller's launch snapshot cannot inherit a later toggle.
  return [...types.values()].map(type => options.typeSettings?.[type.name]?.enabled === undefined
    ? type : { ...type, enabled: options.typeSettings[type.name].enabled });
}
export function resolveType(cwd: string, name: string, options: CatalogOptions = {}): AgentType {
  const types = agentTypes(cwd, getAgentDir(), options), exact = types.find(type => type.name === name);
  const matches = exact ? [exact] : types.filter(type => type.name.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || matches[0].enabled === false) throw new ToolError('AGENT_TYPE', `Unknown, ambiguous or disabled agent type: ${name}`);
  return matches[0];
}
