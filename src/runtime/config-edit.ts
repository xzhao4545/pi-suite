import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { readConfig } from './config.ts';
import { writeConfigFields, type ConfigChange } from './config-fields.ts';
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
export function writeAgentType(cwd: string, type: string, changes: ModelOverrides, agentDir = getAgentDir()): Promise<void> {
  return writeTypeFields(cwd, type, changes, fields, agentDir);
}
/** Use definition removes both configuration layers, rather than revealing another toggle. */
export function writeAgentTypeEnabled(cwd: string, type: string, enabled: boolean | undefined, agentDir = getAgentDir()): Promise<void> {
  return writeTypeFields(cwd, type, { enabled }, ['enabled'], agentDir, enabled === undefined);
}
function writeTypeFields(cwd: string, type: string, changes: AgentTypeSettings, selectedFields: readonly (keyof AgentTypeSettings)[], agentDir: string, clearLayers = false): Promise<void> {
  const edits: ConfigChange[] = selectedFields.flatMap(field => clearLayers
    ? (['user', 'project'] as const).map(layer => ({ path: ['agents', 'types', type, field], value: changes[field], layer }))
    : [{ path: ['agents', 'types', type, field], value: changes[field] }]);
  return writeConfigFields(cwd, edits, agentDir);
}
