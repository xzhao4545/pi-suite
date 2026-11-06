// Schedule details/cancellation adapted from pi-subagents 0.23.0 (MIT).
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { browse, type BrowsePage } from '../../ui/browser.ts';
import { showDetails } from '../../ui/details.ts';
import type { Dock } from '../../ui/dock.ts';
import type { AgentScheduler } from './index.ts';
import type { ScheduledAgent } from './store.ts';

const details = (job: ScheduledAgent) => [job.name, `ID: ${job.id}`, `Type: ${job.request.type}`, `Schedule: ${job.schedule} (${job.scheduleType})`,
  `Enabled: ${job.enabled}`, `Next: ${job.nextRun ?? '—'}`, `Last: ${job.lastRun ?? '—'} (${job.lastStatus ?? '—'})`,
  `Runs: ${job.runCount}`, `Agent: ${job.lastAgentId ?? '—'}`, job.lastError, '', job.request.prompt].filter(value => value !== undefined).join('\n');

export async function showSchedules(ctx: ExtensionContext, scheduler: AgentScheduler, dock: Dock, page: BrowsePage): Promise<void> {
  for (;;) {
    let action = 'details';
    const id = await browse(ctx, dock, { title: 'Subagents', state: page.state, controls: [page.navigation],
      ticking: () => scheduler.list().some(job => job.enabled || job.lastStatus === 'running'),
      items: () => scheduler.list().map(job => ({ value: job.id, label: `${job.name} · ${job.schedule}`, description: job.request.type,
        search: `${job.id} ${job.name} ${job.schedule} ${job.request.type} ${job.request.prompt}`, details: () => details(job) })),
      actions: (item, done) => [{ label: 'Details', run: () => done(item.value) },
        { label: 'Cancel schedule', run: () => { action = 'cancel'; done(item.value); } }],
    });
    if (id === undefined) return;
    const job = scheduler.list().find(job => job.id === id);
    if (!job) continue;
    if (action === 'details') await showDetails(ctx, dock, job.name, details(job));
    else if (await ctx.ui.confirm(`Cancel "${job.name}"?`, details(job))) {
      await scheduler.remove(job.id); ctx.ui.notify(`Cancelled "${job.name}"`);
    }
  }
}
