// Imported from pi-background-jobs 0.1.3 src/workspace.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// The workspace is the git toplevel when available so history follows the repository, not the subdirectory.
import { realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { ToolError } from '../runtime/errors.ts';
import type { Workspace } from './types.ts';

const execute = promisify(execFile);
export async function resolveWorkspace(cwd: string): Promise<Workspace> {
  let root: string;
  try {
    root = await realpath(cwd);
    if (!(await stat(root)).isDirectory()) throw new Error('cwd is not a directory');
  } catch (error) { throw new ToolError('INVALID_CWD', String(error)); }
  try {
    const { stdout } = await execute(process.platform === 'win32' ? 'git.exe' : 'git',
      ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 3000, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } });
    root = await realpath(stdout.trim());
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (!failure.stderr?.trim().startsWith('fatal: not a git repository')) {
      throw new ToolError('WORKSPACE_QUERY_FAILED', String(error));
    }
  }
  const key = process.platform === 'win32' ? root.replaceAll('\\', '/').toLowerCase() : root;
  return { root, key, hash: createHash('sha256').update(key).digest('hex') };
}
