import { createBashToolDefinition, createPowerShellToolDefinition, type ExtensionAPI, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { registerToolRenderers } from './tools.ts';
import * as tasks from '../tasks/render.ts';
import * as jobs from '../jobs/render.ts';
import * as agents from '../agents/render.ts';
import * as goal from '../goal/render.ts';
import { askRenderers } from '../ask/tool-render.ts';
import { workflowRenderers } from '../agents/workflow/render.ts';
import { waitRenderers } from './wait-render.ts';
import { loadConfig } from './config.ts';
import { builtinCommandRenderers } from '../ui/rendering/builtin-command.ts';

/** Display definitions load with the extension; they neither admit nor execute tools.
 * Children pass their admitted config snapshot (or an owner-supplied provider), not execution cwd.
 */
export function registerSuiteRenderers(pi: ExtensionAPI, commandHighlight?: boolean | (() => boolean)): void {
  // Factory scope has no session cwd. Freeze each context's saved option on first display;
  // /reload creates a fresh registry, including when history is rebuilt before session_start.
  const options = new Map<string, boolean>();
  const enabled = commandHighlight === undefined ? (cwd: string) => {
    if (!options.has(cwd)) options.set(cwd, loadConfig(cwd).ui.highlightBuiltinCommands);
    return options.get(cwd)!;
  } : typeof commandHighlight === 'boolean' ? () => commandHighlight : commandHighlight;
  if (commandHighlight === undefined) pi.on('session_start', (_event, ctx) => {
    // Capture before Settings can save a new value, even if no command tool has been drawn yet.
    enabled(ctx.cwd);
  });
  // The public factories expose native display slots. Only those slots enter the history lookup;
  // their execute functions are neither registered nor called, just as in Transcript's native lookup.
  const slots = ({ renderCall, renderResult, renderShell }: ToolRenderers): ToolRenderers => ({ renderCall, renderResult, renderShell });
  registerToolRenderers(pi, {
    bash: slots(createBashToolDefinition(process.cwd()) as unknown as ToolRenderers),
    powershell: slots(createPowerShellToolDefinition(process.cwd()) as unknown as ToolRenderers),
    task_list: tasks.listRenderers, task_get: tasks.getRenderers, task_edit: tasks.editRenderers,
    job_start: jobs.startRenderers, job_list: jobs.listRenderers, job_get: jobs.getRenderers,
    job_read: jobs.readRenderers, job_write: jobs.writeRenderers, job_stop: jobs.stopRenderers,
    agent_start: agents.startRenderers, agent_list: agents.listRenderers, agent_get: agents.getRenderers,
    agent_read: agents.readRenderers, agent_send: agents.sendRenderers, agent_stop: agents.stopRenderers,
    agent_workflow: workflowRenderers(), ask_user: askRenderers(), wait: waitRenderers,
    goal_complete: goal.completeRenderers, goal_blocked: goal.blockedRenderers, goal_wait: goal.waitRenderers,
  }, { bash: base => builtinCommandRenderers(base, 'bash', enabled),
    powershell: base => builtinCommandRenderers(base, 'powershell', enabled) });
}
