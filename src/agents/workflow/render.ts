import type { EntryRenderer } from '@earendil-works/pi-coding-agent';
import { toolRenderers, stateLine } from '../../ui/tool-render.ts';
import { decodeWorkflowEntry, taskFromEntry, type WorkflowEntryData } from './entry.ts';
import { findWorkflowTask } from './manager.ts';
import type { WorkflowTask } from './task.ts';
import { WorkflowProgress, workflowLine, workflowToolRows } from './ui/progress.ts';

export type WorkflowToolDetails = {
  id: string; status: string; scriptPath?: string; resultPath?: string; resumedFrom?: string;
  snapshot?: { data: WorkflowEntryData; capturedAt: number };
};

/** Prefer live progress, but render the launch snapshot when replaying without an owner. */
export function workflowRenderers(findTask?: (id: string) => WorkflowTask | undefined) {
  const displayTask = ({ id, snapshot }: WorkflowToolDetails) => {
    const live = findTask?.(id);
    if (live) return { task: live };
    if (snapshot) return { task: taskFromEntry(decodeWorkflowEntry(snapshot.data)), now: snapshot.capturedAt };
  };
  return toolRenderers<{ name?: string; scriptPath?: string; script?: string }, WorkflowToolDetails>({
    call: args => ({ icon: '⟳', tone: 'accent', title: 'Workflow', summary: args.name ?? args.scriptPath ?? 'inline script' }),
    collapsed: details => {
      const display = displayTask(details);
      // Older tool results have identity and paths, but no progress snapshot.
      return display ? workflowLine(display.task, display.now) : {
        ...stateLine(details.status), title: 'Workflow', summary: `${details.id} · ${details.status}`,
      };
    },
    expanded: (details, args) => {
      const display = displayTask(details);
      return [
        ...args.script ? [{ code: args.script, language: 'javascript' as const, label: 'script' }] : [],
        ...details.scriptPath ? [{ label: 'scriptPath', value: details.scriptPath }] : [],
        ...details.resultPath ? [{ label: 'resultPath', value: details.resultPath }] : [],
        ...display ? workflowToolRows(display.task) : [],
      ];
    },
  });
}

export const workflowEntryRenderer: EntryRenderer = (entry, { expanded }, theme) => {
  const data = decodeWorkflowEntry(entry.data);
  const live = findWorkflowTask(data.id);
  // A replayed active snapshot must not keep counting time after it was recorded.
  return new WorkflowProgress(live ?? taskFromEntry(data), expanded, theme, live ? undefined : Date.parse(entry.timestamp));
};
