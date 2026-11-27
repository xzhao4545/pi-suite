// Workflow tree and inspector fields adapted from pi-subagents 0.23.0 ui/workflow-{card,dialog}.ts.
// Text wrapping and reading/search state are owned by the suite's native UI components.
import type { Theme } from '@earendil-works/pi-coding-agent';
import { toolLine, stateLine, type ToolExpandedRow, type ToolLine } from '../../../ui/tool-render.ts';
import { Text } from '@earendil-works/pi-tui';
import { detailsText, field, part, statePart, type DetailRow, type StructuredDetails } from '../../../ui/structured-details.ts';
import { workflowActive } from '../manager.ts';
import { buildPhaseGroups, displayState, formatDuration, header } from '../progress/index.ts';
import { workflowResultText, type WorkflowTask } from '../task.ts';

export function workflowDetails(task: WorkflowTask, expanded = true, now = Date.now()): StructuredDetails {
  const groups = buildPhaseGroups(task.workflowProgress, task.meta?.phases);
  const title = header(task, task.meta, groups, task.agentCount, now);
  const active = workflowActive(task);
  const rows: DetailRow[] = [
    [part(title.name, 'heading'), part(' · '), part(title.stats, 'number'), ...(title.state ? [part(' · '), statePart(title.state)] : [])],
    title.subtext,
    [part(`${task.totalTokens} tokens · ${task.totalToolCalls} tools${task.replayedCount ? ` · ${task.replayedCount} replayed` : ''}`, 'number')],
  ];
  if (expanded) {
    for (const group of groups) {
      rows.push('', [part(group.title, 'heading'), part(' · '), statePart(group.status, group.status === 'not-started' ? 'queued' : group.status),
        part(' · '), part(`${group.doneCount}/${group.totalCount} · ${formatDuration(group.durationMs)}`, 'number')]);
      for (const agent of group.agents) {
        const state = displayState(agent, active);
        rows.push([part('  '), part(`#${agent.index}`, 'id'), part(' '), part(agent.label, 'heading'), part(' · '),
          statePart(state, state === 'interrupted' || state === 'skipped' ? 'stopped' : state), part(agent.cached ? ' · cached' : '', 'meta')]);
        const model = agent.modelId ?? agent.model;
        const meta = [agent.agentType ? part(agent.agentType) : undefined, model ? part(model) : undefined,
          agent.thinking ? part(`thinking ${agent.thinking}`) : undefined,
          agent.requestedThinking ? part(`(asked ${agent.requestedThinking})`, 'meta') : undefined,
          agent.attempt ? part(`attempt ${agent.attempt}`, 'number') : undefined,
          agent.lastAttemptReason ? part(agent.lastAttemptReason) : undefined,
          agent.tokens === undefined ? undefined : part(`${agent.tokens} tokens`, 'number'),
          agent.toolCalls === undefined ? undefined : part(`${agent.toolCalls} tools`, 'number')].filter(value => value !== undefined);
        rows.push([part('    '), ...meta.flatMap((value, index) => index ? [part(' · '), value] : [value])]);
        if (agent.promptPreview) rows.push(field('    Prompt:', agent.promptPreview));
        if (agent.resultPreview) rows.push(field('    Result:', agent.resultPreview));
        if (agent.error) rows.push(field('    Error:', part(agent.error, 'error')));
      }
    }
    if (task.logs.length) rows.push('', [part('Logs', 'label')], ...task.logs);
    if (!active) rows.push('', [part('Result', 'label')], [part(workflowResultText(task), task.error === undefined ? undefined : 'error')]);
  }
  return {rows};
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
  return { ...stateLine(task.status === 'killed' ? 'stopped' : task.status === 'paused' ? 'queued' : task.status), title: 'Workflow', summary: `${title.name} · ${title.stats}${title.state ? ` · ${title.state}` : ''}`,
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
      this.setText(detailsText(workflowDetails(task, this.expanded, now), this.theme));
    }
    return super.render(width);
  }
}
