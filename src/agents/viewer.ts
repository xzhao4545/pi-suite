import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import { DetailsView } from '../ui/details.ts';
import { Transcript } from '../ui/transcript.ts';
import { active, executing } from './types.ts';
import { transcript } from './records.ts';
import { AgentsModule, summaryLine } from './index.ts';

async function showAgent(ctx: ExtensionContext, agents: AgentsModule, dock: Dock, id: string, runId: string): Promise<void> {
  dock.setDetail(true);
  try {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const get = () => agents.manager.get(id, runId);
      const content = new Transcript(tui, ctx.cwd, name => get().run?.renderers?.get(name));
      content.setEntries(transcript(get().record, get().run));
      const view = new DetailsView(tui, () => summaryLine(get().record), content, done, [
        { label: 'Tools', run: () => { content.toggleTools(); view.invalidate(); } },
        { label: 'Thinking', run: () => { content.toggleThinking(); view.invalidate(); } },
      ]);
      view.reader.setContent(content, active(get().record.state));
      let revision = '';
      const refresh = () => {
        const { record, run } = get(), entries = transcript(record, run);
        const next = `${entries.length}:${record.state}:${JSON.stringify(entries.at(-1))}`;
        if (next === revision) return;
        revision = next;
        const follow = view.reader.atBottom;
        content.setEntries(entries); view.reader.setContent(content, follow); tui.requestRender();
      };
      const unsubscribe = agents.manager.subscribe(refresh);
      return Object.assign(view, { dispose: unsubscribe });
    });
  } finally { dock.setDetail(false); }
}
export function registerAgentsCommand(pi: ExtensionAPI, agents: AgentsModule, dock: Dock, notices: Notifications): void {
  pi.registerCommand('agents', { description: 'Read child sessions and stop their execution trees', handler: async (args, ctx) => {
    if (ctx.mode !== 'tui') { ctx.ui.notify('Use agent_list and agent_read outside the terminal UI'); return; }
    const release = notices.hold();
    try {
      const state = args.trim() || await ctx.ui.select('Agents', ['active', 'queued', 'finished', 'all']);
      if (!state) return;
      const scope = agents.scope(ctx);
      const records = agents.manager.records().filter(record => agents.manager.visible(record, scope))
        .filter(record => state === 'all' || state === 'active' && executing(record.state) || state === 'queued' && record.state === 'queued' || state === 'finished' && !active(record.state))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (!records.length) { ctx.ui.notify(`No ${state} agents`); return; }
      const labels = records.map(summaryLine), selected = await ctx.ui.select('Select agent run', labels);
      if (!selected) return;
      const record = records[labels.indexOf(selected)];
      const action = await ctx.ui.select(summaryLine(record), ['Transcript', 'Stop child, nested agents and jobs']);
      if (action === 'Transcript') await showAgent(ctx, agents, dock, record.id, record.runId);
      else if (action) {
        const outcome = await agents.manager.stop(record.id, record.runId);
        ctx.ui.notify(`${record.id} ${outcome.state} · cleanup ${outcome.cleanup}`);
      }
    } finally { release(); }
  } });
}
