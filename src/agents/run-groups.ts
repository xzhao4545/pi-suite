import type { AgentRecord } from './types.ts';

// Keep the browser's representative in the same order as manager.get(id).
export const compareRunRecency = (a: AgentRecord, b: AgentRecord): number =>
  b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId);

export function groupAgentRuns(records: Iterable<AgentRecord>): Map<string, AgentRecord[]> {
  const groups = new Map<string, AgentRecord[]>();
  for (const record of records) {
    const runs = groups.get(record.id);
    if (runs) runs.push(record);
    else groups.set(record.id, [record]);
  }
  for (const runs of groups.values()) runs.sort(compareRunRecency);
  return groups;
}
