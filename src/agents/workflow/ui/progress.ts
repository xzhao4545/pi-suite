// Workflow tree and inspector fields adapted from pi-subagents 0.23.0 ui/workflow-{card,dialog}.ts.
// Text wrapping and reading/search state are owned by the suite's native UI components.
import { Text } from '@earendil-works/pi-tui';
import { sanitizeText } from '../../../runtime/text.ts';
import { workflowActive } from '../manager.ts';
import { buildPhaseGroups, displayState, formatDuration, header } from '../progress/index.ts';
import { workflowResultText, type WorkflowTask } from '../task.ts';

export class WorkflowProgress extends Text {
  private revision = '';
  constructor(private task: WorkflowTask, private expanded = true) { super('', 0, 0); }
  override render(width: number): string[] {
    const task = this.task, now = Date.now();
    const revision = `${task.progressVersion}:${task.status}:${task.endTime}:${task.error}:${Math.floor(now / 1000)}`;
    if (revision !== this.revision) {
      this.revision = revision;
      const groups = buildPhaseGroups(task.workflowProgress, task.meta?.phases);
      const title = header(task, task.meta, groups, task.agentCount, now);
      const lines = [`${title.name} · ${title.stats}`, title.subtext,
        `${task.totalTokens} tokens · ${task.totalToolCalls} tools${task.replayedCount ? ` · ${task.replayedCount} replayed` : ''}`];
      if (this.expanded) {
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
      this.setText(sanitizeText(lines.filter(line => line !== undefined).join('\n')));
    }
    return super.render(width);
  }
}
