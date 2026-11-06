// CLI argument construction adapted from pi-interactive-shell 0.18.0 spawn.ts (MIT,
// third-party/licenses/pi-interactive-shell.txt). pi-suite removes worktrees and /spawn;
// the job tool supplies a structured preset request and uses the existing JobManager.
import { Type, type Static } from 'typebox';
import { parseArgs } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../../runtime/errors.ts';
import { CLI_PROMPT_FLAG, CLI_PROMPT_TRIGGER } from '../../runtime/cli-prompt.ts';
import type { Preset } from './config.ts';

export const agentSchema = Type.Object({
  preset: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$', description: 'pi, codex, claude, cursor or a configured jobs.agents key' }),
  prompt: Type.String({ minLength: 1, maxLength: 16000, pattern: '\\S', description: 'One literal task prompt; never interpreted as shell code' }),
  fork: Type.Optional(Type.Boolean({ description: 'pi only: fork the current persisted session; omit or false for a fresh session' })),
}, { additionalProperties: false });
export type AgentLaunch = Static<typeof agentSchema>;

/** Pi always uses Bash, including Git Bash on Windows; preserve $, quotes and backticks. */
export function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Let Pi distinguish options from literal values such as --system-prompt '-e'. */
function piOptionIndex(args: string[], options: string[]): number {
  // A temporary unknown flag is registered by the parser only at an actual option
  // position. The probe never reaches the child; no duplicate CLI grammar is needed.
  return args.findIndex((arg, index) => options.includes(arg) &&
    parseArgs(args.with(index, '--pi-suite-option-boundary=true')).unknownFlags.get('pi-suite-option-boundary') === 'true');
}

export function agentCommand(agent: AgentLaunch, presets: Record<string, Preset>, sessionFile?: string): string {
  // Own-property lookup prevents names such as constructor from resolving through Object.prototype.
  const preset = Object.hasOwn(presets, agent.preset) ? presets[agent.preset] : undefined;
  if (!preset) throw new ToolError('INVALID_ARGS', `Unknown CLI agent ${agent.preset}; configured presets: ${Object.keys(presets).join(', ')}`);
  if (agent.fork && agent.preset !== 'pi') throw new ToolError('INVALID_ARGS', 'fork is supported only by the pi preset');
  if (agent.fork && !sessionFile) throw new ToolError('INVALID_ARGS', 'Cannot fork an unpersisted session; start a fresh CLI agent instead');
  const args = [...preset.args];
  const end = agent.preset === 'pi' ? piOptionIndex(args, ['--']) : args.indexOf('--');
  if (agent.fork) args.splice(end < 0 ? args.length : end, 0, '--fork', sessionFile!);
  if (agent.preset === 'pi') {
    const parsed = parseArgs(preset.args);
    if (parsed.mode === 'rpc' || parsed.unknownFlags.get('mode') === 'rpc') {
      throw new ToolError('INVALID_ARGS', 'Pi RPC mode does not execute an initial CLI prompt');
    }
  }
  if (agent.preset === 'pi' && agent.prompt.startsWith('@')) {
    // Explicit loading also works with --no-extensions. Pi canonicalizes and deduplicates
    // this entry when the same suite is already installed or auto-discovered. Keep a
    // node cli.js wrapper prefix, but restore text before other extensions' input hooks.
    const insertion = piOptionIndex(args, ['-e', '--extension', '--']);
    args.splice(insertion < 0 ? args.length : insertion, 0,
      '-e', fileURLToPath(new URL('../../index.ts', import.meta.url)), `--${CLI_PROMPT_FLAG}=${agent.prompt}`);
    if (end < 0) args.push('--');
    args.push(CLI_PROMPT_TRIGGER);
  } else {
    // End option parsing so a prompt beginning with -- cannot become a CLI switch.
    if (end < 0) args.push('--');
    args.push(agent.prompt);
  }
  return [preset.command, ...args].map(shellArgument).join(' ');
}
