/**
 * Process-wide execution owners (agents, workflows) survive /reload so running children keep
 * their sessions. An owner also keeps the closures of the module load that created it, so a
 * reload must not silently reuse it: new code would drive old internals (for example an old
 * config schema rejecting fields the current release writes). Each module load gets its own
 * implementation identity; an idle owner from another load is retired and replaced, a busy one
 * stays observable but is marked stale so callers refuse new executions until it is idle.
 */
export interface ExecutionOwner { readonly closed: boolean; busy(): boolean; shutdown(): Promise<void> }
type ExistingOwner = Pick<ExecutionOwner, 'closed' | 'shutdown'> & Partial<Pick<ExecutionOwner, 'busy'>>;
type Slot<T> = { implementation?: symbol; owner: T };
export type OwnerHandle<T> = { owner: T; stale?: string };

// One identity per evaluation of this module; Pi re-evaluates extension modules on /reload.
const implementation = Symbol('pi-suite execution implementation');
const globals = globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>;

/** Owners written before this slot format carry no identity and cannot prove they are idle. */
function slotOf(value: unknown): Slot<ExistingOwner> {
  return value && typeof value === 'object' && 'implementation' in value && 'owner' in value
    ? value as Slot<ExistingOwner> : { owner: value as ExistingOwner };
}

export function existingOwner(key: string, agentDir: string): ExistingOwner | undefined {
  const value = globals[Symbol.for(key)]?.get(agentDir);
  return value === undefined ? undefined : slotOf(value).owner;
}
export function ownerBusy(key: string, agentDir: string): boolean {
  const owner = existingOwner(key, agentDir);
  return !!owner && !owner.closed && (owner.busy?.() ?? true);
}

/** Busy also counts dependants: retiring an agents owner would close it under a running workflow. */
export function acquireOwner<T extends ExecutionOwner>(key: string, label: string, agentDir: string, create: () => T,
  options: { dependants?: () => boolean; matches?: (owner: T) => boolean } = {}): OwnerHandle<T> {
  const owners = globals[Symbol.for(key)] ??= new Map();
  const existing = owners.get(agentDir);
  if (existing !== undefined) {
    const slot = slotOf(existing);
    if (!slot.owner.closed) {
      const owner = slot.owner as T;
      if (slot.implementation === implementation && (options.matches?.(owner) ?? true)) return { owner };
      if (!slot.implementation || !slot.owner.busy) return { owner,
        stale: `Restart Pi to update the ${label} runtime; the previous load cannot report when it is idle` };
      if (slot.owner.busy() || options.dependants?.()) return { owner,
        stale: `The ${label} runtime from an earlier pi-suite load still has running work; new runs are disabled. Let it finish or stop it, then /reload (or restart Pi)` };
      // Idle: nothing runs under the old closures, so closing it loses no execution.
      void slot.owner.shutdown().catch(error => process.emitWarning(`pi-suite ${label} runtime retirement failed: ${String(error)}`));
    }
  }
  const owner = create();
  owners.set(agentDir, { implementation, owner } satisfies Slot<T>);
  return { owner };
}
