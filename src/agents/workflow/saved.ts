// Adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/saved.ts (MIT).
// Resource roots, trust and package declarations use the suite's common resource loader.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { packageResources, type PackageGate } from '../resources/packages.ts';
import { hasMetaDeclaration } from './meta.ts';
import { MAX_SCRIPT_LENGTH, type WorkflowScriptSource } from './runtime/index.ts';

export type WorkflowResources = { trusted: boolean; packageGate?: PackageGate; agentDir?: string };
export function savedWorkflowRoots(cwd: string, options: WorkflowResources): string[] {
  return [...options.trusted ? [join(cwd, '.pi', 'workflows'), join(cwd, '.agents', 'workflows')] : [],
    join(options.agentDir ?? getAgentDir(), 'workflows')];
}
const usableName = (name: string) => name.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);

function readScript(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_SCRIPT_LENGTH) throw new Error(`Workflow script must be a regular file within ${MAX_SCRIPT_LENGTH} bytes: ${path}`);
  return readFileSync(path, 'utf8');
}
function packageScripts(cwd: string, options: WorkflowResources) {
  return packageResources(cwd, 'workflows', options.trusted, options.packageGate, options.agentDir);
}
/** Listings filter ordinary JS files, while named lookup reports an invalid shadowing file. */
export function listSavedWorkflows(cwd: string, options: WorkflowResources): string[] {
  const names = new Set<string>();
  const paths: string[] = packageScripts(cwd, options).map(file => file.path);
  for (const root of savedWorkflowRoots(cwd, options)) {
    let entries: string[];
    try { entries = readdirSync(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    paths.push(...entries.filter(name => name.endsWith('.js')).map(name => join(root, name)));
  }
  for (const path of paths) {
    const name = basename(path, '.js');
    const stat = statSync(path);
    if (usableName(name) && stat.isFile() && stat.size <= MAX_SCRIPT_LENGTH && hasMetaDeclaration(readScript(path))) names.add(name);
  }
  return [...names].sort();
}
export function readSavedWorkflow(name: string, cwd: string, options: WorkflowResources): WorkflowScriptSource {
  const trimmed = name.trim();
  if (!usableName(trimmed)) return {ok: false, message: `Invalid workflow name "${name}"; use letters, digits, dots, hyphens and underscores. Use scriptPath for a path.`};
  try {
    for (const root of savedWorkflowRoots(cwd, options)) {
      const path = join(root, `${trimmed}.js`);
      let script: string;
      try { script = readScript(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      return hasMetaDeclaration(script) ? {ok: true, script, path} : {ok: false, message: `${path} has no export const meta declaration. Nothing was run.`};
    }
    const file = packageScripts(cwd, options).find(file => basename(file.path, '.js') === trimmed);
    if (file) {
      const script = readScript(file.path);
      return hasMetaDeclaration(script) ? {ok: true, script, path: file.path} : {ok: false, message: `${file.path} has no export const meta declaration. Nothing was run.`};
    }
    return {ok: false, message: `No saved workflow "${trimmed}". Roots: ${savedWorkflowRoots(cwd, options).join(', ')}. Available: ${listSavedWorkflows(cwd, options).join(', ') || 'none'}.`};
  } catch (error) { return {ok: false, message: error instanceof Error ? error.message : String(error)}; }
}
/** The same mutually exclusive reference contract serves root and nested workflows. */
export function resolveWorkflowSource(ref: {name?: string; scriptPath?: string}, cwd: string, options: WorkflowResources): WorkflowScriptSource {
  if ([ref.name, ref.scriptPath].filter(value => value !== undefined).length !== 1) return {ok: false, message: 'Provide exactly one of name or scriptPath.'};
  if (ref.name !== undefined) return readSavedWorkflow(ref.name, cwd, options);
  if (!ref.scriptPath?.trim()) return {ok: false, message: 'scriptPath must be non-empty.'};
  const path = resolve(cwd, ref.scriptPath);
  try { return {ok: true, script: readScript(path), path}; }
  catch (error) { return {ok: false, message: `Could not read workflow ${path}: ${String(error)}`}; }
}
export function resolveWorkflowScript(params: {script?: string; scriptPath?: string; name?: string}, cwd: string, options: WorkflowResources): WorkflowScriptSource {
  if ([params.script, params.scriptPath, params.name].filter(value => value !== undefined).length !== 1) return {ok: false, message: 'Provide exactly one of script, scriptPath or name.'};
  if (params.script !== undefined) return params.script.trim() ? {ok: true, script: params.script} : {ok: false, message: 'script must be non-empty.'};
  return resolveWorkflowSource(params, cwd, options);
}
