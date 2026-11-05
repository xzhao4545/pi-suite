import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';
import { configSchema, loadConfig, readConfig } from './config.ts';
import type { AgentTypeSettings, ModelOverrides } from '../agents/types.ts';

const fields = ['model', 'thinking'] as const;
/** A project field must be edited at its source, or a user-level update would remain hidden. */
export function agentTypeLocations(cwd: string, type: string, agentDir = getAgentDir()) {
  const user = join(agentDir, 'pi-suite.json'), project = join(cwd, '.pi', 'pi-suite.json');
  const override = readConfig(project).agents?.types?.[type];
  return Object.fromEntries(fields.map(field => [field, override && Object.hasOwn(override, field) ? project : user])) as Record<typeof fields[number], string>;
}
/** Removing a project model reveals the user value; removing a user model leaves no type pin. */
export function agentTypeModelAfterClear(cwd: string, type: string, agentDir = getAgentDir()): string | undefined {
  return readConfig(join(cwd, '.pi', 'pi-suite.json')).agents?.types?.[type]?.model !== undefined
    ? readConfig(join(agentDir, 'pi-suite.json')).agents?.types?.[type]?.model : undefined;
}
export function writeAgentType(cwd: string, type: string, changes: ModelOverrides, agentDir = getAgentDir()): void {
  writeTypeFields(cwd, type, changes, fields, agentDir);
}
/** Use definition removes both configuration layers, rather than revealing another toggle. */
export function writeAgentTypeEnabled(cwd: string, type: string, enabled: boolean | undefined, agentDir = getAgentDir()): void {
  writeTypeFields(cwd, type, { enabled }, ['enabled'], agentDir, enabled === undefined);
}
function writeTypeFields(cwd: string, type: string, changes: AgentTypeSettings, selectedFields: readonly (keyof AgentTypeSettings)[], agentDir: string, clearLayers = false): void {
  loadConfig(cwd, agentDir);
  const user = join(agentDir, 'pi-suite.json'), project = join(cwd, '.pi', 'pi-suite.json');
  const projectType = readConfig(project).agents?.types?.[type];
  const locations = Object.fromEntries(selectedFields.map(field => [field, projectType && Object.hasOwn(projectType, field) ? project : user]));
  const updates = [...new Set(clearLayers ? [user, project] : Object.values(locations))].map(path => {
    const data = readConfig(path);
    return { path, data, before: JSON.stringify(data) };
  });
  for (const { path, data } of updates) {
    if (!data.agents?.types?.[type] && selectedFields.every(field => locations[field] !== path || changes[field] === undefined)) continue;
    data.agents ??= {}; data.agents.types ??= {};
    const override = data.agents.types[type] ??= {};
    for (const field of selectedFields) if (clearLayers || locations[field] === path) {
      if (changes[field] === undefined) delete override[field];
      else Object.assign(override, { [field]: changes[field] });
    }
    if (!Object.keys(override).length) delete data.agents.types[type];
    if (!Value.Check(configSchema, data)) throw new Error(`Invalid pi-suite configuration update: ${path}`);
  }
  for (const { path, data, before } of updates) {
    if (JSON.stringify(data) === before) continue;
    const temporary = `${path}.${randomUUID()}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    try { writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
}
