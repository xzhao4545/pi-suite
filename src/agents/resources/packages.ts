// Manifest shapes, declared paths and package gates adapted from @tintinweb/pi-subagents
// 0.23.0 src/package-resources.ts (MIT). Pi owns installed-root resolution; no dependency scan.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DefaultPackageManager, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ToolError } from '../../runtime/errors.ts';

export type PackageGate = boolean | string[];
export type PackageResourceKind = 'agents' | 'workflows';
export type PackageResource = { path: string; packageName: string; packageRoot: string };
const extensions = { agents: '.md', workflows: '.js' };

function readManifest(root: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolError('AGENT_CONFIG', `Invalid package manifest: ${root}`);
    return value as Record<string, unknown>;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
function declaration(value: unknown): Partial<Record<PackageResourceKind, string[]>> | undefined {
  if (value === undefined) return;
  const object = Array.isArray(value) ? { agents: value } : value;
  if (!object || typeof object !== 'object') throw new ToolError('AGENT_CONFIG', 'pi.subagents must be an array or an agents/workflows object');
  const result: Partial<Record<PackageResourceKind, string[]>> = {};
  for (const kind of ['agents', 'workflows'] as const) {
    const entries = (object as Record<string, unknown>)[kind];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) throw new ToolError('AGENT_CONFIG', `pi.subagents.${kind} must be a string array`);
    result[kind] = entries;
  }
  return result;
}
export function readSubagentManifest(manifest: Record<string, unknown>) {
  const pi = manifest.pi as { subagents?: unknown } | undefined;
  return declaration(pi?.subagents ?? manifest['pi-subagents']);
}
/** Missing exclusions still compare canonically when an ancestor is a symlink. */
function realOrSelf(path: string): string {
  try { return realpathSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    return parent === path ? path : join(realOrSelf(parent), basename(path));
  }
}
function inside(root: string, path: string): boolean {
  const rel = relative(realOrSelf(root), realOrSelf(path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function packageAllowed(source: string, name: string | undefined, gate: PackageGate | undefined): boolean {
  if (gate === false) return false;
  if (gate === undefined || gate === true) return true;
  const candidates = [source, name, name?.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name].map(value => value?.toLowerCase());
  return gate.some(value => candidates.includes(value.trim().toLowerCase()));
}

/** Only installed, explicitly declared resources participate; absence does not trigger install. */
export function packageResources(cwd: string, kind: PackageResourceKind, trusted: boolean, gate?: PackageGate, agentDir = getAgentDir()): PackageResource[] {
  if (gate === false || Array.isArray(gate) && !gate.length) return [];
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const resources: PackageResource[] = [], seen = new Set<string>();
  for (const pkg of manager.listConfiguredPackages()) {
    if (!pkg.installedPath) continue;
    const root = resolve(pkg.installedPath);
    if (seen.has(root)) continue;
    seen.add(root);
    const manifest = readManifest(root);
    if (!manifest) continue;
    const name = typeof manifest.name === 'string' ? manifest.name : undefined;
    if (!packageAllowed(pkg.source, name, gate)) continue;
    const entries = readSubagentManifest(manifest)?.[kind];
    if (!entries) continue;
    const excluded = entries.filter(entry => entry.startsWith('!')).map(entry => resolve(root, entry.slice(1)));
    for (const path of excluded) if (!inside(root, path)) throw new ToolError('AGENT_CONFIG', `Package exclusion is outside install root: ${path}`);
    const exclusions = new Set(excluded.map(realOrSelf)), files = new Set<string>();
    for (const entry of entries) {
      if (entry.startsWith('!')) continue;
      const path = resolve(root, entry);
      if (!inside(root, path)) throw new ToolError('AGENT_CONFIG', `Package resource is outside install root: ${path}`);
      if (exclusions.has(realOrSelf(path))) continue;
      const stat = statSync(path);
      // Like the upstream agent loader, a declared directory contributes its direct files.
      const candidates = stat.isDirectory() ? readdirSync(path).sort().map(file => join(path, file)) : [path];
      for (const file of candidates) {
        if (!file.endsWith(extensions[kind]) || exclusions.has(realOrSelf(file))) continue;
        if (!inside(root, file)) throw new ToolError('AGENT_CONFIG', `Package resource escapes install root: ${file}`);
        const info = statSync(file);
        if (!info.isFile() || info.size > 1_048_576) throw new ToolError('AGENT_CONFIG', `Package resource must be a regular file within 1 MiB: ${file}`);
        files.add(file);
      }
    }
    for (const path of files) resources.push({ path, packageName: name ?? pkg.source, packageRoot: root });
  }
  return resources;
}
