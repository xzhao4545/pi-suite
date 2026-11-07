import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerToolRenderers } from './tools.ts';
import * as tasks from '../tasks/render.ts';
import * as jobs from '../jobs/render.ts';
import * as agents from '../agents/render.ts';
import * as goal from '../goal/render.ts';
import { askRenderers } from '../ask/tool-render.ts';
import { workflowRenderers } from '../agents/workflow/render.ts';
import { waitRenderers } from './wait-render.ts';

/** Display definitions load with the extension; they neither admit nor execute tools. */
export function registerSuiteRenderers(pi: ExtensionAPI): void {
  registerToolRenderers(pi, {
    task_list: tasks.listRenderers, task_get: tasks.getRenderers, task_edit: tasks.editRenderers,
    job_start: jobs.startRenderers, job_list: jobs.listRenderers, job_get: jobs.getRenderers,
    job_read: jobs.readRenderers, job_write: jobs.writeRenderers, job_stop: jobs.stopRenderers,
    agent_start: agents.startRenderers, agent_list: agents.listRenderers, agent_get: agents.getRenderers,
    agent_read: agents.readRenderers, agent_send: agents.sendRenderers, agent_stop: agents.stopRenderers,
    agent_workflow: workflowRenderers(), ask_user: askRenderers(), wait: waitRenderers,
    goal_complete: goal.completeRenderers, goal_blocked: goal.blockedRenderers, goal_wait: goal.waitRenderers,
  });
}
