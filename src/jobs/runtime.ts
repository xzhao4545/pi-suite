// Adapted from pi-background-jobs 0.1.3 src/runtime.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite changes: registration key and protocol are pi-suite's; one manager shape, no v1 control surface.
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { JobManager } from './manager.ts';
import { LIMITS } from './types.ts';

/**
 * The manager lives in a process-global slot so reload re-imports this module without losing
 * running jobs. A different protocol cannot drive the old manager's internals, so an occupied
 * incompatible manager keeps running and this extension instance reports jobs unavailable.
 */
export const PROTOCOL_VERSION = 3;
export type RuntimeHandle =
  | { mode: 'active'; manager: JobManager }
  | { mode: 'unavailable'; reason: string };
type Registration = {
  protocolVersion: number; agentDir: string; manager: JobManager; exitListener: () => void;
};
const key = Symbol.for('pi-suite.jobs.runtime');
const globals = globalThis as typeof globalThis & { [key]?: Registration };

function compatible(value: unknown, agentDir: string): value is Registration {
  if (!value || typeof value !== 'object' || !('protocolVersion' in value) || !('agentDir' in value) || !('manager' in value)) return false;
  const manager: unknown = value.manager;
  return value.protocolVersion === PROTOCOL_VERSION && value.agentDir === agentDir &&
    !!manager && typeof manager === 'object' && 'subscribe' in manager && typeof manager.subscribe === 'function';
}
/** An old registration of unknown shape counts as occupied unless it proves otherwise. */
function occupied(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('manager' in value)) return true;
  const manager: unknown = value.manager;
  if (!manager || typeof manager !== 'object' || !('hasOccupancy' in manager) || typeof manager.hasOccupancy !== 'function') return true;
  try { return manager.hasOccupancy() !== false; } catch { return true; }
}

export function acquireRuntime(agentDir: string): RuntimeHandle {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const root = realpathSync(agentDir);
  const existing = globals[key];
  if (existing !== undefined) {
    if (compatible(existing, root) && !existing.manager.closed) return { mode: 'active', manager: existing.manager };
    if (!compatible(existing, root) && occupied(existing)) {
      return { mode: 'unavailable', reason: 'Another pi-suite jobs runtime with running or unsaved jobs owns this Pi process; finish or stop them, then restart Pi to upgrade' };
    }
    // Idle or closed: retire the old registration before publishing a replacement.
    try { void existing.manager.shutdown(Date.now() + LIMITS.quitMs).catch(() => {}); } catch {}
    if (typeof existing.exitListener === 'function') process.removeListener('exit', existing.exitListener);
  }
  const manager = new JobManager({ agentDir: root, runtimeId: `rt_${randomBytes(4).toString('hex')}` });
  const registration: Registration = { protocolVersion: PROTOCOL_VERSION, agentDir: root, manager, exitListener: () => manager.exitSync(Date.now() + LIMITS.exitFallbackMs) };
  process.on('exit', registration.exitListener);
  globals[key] = registration;
  return { mode: 'active', manager };
}

/** Quit policy: stop every live job under one shared deadline; repeated calls share it. */
export function quitRuntime(manager: JobManager): Promise<void> {
  return manager.shutdown(Date.now() + LIMITS.quitMs);
}
