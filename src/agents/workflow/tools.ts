import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Text } from '@earendil-works/pi-tui';
import { readConfig, type SuiteConfig } from '../../runtime/config.ts';
import { ToolError } from '../../runtime/errors.ts';
import { textResult, registerBoundTool } from '../../runtime/tools.ts';
import type { AgentsModule } from '../index.ts';
import { agentTypes } from '../catalog.ts';
import { fullWorkflowToolDescription } from './tool-description.ts';
import { workflowSummary, type WorkflowsModule } from './index.ts';
import { decideWorkflowCollision } from './collisions.ts';
import { WORKFLOW_ENTRY_TYPE, decodeWorkflowEntry, taskFromEntry } from './entry.ts';
import { WorkflowProgress } from './ui/progress.ts';

const schema = Type.Object({script: Type.Optional(Type.String({minLength: 1})), scriptPath: Type.Optional(Type.String({minLength: 1})),
  name: Type.Optional(Type.String({minLength: 1})), args: Type.Optional(Type.Any()),
  resumeFromRunId: Type.Optional(Type.String({pattern: '^wf_[a-f0-9]{12}$'}))}, {additionalProperties: false});
export function registerWorkflowTool(pi: ExtensionAPI, workflows: WorkflowsModule, agents: AgentsModule, config: () => SuiteConfig) {
  let registered = false, enabled = config().agents.workflows, withdrawn = false;
  const tool: ToolDefinition<typeof schema> = {name: 'agent_workflow', label: 'Workflow', parameters: schema,
    description: fullWorkflowToolDescription.replace('{{typeList}}', 'general-purpose, Explore, Plan and configured agent types.'),
    async execute(id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      if (!enabled || !config().agents.workflows) throw new ToolError('INVALID_ARGS', 'Workflow launch is disabled for this session');
      const task = await workflows.manager.start(params, agents.scope(ctx), config(), id);
      return textResult([workflowSummary(task), `scriptPath: ${task.scriptPath}`,
        task.logs.at(-1), `resultPath: ${task.resultPath}`, `wait: wait({"ids":["${task.id}"]}) · manage: /agents workflows`],
      {id: task.id, status: task.status, scriptPath: task.scriptPath, resultPath: task.resultPath, resumedFrom: task.resumedFrom});
    },
    renderCall(args) { return new Text(`Workflow · ${args.name ?? args.scriptPath ?? 'inline script'}`, 0, 0); },
    renderResult(result, options) {
      const id = (result.details as {id?: string} | undefined)?.id;
      const task = id && workflows.manager.tasks.get(id);
      return task ? new WorkflowProgress(task, options.expanded)
        : new Text(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'), 0, 0);
    }};
  pi.registerEntryRenderer(WORKFLOW_ENTRY_TYPE, entry => {
    const data = decodeWorkflowEntry(entry.data);
    return new WorkflowProgress(workflows.manager.tasks.get(data.id) ?? taskFromEntry(data), false);
  });
  if (enabled) { pi.registerTool(tool); registered = true; }
  return {
    get enabled() { return enabled; },
    bind(ctx: ExtensionContext) {
      enabled = config().agents.workflows;
      if (enabled && !registered) { registerBoundTool(pi, tool, true); registered = true; }
      if (!registered) return;
      const description = fullWorkflowToolDescription.replace('{{typeList}}', agentTypes(ctx.cwd, getAgentDir(), {
        trusted: ctx.isProjectTrusted(), packageGate: config().agents.packageAgents,
      }).filter(type => type.enabled !== false).map(type => `${type.name}: ${type.description}`).join('\n'));
      if (description !== tool.description) {
        tool.description = description; registerBoundTool(pi, tool);
      }
      const pinned = (readConfig(join(ctx.cwd, '.pi', 'pi-suite.json')).agents?.workflows
        ?? readConfig(join(getAgentDir(), 'pi-suite.json')).agents?.workflows) === true;
      const collision = decideWorkflowCollision({tools: pi.getAllTools(), ownDescription: tool.description, pinned});
      if (enabled && collision.kind !== 'none') {
        ctx.ui.notify(collision.message, 'warning');
        if (collision.kind === 'standDown') enabled = false;
      }
      // Config/collision withdraws only this tool; unrelated active-tool choices are preserved.
      const own = pi.getAllTools().find(info => info.name === tool.name)?.description === tool.description;
      if (own && !enabled && pi.getActiveTools().includes(tool.name)) {
        withdrawn = true; pi.setActiveTools(pi.getActiveTools().filter(name => name !== tool.name));
      } else if (own && enabled && withdrawn) {
        withdrawn = false; pi.setActiveTools([...pi.getActiveTools(), tool.name]);
      }
    },
  };
}
