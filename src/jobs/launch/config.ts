// Presets and exact-command policy adapted from pi-interactive-shell 0.18.0 config.ts and
// launch-policy.ts (MIT, third-party/licenses/pi-interactive-shell.txt). Configuration is
// parsed only by the shared runtime loader; project files cannot set launchPolicy.
import { Type, type Static } from 'typebox';

export const presetSchema = Type.Object({
  command: Type.Optional(Type.String({ minLength: 1, maxLength: 4096, pattern: '\\S' })),
  args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 })),
}, { additionalProperties: false });
export const presetsSchema = Type.Record(Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }), presetSchema);
export const policySchema = Type.Array(Type.Object({
  command: Type.String({ minLength: 1, maxLength: 32768 }),
  decision: Type.Union([Type.Literal('allow'), Type.Literal('ask'), Type.Literal('deny')]),
}, { additionalProperties: false }), { maxItems: 1000 });
export type Preset = { command: string; args: string[] };
export type PresetOverrides = Static<typeof presetsSchema>;
export type LaunchRule = Static<typeof policySchema>[number];
export type LaunchDecision = LaunchRule['decision'];
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

const rank = { allow: 1, ask: 2, deny: 3 };
/** Commands stay opaque: no trimming, shell parsing, wildcards or executable-only matching. */
export function compileLaunchPolicy(rules: LaunchRule[]): (command: string) => LaunchDecision {
  const decisions = new Map<string, LaunchDecision>();
  for (const rule of rules) {
    const previous = decisions.get(rule.command);
    if (!previous || rank[rule.decision] > rank[previous]) decisions.set(rule.command, rule.decision);
  }
  return command => decisions.get(command) ?? 'ask';
}
