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
 * running jobs. New code cannot drive the internals of a manager built for another protocol, so
 * an occupied incompatible manager keeps running and is reached only through its control bridge.
 */
export const PROTOCOL_VERSION = 11;
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
      const reason = 'An older pi-suite jobs runtime still has running or unsaved jobs; starting jobs, input and attach are disabled. Stop or wait for those jobs, then /reload';
      if (existing.agentDir === root && (existing.control?.version === 1 || existing.control?.version === 2 || existing.control?.version === 3 || existing.control?.version === 4)) return { mode: 'restricted', reason, control: existing.control };
      return { mode: 'unavailable', reason: existing.agentDir !== root
        ? 'The running pi-suite jobs runtime uses a different agent directory; restart Pi to use jobs here'
        : 'An incompatible pi-suite jobs runtime still has running or unsaved jobs; restart Pi to use jobs' };
    }
    // Idle or closed: retire the old registration before publishing a replacement.
    void existing.manager.shutdown(Date.now() + LIMITS.quitMs).catch(error => process.emitWarning(`pi-suite jobs retirement failed: ${String(error)}`));
    if (typeof existing.exitListener === 'function') process.removeListener('exit', existing.exitListener);
  }
  const manager = new JobManager({ agentDir: root, runtimeId: `rt_${randomBytes(4).toString('hex')}` });
  // These closures keep calling this implementation after reload. The bridge has no start or
  // write operation, so newer code cannot launch jobs or send input through this manager.
  const control: ControlBridge = { version: 4, jobs: {
    peek: id => manager.peek(id), get: (id, workspace) => manager.get(id, workspace),
    list: workspace => manager.list(workspace), logPath: (job, stream) => manager.logPath(job, stream),
    subscribe: listener => manager.subscribe(listener), activeIds: sessionId => manager.activeIds(sessionId),
    markNotified: id => manager.markNotified(id),
    stop: (id, reason, deadline) => manager.stop(id, reason, deadline),
    createdBy: runIds => manager.createdBy(runIds),
    sessionJobs: sessionId => manager.sessionJobs(sessionId),
    readTerminalSnapshot: job => manager.readTerminalSnapshot(job),
    clear: (id, workspace) => manager.clear(id, workspace),
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

/** Disabling modules removes bindings, but quit must still join the existing owner. */
export function quitExistingRuntime(agentDir: string): Promise<void> | undefined {
  const existing = globals[key];
  if (!existing || existing.agentDir !== realpathSync(agentDir)) return;
  // An occupied implementation without a supported bridge keeps its original exit
  // listener; invoking unknown manager internals would break that owner's cleanup.
  if (existing.control?.version === 1 || existing.control?.version === 2 || existing.control?.version === 3 || existing.control?.version === 4) return existing.control.quit();
}
