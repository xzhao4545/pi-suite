import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import { DetailsView } from '../ui/details.ts';
import { Transcript } from '../ui/transcript.ts';
import { active, executing } from './types.ts';
import { transcript } from './records.ts';
import { AgentsModule, summaryLine } from './index.ts';
import { editAgentModel, showAgentTypes } from './model-editor.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { ScrollView } from '../ui/scroll.ts';
import type { AgentScheduler } from './schedules/index.ts';
import { showSchedules } from './schedules/menu.ts';

export async function showAgent(ctx: ExtensionContext, agents: AgentsModule, dock: Dock, id: string, runId: string, config: () => SuiteConfig): Promise<void> {
  const release = agents.manager.retain(runId);
  let content: Transcript | undefined, reader: ScrollView | undefined;
  try { for (;;) {
    dock.setDetail(true);
    let editing = false;
    try {
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        const get = () => agents.manager.get(id, runId);
        content ??= new Transcript(tui, ctx.cwd, name => get().run?.renderers?.get(name));
        content.setEntries(transcript(get().record, get().run));
        const view = new DetailsView(tui, () => `${summaryLine(get().record)} · ${get().record.model} (${get().record.modelSource}) · thinking ${get().record.thinking} (${get().record.thinkingSource})`, content, done, [
          { label: 'Tools', run: () => { content!.toggleTools(); view.invalidate(); } },
          { label: 'Thinking', run: () => { content!.toggleThinking(); view.invalidate(); } },
          { label: 'Model / thinking', run: () => { editing = true; done(); } },
        ], reader);
        view.reader.setContent(content, reader ? reader.atBottom : active(get().record.state));
        reader = view.reader;
        let revision = '';
        const refresh = () => {
          const { record, run } = get(), entries = transcript(record, run);
          const next = `${entries.length}:${record.state}:${JSON.stringify(entries.at(-1))}`;
          if (next === revision) return;
          revision = next;
          const follow = view.reader.atBottom;
          content!.setEntries(entries); view.reader.setContent(content!, follow); tui.requestRender();
        };
        const unsubscribe = agents.manager.subscribe(refresh);
        return Object.assign(view, { dispose: unsubscribe });
      });
    } finally { dock.setDetail(false); }
    if (!editing) return;
    await editAgentModel(ctx, agents.manager, id, config());
  } } finally { release(); }
}
export function registerAgentsCommand(pi: ExtensionAPI, agents: AgentsModule, dock: Dock, notices: Notifications, config: () => SuiteConfig, reload: (cwd: string) => void, scheduler?: AgentScheduler,
  workflows?: {available(): boolean; show(ctx: ExtensionContext): Promise<void>}): void {
  pi.registerCommand('agents', { description: 'Read child sessions, configure models and stop execution trees', handler: async (args, ctx) => {
    if (ctx.mode !== 'tui') { ctx.ui.notify('Use agent_list and agent_read outside the terminal UI'); return; }
    const release = notices.hold();
    try {
      const state = args.trim() || await ctx.ui.select('Agents', ['active', 'queued', 'finished', 'all', 'Types · enable / model / thinking', ...scheduler?.isActive ? ['Scheduled agents'] : [], ...workflows?.available() ? ['Workflows'] : []]);
      if (!state) return;
      if (state === 'workflows' || state === 'Workflows') { await workflows?.show(ctx); return; }
      if (state === 'schedules' || state === 'Scheduled agents') { if (scheduler) await showSchedules(ctx, scheduler); return; }
      if (state === 'Types · enable / model / thinking' || state === 'types') { await showAgentTypes(ctx, config(), reload); return; }
      const scope = agents.scope(ctx);
      const records = agents.manager.records().filter(record => agents.manager.visible(record, scope))
        .filter(record => state === 'all' || state === 'active' && executing(record.state) || state === 'queued' && record.state === 'queued' || state === 'finished' && !active(record.state))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (!records.length) { ctx.ui.notify(`No ${state} agents`); return; }
      const labels = records.map(summaryLine), selected = await ctx.ui.select('Select agent run', labels);
      if (!selected) return;
      const record = records[labels.indexOf(selected)];
      const action = await ctx.ui.select(`${summaryLine(record)}\nModel: ${record.model} (${record.modelSource})\nThinking: ${record.thinking} (${record.thinkingSource})`, ['Transcript', 'Model / thinking', 'Stop child, nested agents and jobs']);
      if (action === 'Transcript') await showAgent(ctx, agents, dock, record.id, record.runId, config);
      else if (action === 'Model / thinking') await editAgentModel(ctx, agents.manager, record.id, config());
      else if (action) {
        const outcome = await agents.manager.stop(record.id, record.runId);
        ctx.ui.notify(`${record.id} ${outcome.state} · cleanup ${outcome.cleanup}`);
      }
    } finally { release(); }
  } });
}
