// Resource selection adapted from @tintinweb/pi-subagents 0.23.0 src/agent-runner.ts (MIT).
// Pi resolves paths before its loader runs factories, so excludes and the suite singleton
// are filtered before execution rather than in the upstream post-load extensionsOverride.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultPackageManager,
  DefaultResourceLoader, getAgentDir, SettingsManager, type ExtensionFactory, type Skill } from '@earendil-works/pi-coding-agent';
import { ToolError } from '../../runtime/errors.ts';
import type { Execution } from '../types.ts';
import { extensionCanonicalNames, matchesToolPattern, parseExtensionsSpec, parseExtSelectors } from './selectors.ts';
import { scopeGateExtension, type NestedCallGate } from './scope.ts';
import { buildMemoryBlock, buildReadOnlyMemoryBlock } from './memory.ts';
import { inheritableParentPrompt } from './prompts.ts';

const builtins = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'powershell'];
const suiteTools = ['task_list', 'task_edit', 'job_start', 'job_list', 'job_read', 'job_write', 'job_stop', 'wait'];
const nestedTools = ['agent_start', 'agent_list', 'agent_read', 'agent_send', 'agent_stop', 'wait'];
export function resourcePath(path: string, cwd: string): string {
  const expanded = path === '~' || path.startsWith('~/') || path.startsWith('~\\') ? homedir() + path.slice(1) : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export async function childResources(run: Execution, factory: ExtensionFactory) {
  const { type, record, parent } = run, cwd = record.cwd, agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: parent.ctx.isProjectTrusted() });
  const extensions = run.isolated ? false : type.extensions ?? true, skills = run.isolated ? false : type.skills ?? true;
  const selectors = parseExtSelectors(run.isolated ? [] : type.tools?.filter(name => name.startsWith('ext:')) ?? []);
  const mcpToolPatterns = type.tools?.filter(name => name.startsWith('mcp__')).map(name => name.slice(5).includes('__') ? name : `${name}__*`);
  const toolNames = type.tools?.filter(name => !name.startsWith('ext:') && !name.startsWith('mcp__')) ?? [...builtins, ...suiteTools];
  const readmitToolNames = new Set(type.tools?.length === 0 ? [] : ['ask_user']);
  if (type.allowedSubagents && !run.isolated && record.ancestors.length + 1 < run.config.agents.maxDepth) for (const name of nestedTools) readmitToolNames.add(name);
  const disallowedSet = new Set(type.excludeTools);
  const effectivelyHas = (name: string) => matchesToolPattern(name, toolNames) && !matchesToolPattern(name, [...disallowedSet]);
  const writableMemory = effectivelyHas('write') || effectivelyHas('edit');
  if (type.memory) for (const name of writableMemory ? ['read', 'write', 'edit'] : ['read']) if (!disallowedSet.has(name)) readmitToolNames.add(name);

  const builtinFactories = [
    { name: 'codemode', factory: createCodemodeExtension(), builtin: true, replaceable: true },
    { name: 'tool-search', factory: createToolSearchExtension(), builtin: true, replaceable: true },
    { name: 'mcp', factory: createMcpExtension(), builtin: true, replaceable: true },
  ];
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager, builtinExtensions: builtinFactories.map(item => item.name) });
  const spec = Array.isArray(extensions) ? parseExtensionsSpec(extensions, cwd) : undefined;
  const resolved = extensions === false ? [] : (await packages.resolve(async () => 'error')).extensions;
  const additional = spec?.paths.length ? (await packages.resolveExtensionSources(spec.paths, { temporary: true })).extensions : [];
  const excluded = new Set(run.isolated ? [] : type.excludeExtensions?.map(name => name.toLowerCase()));
  const disabledBuiltins = process.argv.some(arg => arg === '--no-extensions' || arg === '-ne') ? ['codemode', 'tool-search', 'mcp'] : process.argv.includes('--no-mcp') ? ['mcp'] : [];
  const discovered = [...resolved, ...additional].filter(resource => resource.enabled);
  for (const name of excluded) if (!discovered.some(resource => extensionCanonicalNames(resource.path).includes(name))) {
    throw new ToolError('AGENT_CONFIG', `${type.sourcePath ?? type.name}: excluded extension ${name} is not enabled or available`);
  }
  const loadAll = extensions === true || spec?.wildcard;
  const paths = [...new Set(discovered.filter(resource => {
    const names = extensionCanonicalNames(resource.path);
    if (names.includes('pi-suite') || names.some(name => excluded.has(name))) return false;
    if (resource.path.startsWith('builtin:') && disabledBuiltins.includes(resource.path.slice(8))) return false;
    return loadAll || names.some(name => spec?.names.has(name));
  }).map(resource => resource.path))];
  const availableNames = new Set(paths.flatMap(extensionCanonicalNames));
  for (const name of [...spec?.names ?? [], ...selectors.extNames]) {
    if (!availableNames.has(name) && !excluded.has(name)) throw new ToolError('AGENT_CONFIG', `${type.sourcePath ?? type.name}: extension ${name} is not enabled or available`);
  }
  const gate: NestedCallGate = {}, preloaded: Skill[] = [];
  const memory = type.memory ? (writableMemory ? buildMemoryBlock : buildReadOnlyMemoryBlock)(type.name, type.memory, cwd) : '';
  const inherited = type.promptMode === 'append' ? inheritableParentPrompt(parent.ctx.getSystemPrompt(), cwd) : '';
  const prompt = () => [inherited, `<active_agent name="${type.name}"/>`, type.systemPrompt, memory,
    ...preloaded.map(skill => `# Preloaded Skill: ${skill.name}\n${readFileSync(skill.filePath, 'utf8')}`)].filter(Boolean).join('\n\n');
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: paths,
    extensionFactories: [...builtinFactories, scopeGateExtension(gate), { name: 'pi-suite-child', hidden: true, factory }],
    noSkills: skills === false, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    skillsOverride: base => {
      if (!Array.isArray(skills)) return base;
      preloaded.splice(0, preloaded.length, ...base.skills.filter(skill => skills.includes(skill.name)));
      for (const name of skills) if (!preloaded.some(skill => skill.name === name)) throw new ToolError('AGENT_CONFIG', `${type.sourcePath ?? type.name}: skill ${name} is not enabled or available`);
      return { ...base, skills: [] };
    },
    systemPromptOverride: prompt, appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  const errors = [...loader.getExtensions().errors.map(error => `${error.path}: ${error.error}`),
    ...loader.getSkills().diagnostics.filter(item => item.type === 'error').map(item => `${item.path}: ${item.message}`)];
  if (errors.length) throw new ToolError('AGENT_CONFIG', errors.join('; '));
  return { loader, settingsManager, scope: { loader, toolNames, disallowedSet, ...selectors,
    mcpToolPatterns: mcpToolPatterns?.length ? mcpToolPatterns : undefined, readmitToolNames, nestedCallGate: gate } };
}
