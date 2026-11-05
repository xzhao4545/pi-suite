// Schedule details/cancellation adapted from @tintinweb/pi-subagents 0.23.0
// src/ui/schedule-menu.ts (MIT), using the shared native value picker.
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { selectValue } from '../../ui/select.ts';
import type { AgentScheduler } from './index.ts';

export async function showSchedules(ctx: ExtensionContext, scheduler: AgentScheduler): Promise<void> {
  if (!scheduler.isActive) { ctx.ui.notify('Scheduling is disabled in this session'); return; }
  const jobs = scheduler.list();
  if (!jobs.length) { ctx.ui.notify('No scheduled agents'); return; }
  const id = await selectValue(ctx, `Scheduled agents (${jobs.length})`, jobs.map(job => ({ value: job.id,
    label: `${job.name} · ${job.schedule} · ${job.request.type}`, description: `${job.enabled ? 'enabled' : 'disabled'} · next ${job.nextRun ?? '—'} · last ${job.lastStatus ?? '—'} · runs ${job.runCount}` })));
  const job = jobs.find(item => item.id === id);
  if (!job) return;
  const details = [`id: ${job.id}`, `type: ${job.request.type}`, `schedule: ${job.schedule} (${job.scheduleType})`, `next: ${job.nextRun ?? '—'}`,
    `last: ${job.lastRun ?? '—'} (${job.lastStatus ?? '—'})`, `runs: ${job.runCount}`, `agent: ${job.lastAgentId ?? '—'}`, job.lastError, `prompt: ${job.request.prompt}`].filter(Boolean).join('\n');
  if (!await ctx.ui.confirm(`Cancel "${job.name}"?`, details)) return;
  await scheduler.remove(job.id); ctx.ui.notify(`Cancelled "${job.name}"`);
}
