// Schedule details/cancellation adapted from pi-subagents 0.23.0 (MIT).
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { browse, type BrowsePage } from '../../ui/browser.ts';
import { showDetails } from '../../ui/details.ts';
import type { Dock } from '../../ui/dock.ts';
import type { AgentScheduler } from './index.ts';
import type { ScheduledAgent } from './store.ts';
import { field, part, plainDetailLines, statePart, type StructuredDetails } from '../../ui/structured-details.ts';

const details = (job: ScheduledAgent): StructuredDetails => ({rows: [
  [part(job.name, 'heading')], field('ID:', part(job.id, 'id')), field('Type:', job.request.type),
  field('Schedule:', job.schedule, part(` (${job.scheduleType})`, 'meta')),
  field('Enabled:', statePart(job.enabled, job.enabled ? 'enabled' : 'disabled')), null,
  field('Next:', part(job.nextRun ?? '—', 'meta')),
  field('Last:', part(job.lastRun ?? '—', 'meta'), part(' ('), statePart(job.lastStatus ?? '—'), part(')')),
  field('Runs:', part(job.runCount, 'number')), field('Agent:', part(job.lastAgentId ?? '—', 'id')),
  ...(job.lastError !== undefined ? [null, [part(job.lastError, 'error')]] : []), '', job.request.prompt,
]});

export async function showSchedules(ctx: ExtensionContext, scheduler: AgentScheduler, dock: Dock, page: BrowsePage): Promise<void> {
  for (; !page.navigation?.closed;) {
    let action = 'details';
    const id = await browse(ctx, dock, { title: 'Subagents', state: page.state, pages: page.pages, navigation: page.navigation,
      selection: item => { const job = scheduler.list().find(job => job.id === item.value)!; return {name: job.name, id: job.id}; },
      ticking: () => scheduler.list().some(job => job.enabled || job.lastStatus === 'running'),
      items: () => scheduler.list().map(job => ({ value: job.id, status: job.lastStatus, label: `${job.name} · ${job.schedule}`, description: job.request.type,
        search: `${job.id} ${job.name} ${job.schedule} ${job.request.type} ${job.request.prompt}`, details: () => details(job) })),
      actions: (item, done) => [{ key: 'x', label: 'Cancel schedule', run: () => { action = 'cancel'; done(item.value); } }],
    });
    if (id === undefined || page.navigation?.closed) return;
    const job = scheduler.list().find(job => job.id === id);
    if (!job) continue;
    if (action === 'details') await showDetails(ctx, dock, job.name, details(job), 'text', page.navigation);
    else if (await ctx.ui.confirm(`Cancel "${job.name}"?`, plainDetailLines(details(job)).join('\n'))) {
      await scheduler.remove(job.id); ctx.ui.notify(`Cancelled: ${job.name}`);
    }
  }
}
