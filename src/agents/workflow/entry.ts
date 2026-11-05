// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/workflow/entry.ts (MIT).
/**
 * Parent history records ownership and lifecycle independently of tool calls.
 * Plain JSON snapshots survive reload; AbortController and Worker controls stay
 * with the process owner. Child references point to shared SDK sessions.
 */

import type { WorkflowMeta } from "./meta.ts";
import type { WorkflowEntry, WorkflowRunStatus } from "./progress/index.ts";
import { createWorkflowTask, type WorkflowTask } from "./task.ts";
import { updateWorkflowProgressBatch } from './task.ts';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { ToolError } from '../../runtime/errors.ts';
import type { AgentRecord } from '../types.ts';
import { decodeAgentRecord } from '../records.ts';

export type WorkflowOwner = {ownerSessionId: string; anchorEntryId: string | null; cwd: string;
  recordPath: string; resultPath: string; notified: boolean; children: AgentRecord[]};
export type OwnedWorkflowTask = WorkflowTask & WorkflowOwner;

/** Structural parent entry, also rendered through the native history registry. */
export const WORKFLOW_ENTRY_TYPE = "pi-suite:workflow-record";

/** The persisted snapshot of a run's lifecycle. */
export interface WorkflowEntryData extends WorkflowOwner {
  version: 1;
  id: string;
  name: string;
  status: WorkflowRunStatus;
  startTime: number;
  endTime?: number;
  progress: WorkflowEntry[];
  agentCount: number;
  totalTokens: number;
  meta?: WorkflowMeta;
  scriptPath?: string;
  journalPath?: string;
  args?: unknown;
  value?: unknown;
  error?: string;
  totalToolCalls: number;
  totalPausedMs: number;
  resumedFrom?: string;
  replayedCount: number;
}

/** Snapshot a task for {@link WORKFLOW_ENTRY_TYPE}. */
export function workflowEntryData(task: OwnedWorkflowTask): WorkflowEntryData {
  return {
    version: 1, id: task.id, ownerSessionId: task.ownerSessionId, anchorEntryId: task.anchorEntryId,
    cwd: task.cwd, recordPath: task.recordPath, resultPath: task.resultPath, notified: task.notified,
    children: task.children,
    name: task.workflowName ?? task.id,
    status: task.status,
    startTime: task.startTime,
    endTime: task.endTime,
    progress: task.workflowProgress,
    agentCount: task.agentCount,
    totalTokens: task.totalTokens,
    scriptPath: task.scriptPath, journalPath: task.journalPath, args: task.args, value: task.value, error: task.error,
    totalToolCalls: task.totalToolCalls, totalPausedMs: task.totalPausedMs, resumedFrom: task.resumedFrom, replayedCount: task.replayedCount,
    ...(task.meta !== undefined ? { meta: task.meta } : {}),
  };
}

/** Session/file boundary: records of a different shape cannot become runtime handles. */
export function decodeWorkflowEntry(value: unknown): WorkflowEntryData {
  const data = value as WorkflowEntryData | undefined;
  if (!data || data.version !== 1 || !/^wf_[a-f0-9]{12}$/.test(data.id) || typeof data.cwd !== 'string'
    || typeof data.ownerSessionId !== 'string' || !(data.anchorEntryId === null || typeof data.anchorEntryId === 'string')
    || typeof data.recordPath !== 'string' || typeof data.resultPath !== 'string' || typeof data.notified !== 'boolean'
    || !Array.isArray(data.children)
    || !['running', 'paused', 'completed', 'failed', 'killed'].includes(data.status) || !Array.isArray(data.progress)
    || typeof data.name !== 'string' || !Number.isFinite(data.startTime) || !Number.isInteger(data.agentCount)) {
    throw new ToolError('WORKFLOW_HISTORY', 'Invalid workflow record version or data');
  }
  return { ...data, children: data.children.map(child => decodeAgentRecord(child, data.recordPath)) };
}
export function workflowEntries(entries: readonly SessionEntry[]): WorkflowEntryData[] {
  const records = new Map<string, WorkflowEntryData>();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === WORKFLOW_ENTRY_TYPE) {
    const data = decodeWorkflowEntry(entry.data); records.set(data.id, data);
  }
  return [...records.values()];
}
export function taskFromEntry(data: WorkflowEntryData): OwnedWorkflowTask {
  const task = Object.assign(createWorkflowTask({id: data.id, script: '', scriptPath: data.scriptPath,
    args: data.args, meta: data.meta, startTime: data.startTime, journalPath: data.journalPath, resumedFrom: data.resumedFrom}),
  {...data, workflowName: data.name});
  updateWorkflowProgressBatch(task, data.progress);
  return task;
}
