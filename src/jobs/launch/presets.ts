// CLI argument construction adapted from pi-interactive-shell 0.18.0 spawn.ts (MIT,
// third-party/licenses/pi-interactive-shell.txt). pi-suite removes worktrees and /spawn;
// the job tool supplies a structured preset request and uses the existing JobManager.
import { Type, type Static } from 'typebox';
import { ToolError } from '../../runtime/errors.ts';
import type { Preset } from './config.ts';

export const agentSchema = Type.Object({
  preset: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$', description: 'pi, codex, claude, cursor or a configured jobs.agents key' }),
  prompt: Type.String({ minLength: 1, maxLength: 16000, pattern: '\\S', description: 'One literal positional task prompt; never interpreted as shell code' }),
  fork: Type.Optional(Type.Boolean({ description: 'pi only: fork the current persisted session; omit or false for a fresh session' })),
}, { additionalProperties: false });
export type AgentLaunch = Static<typeof agentSchema>;

/** Pi always uses Bash, including Git Bash on Windows; preserve $, quotes and backticks. */
export function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
export function agentCommand(agent: AgentLaunch, presets: Record<string, Preset>, sessionFile?: string): string {
  // Own-property lookup prevents names such as constructor from resolving through Object.prototype.
  const preset = Object.hasOwn(presets, agent.preset) ? presets[agent.preset] : undefined;
  if (!preset) throw new ToolError('INVALID_ARGS', `Unknown CLI agent ${agent.preset}; configured presets: ${Object.keys(presets).join(', ')}`);
  if (agent.fork && agent.preset !== 'pi') throw new ToolError('INVALID_ARGS', 'fork is supported only by the pi preset');
  if (agent.fork && !sessionFile) throw new ToolError('INVALID_ARGS', 'Cannot fork an unpersisted session; start a fresh CLI agent instead');
  const args = [...preset.args, ...agent.fork ? ['--fork', sessionFile!] : []];
  // End option parsing so a prompt beginning with -- cannot become a CLI switch.
  args.push('--', agent.prompt);
  return [preset.command, ...args].map(shellArgument).join(' ');
}
