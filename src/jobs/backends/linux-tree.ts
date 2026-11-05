import { readFileSync, readdirSync } from 'node:fs';
import { errnoCode, type ProcessIdentity } from '../types.ts';
import type { Tracked } from './process.ts';

type Row = ProcessIdentity & { parentPid: number; groupId: number; state: string; ticks: bigint };
const same = (a: ProcessIdentity, b: ProcessIdentity) => a.pid === b.pid && a.createdAt === b.createdAt;
const running = (row: Row | undefined): row is Row => !!row && row.state !== 'Z' && row.state !== 'X';

function readProcess(pid: number): Row | undefined {
  let stat: string;
  try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) { if (errnoCode(error) === 'ENOENT' || errnoCode(error) === 'ESRCH') return; throw error; }
  // comm can contain spaces and ')'; fields after its final ')' have fixed kernel positions.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const parentPid = Number(fields[1]), groupId = Number(fields[2]);
  if (!fields[0] || !Number.isSafeInteger(parentPid) || !Number.isSafeInteger(groupId) || !/^\d+$/.test(fields[19] ?? '')) throw new Error(`Invalid /proc/${pid}/stat`);
  const ticks = BigInt(fields[19]);
  // The existing identity string carries exact boot-relative start ticks, never rounded wall time.
  return { pid, createdAt: `linux:${ticks}`, parentPid, groupId, state: fields[0], ticks };
}
function snapshot(): Row[] {
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
    const row = readProcess(Number(name)); return row ? [row] : [];
  });
}
export function captureLinuxIdentity(run: Tracked): ProcessIdentity | undefined {
  const row = readProcess(run.pid);
  if (!row) return;
  return run.rootIdentity = { pid: row.pid, createdAt: row.createdAt };
}
export function captureLinuxScope(run: Tracked): ProcessIdentity[] {
  const rows = snapshot(), byPid = new Map(rows.map(row => [row.pid, row]));
  const root = run.rootIdentity;
  if (!root) throw new Error(`Linux root identity unavailable${run.identityError ? `: ${run.identityError}` : ''}`);
  const first = byPid.get(root.pid), initial = !run.retainedScope?.length;
  if (initial && (!first || !same(first, root))) throw new Error('Root exited before descendant capture; detached scope cannot be established');
  const retained = run.retainedScope ??= [root];
  const children = new Map<number, Row[]>();
  for (const row of rows) { const list = children.get(row.parentPid) ?? []; list.push(row); children.set(row.parentPid, list); }
  const selected = retained.flatMap(identity => { const row = byPid.get(identity.pid); return row && same(row, identity) ? [row] : []; });
  const seen = new Set(selected.map(row => row.pid));
  // The original group also owns reparented children and the PTY group pin. After the root
  // exits, only a surviving captured member can establish that this is still the same group.
  if (initial || selected.some(row => running(row) && row.groupId === run.pid)) {
    for (const row of rows) if (row.groupId === run.pid && !seen.has(row.pid)) { selected.push(row); seen.add(row.pid); }
  }
  for (let index = 0; index < selected.length; index++) {
    const parent = selected[index];
    for (const child of children.get(parent.pid) ?? []) {
      if (child.ticks >= parent.ticks && !seen.has(child.pid)) { selected.push(child); seen.add(child.pid); }
    }
  }
  // Retain before signaling: parents may exit/reparent children, and sync quit can take over.
  const captured = new Set(retained.map(identity => `${identity.pid}/${identity.createdAt}`));
  for (const row of selected) if (!captured.has(`${row.pid}/${row.createdAt}`)) retained.push({ pid: row.pid, createdAt: row.createdAt });
  return [...retained];
}
export function signalLinuxScope(scope: ProcessIdentity[], signal: NodeJS.Signals): void {
  const rows = snapshot(), byPid = new Map(rows.map(row => [row.pid, row]));
  const identities = new Map(scope.map(identity => [identity.pid, identity]));
  const groups = new Map<number, Row[]>();
  for (const row of rows) { const list = groups.get(row.groupId) ?? []; list.push(row); groups.set(row.groupId, list); }
  const signalled = new Set<number>();
  // Detached tool groups go first, leaving their ancestors alive until the captured leaves stop.
  for (const identity of [...scope].reverse()) {
    const row = byPid.get(identity.pid);
    if (!running(row) || !same(row, identity) || signalled.has(row.groupId)) continue;
    const current = readProcess(row.pid);
    if (!running(current) || !same(current, identity)) continue;
    const wholeGroup = current.groupId === row.groupId && groups.get(row.groupId)!.every(member => {
      const owned = identities.get(member.pid); return owned && same(member, owned);
    });
    // A live identity anchors the group even after its leader exits; a reused leader PID alone
    // never authorizes group signals. Mixed groups receive only verified individual signals.
    try { process.kill(wholeGroup ? -row.groupId : row.pid, signal); }
    catch (error) { if (errnoCode(error) !== 'ESRCH') throw error; }
    if (wholeGroup) signalled.add(row.groupId);
  }
}
export function linuxScopeAlive(scope: ProcessIdentity[]): boolean {
  // PID 1 may leave zombies unreaped indefinitely; they cannot execute and need no further kill.
  return scope.some(identity => { const row = readProcess(identity.pid); return running(row) && same(row, identity); });
}
export function linuxRootExited(run: Tracked): boolean {
  const row = readProcess(run.pid);
  return !!run.rootIdentity && (!running(row) || !same(row, run.rootIdentity));
}
