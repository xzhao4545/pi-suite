import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';
import type { Static } from 'typebox';
import { configSchema, loadConfig, readConfig } from './config.ts';
import { JsonStore } from './json-store.ts';

export type ConfigLayer = 'user' | 'project';
export type ConfigData = Static<typeof configSchema>;
export interface ConfigChange { path: string[]; value: unknown; layer?: ConfigLayer }
export const configPaths = (cwd: string, agentDir = getAgentDir()) => ({
  user: join(agentDir, 'pi-suite.json'), project: join(cwd, '.pi', 'pi-suite.json'),
});
export function configField(data: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined, data);
}
function setField(data: ConfigData, path: string[], value: unknown): void {
  let target = data as Record<string, unknown>;
  const parents: { target: Record<string, unknown>; key: string }[] = [];
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(target, key)) {
      if (value === undefined) return;
      Object.defineProperty(target, key, { value: {}, writable: true, enumerable: true, configurable: true });
    }
    parents.push({ target, key }); target = target[key] as Record<string, unknown>;
  }
  if (value === undefined) delete target[path.at(-1)!];
  else Object.defineProperty(target, path.at(-1)!, { value, writable: true, enumerable: true, configurable: true });
  for (const parent of parents.reverse()) {
    if (Object.keys(parent.target[parent.key] as object).length) break;
    delete parent.target[parent.key];
  }
}
function validate(data: unknown, path: string): ConfigData {
  if (!Value.Check(configSchema, data)) throw new Error(`Invalid pi-suite configuration update: ${path}`);
  return data;
}
class ConfigStore extends JsonStore<ConfigData> {
  constructor(path: string) { super(path, {}, data => validate(data, path), 'CONFIG'); }
  update(changes: ConfigChange[]): Promise<void> {
    // Every writer, including Types, rereads under the shared lock before editing fields.
    return this.mutate(data => {
      for (const change of changes) setField(data, change.path, change.value);
      validate(data, this.path!);
    });
  }
}
export async function writeConfigFields(cwd: string, changes: ConfigChange[], agentDir = getAgentDir()): Promise<void> {
  loadConfig(cwd, agentDir);
  const paths = configPaths(cwd, agentDir);
  const data = { user: readConfig(paths.user), project: readConfig(paths.project) };
  const edits: Record<ConfigLayer, ConfigChange[]> = { user: [], project: [] };
  for (const change of changes) {
    const layer = change.layer ?? (configField(data.project, change.path) === undefined ? 'user' : 'project');
    if (change.value === undefined && configField(data[layer], change.path) === undefined) continue;
    edits[layer].push(change);
  }
  // Validate the whole requested edit before writing either layer; I/O failures still surface.
  for (const layer of ['user', 'project'] as const) {
    const preview = structuredClone(data[layer]);
    for (const change of edits[layer]) setField(preview, change.path, change.value);
    validate(preview, paths[layer]);
  }
  for (const layer of ['user', 'project'] as const) if (edits[layer].length) await new ConfigStore(paths[layer]).update(edits[layer]);
}
