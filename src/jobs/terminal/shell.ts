// Adapted from pi-interactive-shell 0.18.0 shell-resolution.ts (MIT, third-party/licenses/pi-interactive-shell.txt).
import { getAgentDir, getShellConfig, SettingsManager } from '@earendil-works/pi-coding-agent';

export interface ResolvedShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  readonly commandTransport: 'argv' | 'stdin';
}

/**
 * Resolve the same Bash selection Pi uses for its own shell tool, so jobs and the bash tool
 * run under one shell. `projectCwd` must be Pi's trusted context project, never a caller cwd.
 * On Windows a missing Git Bash surfaces Pi's own installation hint.
 */
export function resolvePiShell(projectCwd: string, projectTrusted: boolean): ResolvedShellConfig {
  const settingsManager = SettingsManager.create(projectCwd, getAgentDir(), { projectTrusted });
  const shellConfig = getShellConfig(settingsManager.getShellPath());
  if (!shellConfig.shell || shellConfig.args.length === 0) {
    throw new Error('Pi returned an invalid shell configuration: a shell executable and argv are required.');
  }
  return Object.freeze({ shell: shellConfig.shell, args: Object.freeze([...shellConfig.args]), commandTransport: shellConfig.commandTransport ?? 'argv' });
}
