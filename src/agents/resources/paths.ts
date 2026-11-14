import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/** Path expansion is shared by history discovery and execution without loading child resources. */
export function resourcePath(path: string, cwd: string): string {
  const expanded = path === '~' || path.startsWith('~/') || path.startsWith('~\\') ? homedir() + path.slice(1) : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}
