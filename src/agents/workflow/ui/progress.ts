// Workflow tree and inspector fields adapted from pi-subagents 0.23.0 ui/workflow-{card,dialog}.ts.
// Text wrapping and reading/search state are owned by the suite's native UI components.
import type { Theme } from '@earendil-works/pi-coding-agent';
import { toolLine, stateLine, type ToolExpandedRow, type ToolLine } from '../../../ui/tool-render.ts';
import { Text } from '@earendil-works/pi-tui';
import { sanitizeText } from '../../../runtime/text.ts';
import { workflowActive } from '../manager.ts';
import { buildPhaseGroups, displayState, formatDuration, header } from '../progress/index.ts';
import { workflowResultText, type WorkflowTask } from '../task.ts';

export function workflowLines(task: WorkflowTask, expanded = true, now = Date.now()): string[] {
  const groups = buildPhaseGroups(task.workflowProgress, task.meta?.phases);
  const title = header(task, task.meta, groups, task.agentCount, now);
  const lines = [`${title.name} · ${title.stats}`, title.subtext,
    `${task.totalTokens} tokens · ${task.totalToolCalls} tools${task.replayedCount ? ` · ${task.replayedCount} replayed` : ''}`];
  if (expanded) {
    for (const group of groups) {
      lines.push('', `${group.title} · ${group.status} · ${group.doneCount}/${group.totalCount} · ${formatDuration(group.durationMs)}`);
      for (const agent of group.agents) {
        lines.push(`  #${agent.index} ${agent.label} · ${displayState(agent, workflowActive(task))}${agent.cached ? ' · cached' : ''}`);
        lines.push(`    ${[agent.agentType, agent.modelId ?? agent.model, agent.thinking && `thinking ${agent.thinking}`,
          agent.requestedThinking && `(asked ${agent.requestedThinking})`, agent.attempt && `attempt ${agent.attempt}`,
          agent.lastAttemptReason, agent.tokens !== undefined && `${agent.tokens} tokens`,
          agent.toolCalls !== undefined && `${agent.toolCalls} tools`].filter(Boolean).join(' · ')}`);
        for (const [label, value] of [['Prompt', agent.promptPreview], ['Result', agent.resultPreview], ['Error', agent.error]]) {
          if (value) lines.push(`    ${label}: ${value}`);
        }
      }
    }
    if (task.logs.length) lines.push('', 'Logs', ...task.logs);
    if (!workflowActive(task)) lines.push('', 'Result', workflowResultText(task));
  }
  return lines.filter(line => line !== undefined);
}
/** Structured tool expansion uses the same phase model as the inspector, not text pattern matching. */
export function workflowToolRows(task: WorkflowTask): ToolExpandedRow[] {
  const rows: ToolExpandedRow[] = [{ label: 'usage', value: `${task.totalTokens} tokens · ${task.totalToolCalls} tools${task.replayedCount ? ` · ${task.replayedCount} replayed` : ''}`, tone: 'dim' }];
  for (const group of buildPhaseGroups(task.workflowProgress, task.meta?.phases)) {
    const state = group.status === 'not-started' ? 'queued' : group.status === 'done' ? 'completed' : group.status;
    rows.push({ ...stateLine(state), title: group.title, summary: `${group.doneCount}/${group.totalCount}`,
      meta: [{ text: group.status, tone: stateLine(state).tone! }, formatDuration(group.durationMs)] });
    for (const agent of group.agents) {
      const state = displayState(agent, workflowActive(task));
      rows.push({ ...stateLine(state === 'done' ? 'completed' : state === 'interrupted' ? 'stopped' : state),
        title: `#${agent.index} ${agent.label}`, indent: 2, meta: [state, ...agent.cached ? ['cached'] : []] },
      { label: 'agent', value: [agent.agentType, agent.modelId ?? agent.model, agent.thinking && `thinking ${agent.thinking}`,
        agent.requestedThinking && `(asked ${agent.requestedThinking})`, agent.attempt && `attempt ${agent.attempt}`,
        agent.lastAttemptReason, agent.tokens !== undefined && `${agent.tokens} tokens`,
        agent.toolCalls !== undefined && `${agent.toolCalls} tools`].filter(Boolean).join(' · '), tone: 'dim' });
      for (const [label, value] of [['Prompt', agent.promptPreview], ['Result', agent.resultPreview], ['Error', agent.error]]) {
        if (value) rows.push({ label: label!, value, tone: label === 'Error' ? 'error' : 'toolOutput' });
      }
    }
  }
  if (task.logs.length) rows.push({ label: 'Logs', value: task.logs.join('\n') });
  if (!workflowActive(task)) rows.push({ label: 'Result', value: workflowResultText(task), tone: task.status === 'failed' ? 'error' : 'toolOutput' });
  return rows;
}
export function workflowLine(task: WorkflowTask): ToolLine {
  const groups = buildPhaseGroups(task.workflowProgress, task.meta?.phases);
  const title = header(task, task.meta, groups, task.agentCount, Date.now());
  return { ...stateLine(task.status === 'killed' ? 'stopped' : task.status === 'paused' ? 'queued' : task.status), title: 'Workflow', summary: `${title.name} · ${title.stats}`,
    meta: [title.subtext ?? '', `${task.totalTokens} tokens · ${task.totalToolCalls} tools${task.replayedCount ? ` · ${task.replayedCount} replayed` : ''}`] };
}

export class WorkflowProgress extends Text {
  private revision = '';
  constructor(private task: WorkflowTask, private expanded = true, private theme?: Theme) { super('', 0, 0); }
  override render(width: number): string[] {
    if (!this.expanded && this.theme) return [toolLine(this.theme, workflowLine(this.task), width)];
    const task = this.task, now = Date.now();
    const revision = `${task.progressVersion}:${task.status}:${task.endTime}:${task.error}:${Math.floor(now / 1000)}`;
    if (revision !== this.revision) {
      this.revision = revision;
      this.setText(sanitizeText(workflowLines(task, this.expanded, now).join('\n')));
    }
    return super.render(width);
  }
}
