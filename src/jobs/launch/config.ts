// Presets adapted from pi-interactive-shell 0.18.0 config.ts
// (MIT, third-party/licenses/pi-interactive-shell.txt), parsed by the shared runtime loader.
import { Type, type Static } from 'typebox';

export const presetSchema = Type.Object({
  command: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: '\\S' })),
  args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 })),
}, { additionalProperties: false });
export const presetsSchema = Type.Record(Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }), presetSchema);
export type Preset = { command: string; args: string[] };
export type PresetOverrides = Static<typeof presetsSchema>;
export const defaultPresets: Record<string, Preset> = {
  pi: { command: 'pi', args: [] }, codex: { command: 'codex', args: [] },
  claude: { command: 'claude', args: [] }, cursor: { command: 'agent', args: ['--model', 'composer-2-fast'] },
};

/** Merge per preset and field, so project args do not discard a user executable path. */
export function mergePresets(user?: PresetOverrides, project?: PresetOverrides): Record<string, Preset> {
  const result: Record<string, Preset> = {};
  for (const name of new Set([...Object.keys(defaultPresets), ...Object.keys(user ?? {}), ...Object.keys(project ?? {})])) {
    const preset = { ...defaultPresets[name], ...user?.[name], ...project?.[name] };
    if (!preset.command) throw new Error(`Invalid pi-suite configuration: jobs.agents.${name} needs command`);
    result[name] = { command: preset.command, args: preset.args ?? [] };
  }
  return result;
}
