// Adapted from pi-background-jobs 0.1.3 src/runtime.ts (MIT, third-party/licenses/pi-background-jobs.txt).
// pi-suite changes: own registration/execution protocol; an independent read/stop bridge
// retains the owner's public control operations across execution protocol upgrades.
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { JobManager } from './manager.ts';
import { LIMITS } from './types.ts';
import type { ControlBridge } from './control.ts';

/**
 * The manager lives in a process-global slot so reload re-imports this module without losing
 * running jobs. A different protocol cannot drive the old manager's internals, so an occupied
 * incompatible manager keeps running; its versioned control bridge remains usable without
 * allowing the new execution implementation to drive the old manager's internals.
 */
export const PROTOCOL_VERSION = 6;
export type RuntimeHandle =
  | { mode: 'active'; manager: JobManager }
  | { mode: 'restricted'; reason: string; control: ControlBridge }
  | { mode: 'unavailable'; reason: string };
type Registration = {
  protocolVersion: number; agentDir: string; manager: JobManager; control: ControlBridge; exitListener: () => void;
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
  return manager.hasOccupancy() !== false;
}

export function acquireRuntime(agentDir: string): RuntimeHandle {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const root = realpathSync(agentDir);
  const existing = globals[key];
  if (existing !== undefined) {
    if (compatible(existing, root) && !existing.manager.closed) return { mode: 'active', manager: existing.manager };
    if (occupied(existing)) {
      const reason = 'Another pi-suite jobs runtime with running or unsaved jobs owns this Pi process; new execution is disabled. Finish or stop existing jobs, then reload to upgrade';
      if (existing.agentDir === root && (existing.control?.version === 1 || existing.control?.version === 2)) return { mode: 'restricted', reason, control: existing.control };
      return { mode: 'unavailable', reason: existing.agentDir !== root
        ? 'The occupied pi-suite jobs runtime belongs to a different agent directory; use its original directory or restart Pi for exit cleanup'
        : 'The occupied pi-suite jobs runtime has no compatible control bridge. Its owner and exit cleanup remain installed; restart Pi to upgrade' };
    }
    // Idle or closed: retire the old registration before publishing a replacement.
    void existing.manager.shutdown(Date.now() + LIMITS.quitMs).catch(error => process.emitWarning(`pi-suite jobs retirement failed: ${String(error)}`));
    if (typeof existing.exitListener === 'function') process.removeListener('exit', existing.exitListener);
  }
  const manager = new JobManager({ agentDir: root, runtimeId: `rt_${randomBytes(4).toString('hex')}` });
  // Closures stay with the owner implementation across reload. The bridge exposes only
  // query/stop, so a different execution protocol cannot launch or write through it.
  const control: ControlBridge = { version: 2, jobs: {
    peek: id => manager.peek(id), get: (id, workspace) => manager.get(id, workspace),
    list: workspace => manager.list(workspace), logPath: (job, stream) => manager.logPath(job, stream),
    subscribe: listener => manager.subscribe(listener), activeIds: sessionId => manager.activeIds(sessionId),
    markNotified: id => manager.markNotified(id),
    stop: (id, reason, deadline) => manager.stop(id, reason, deadline),
    createdBy: runIds => manager.createdBy(runIds),
  }, quit: () => quitRuntime(manager) };
  const registration: Registration = { protocolVersion: PROTOCOL_VERSION, agentDir: root, manager, control, exitListener: () => manager.exitSync(Date.now() + LIMITS.exitFallbackMs) };
  process.on('exit', registration.exitListener);
  globals[key] = registration;
  return { mode: 'active', manager };
}

/** Quit policy: stop every live job under one shared deadline; repeated calls share it. */
export function quitRuntime(manager: JobManager): Promise<void> {
  return manager.shutdown(Date.now() + LIMITS.quitMs);
}
