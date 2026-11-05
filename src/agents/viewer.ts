import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import { DetailsView } from '../ui/details.ts';
import { Transcript } from '../ui/transcript.ts';
import { active, executing, recordWorkspace } from './types.ts';
import { transcript } from './records.ts';
import { AgentsModule, summaryLine } from './index.ts';
import { editAgentModel, showAgentTypes } from './model-editor.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { ScrollView } from '../ui/scroll.ts';
import type { AgentScheduler } from './schedules/index.ts';
import { showSchedules } from './schedules/menu.ts';
import { selectValue } from '../ui/select.ts';
import { jobActions, type ViewerDeps } from '../jobs/viewer.ts';
import { isActive as jobActive } from '../jobs/state.ts';
import { displayName as jobName, summaryLine as jobSummary } from '../jobs/index.ts';

export type AgentJobViewer = { pi: ExtensionAPI; viewer: ViewerDeps };
async function showAgentJobs(ctx: ExtensionContext, deps: AgentJobViewer, runId: string, readonly: boolean): Promise<void> {
  const release = deps.viewer.notifications.hold();
  let selected: string | undefined;
  try { for (;;) {
    // Creator ancestry selects the entire execution subtree, including jobs left by
    // collected children. Task references and another run of this agent do not confer ownership.
    const jobs = deps.viewer.jobs.createdBy([runId]).filter(jobActive);
    if (!jobs.length) { ctx.ui.notify('No active jobs owned by this run'); return; }
    selected = await selectValue(ctx, 'Jobs owned by this run and its descendants', jobs.map(job => ({
      value: job.id, label: `${jobSummary(job)} · ${jobName(job)}`,
    })), selected);
    if (selected === undefined) return;
    const job = jobs.find(job => job.id === selected)!;
    await jobActions(deps.pi, ctx, deps.viewer, job.id, readonly, job.cwd);
  } } finally { release(); }
}

export async function showAgent(ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>, dock: Dock, id: string, runId: string, config: () => SuiteConfig, readonly = false, jobs?: AgentJobViewer): Promise<void> {
  const release = agents.manager.retain(runId);
  let content: Transcript | undefined, reader: ScrollView | undefined;
  const get = () => agents.manager.get(id, runId);
  const canStop = () => { const run = get().run; return Boolean(!readonly && run && !run.settled && active(run.record.state) && run.record.state !== 'stopping'); };
  const canMessage = () => {
    const { record, run } = get(), scope = agents.scope(ctx);
    if (!canStop() || agents.manager.get(id).record.runId !== runId) return false;
    return run?.question ? agents.manager.questionVisible(record, scope) : agents.manager.visible(record, scope);
  };
  try { for (;;) {
    dock.setDetail(true);
    let action: 'model' | 'message' | 'stop' | 'jobs' | undefined;
    try {
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        content ??= new Transcript(tui, get().record.cwd, name => get().run?.renderers?.get(name));
        content.setEntries(transcript(get().record, get().run));
        const view = new DetailsView(tui, () => `${summaryLine(get().record)} · ${get().record.model} (${get().record.modelSource}) · thinking ${get().record.thinking} (${get().record.thinkingSource})`, content, done, [
          { label: 'Message', available: canMessage, run: () => { action = 'message'; done(); } },
          { label: 'Tools', run: () => { content!.toggleTools(); view.invalidate(); } },
          { label: 'Thinking', run: () => { content!.toggleThinking(); view.invalidate(); } },
          { label: 'Jobs', available: () => jobs !== undefined, run: () => { action = 'jobs'; done(); } },
          { label: 'Model / thinking', available: () => !readonly, run: () => { action = 'model'; done(); } },
          { label: 'Background', key: 'b', available: () => !readonly && agents.manager.canSendToBackground(id, runId), run: () => { agents.manager.sendToBackground(id, runId); } },
          { label: 'Stop subtree', key: 'x', confirm: '再按 x 停止', available: canStop, run: () => { action = 'stop'; done(); } },
        ], reader, canMessage() ? 'Message' : undefined);
        view.reader.setContent(content, reader ? reader.atBottom : active(get().record.state));
        reader = view.reader;
        let revision = transcript(get().record, get().run);
        const refresh = () => {
          const { record, run } = get(), entries = transcript(record, run);
          // Several tools can stream concurrently. Compare every immutable entry identity,
          // since an unchanged last tool result says nothing about an earlier live tail.
          if (entries.length !== revision.length || entries.some((entry, index) => entry !== revision[index])) {
            revision = entries;
            const follow = view.reader.atBottom;
            content!.setEntries(entries); view.reader.setContent(content!, follow);
          }
          tui.requestRender();
        };
        const unsubscribe = agents.manager.subscribe(refresh);
        return Object.assign(view, { dispose: unsubscribe });
      });
    } finally { dock.setDetail(false); }
    if (!action) return;
    // Close custom UI before opening an editor or awaiting lifecycle control. The same
    // reader survives these trips, while its run stays retained throughout.
    try {
      if (action === 'jobs') await showAgentJobs(ctx, jobs!, runId, readonly);
      else if (action === 'model') await editAgentModel(ctx, agents.manager, id, config());
      else if (action === 'message') {
        const message = (await ctx.ui.input(get().run?.question ? 'Answer parent question' : 'Message agent'))?.trim();
        if (!message) continue;
        // Input may outlive this execution. Never turn a late submit into an implicit
        // resume, or route an old transcript's text into the newest run of the same ID.
        if (!canMessage()) { ctx.ui.notify('This run no longer accepts messages'); continue; }
        const result = await agents.manager.send(id, message, agents.scope(ctx), config());
        ctx.ui.notify(`${id}: ${result.action}`);
      } else if (canStop()) {
        const outcome = await agents.manager.stop(id, runId);
        ctx.ui.notify(`${id} ${outcome.state} · cleanup ${outcome.cleanup}`);
      }
    } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
  } } finally { release(); }
}
export function registerAgentsCommand(pi: ExtensionAPI, agents: AgentsModule, dock: Dock, notices: Notifications, config: () => SuiteConfig, reload: (cwd: string) => void, scheduler?: AgentScheduler,
  workflows?: {available(): boolean; show(ctx: ExtensionContext): Promise<void>}, jobs?: AgentJobViewer): void {
  pi.registerCommand('agents', { description: 'Read child sessions and workspace history, configure models and stop execution trees', handler: async (args, ctx) => {
    if (ctx.mode !== 'tui') { ctx.ui.notify('Use agent_list and agent_read outside the terminal UI'); return; }
    const release = notices.hold();
    try {
      const selectedMenu = args.trim() || await ctx.ui.select('Agents', ['active', 'queued', 'finished', 'all', 'Workspace records', 'Types · enable / model / thinking', ...scheduler?.isActive ? ['Scheduled agents'] : [], ...workflows?.available() ? ['Workflows'] : []]);
      if (!selectedMenu) return;
      if (selectedMenu === 'workflows' || selectedMenu === 'Workflows') { await workflows?.show(ctx); return; }
      if (selectedMenu === 'schedules' || selectedMenu === 'Scheduled agents') { if (scheduler) await showSchedules(ctx, scheduler); return; }
      if (selectedMenu === 'Types · enable / model / thinking' || selectedMenu === 'types') { await showAgentTypes(ctx, config(), reload); return; }
      const [command, filter] = selectedMenu.split(/\s+/), workspace = command === 'workspace' || selectedMenu === 'Workspace records';
      const state = workspace ? command === 'workspace' ? filter ?? 'all' : 'all' : selectedMenu;
      const scope = agents.scope(ctx);
      if (workspace) await agents.manager.discover(scope, config());
      const records = agents.manager.records().filter(record => workspace
        ? recordWorkspace(record) === (scope.run?.configCwd ?? ctx.cwd) && (scope.run || record.workflowId === undefined)
        : agents.manager.visible(record, scope))
        .filter(record => state === 'all' || state === 'active' && executing(record.state) || state === 'queued' && record.state === 'queued' || state === 'finished' && !active(record.state))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (!records.length) { ctx.ui.notify(`No ${state} agents`); return; }
      const labels = records.map(summaryLine), selected = workspace
        ? await selectValue(ctx, 'Workspace agent records', records.map(record => ({ value: record.runId, label: summaryLine(record) })))
        : await ctx.ui.select('Select agent run', labels);
      if (!selected) return;
      const record = workspace ? records.find(record => record.runId === selected)! : records[labels.indexOf(selected)];
      const run = agents.manager.get(record.id, record.runId).run;
      // Discovery preserves ownership. Archived foreign branches can be read, while
      // live handles and the current branch keep their existing management contract.
      const readonly = !agents.manager.visible(record, scope) && (!run || run.settled === true);
      const title = `${summaryLine(record)}\nModel: ${record.model} (${record.modelSource})\nThinking: ${record.thinking} (${record.thinkingSource})`;
      const actions = ['Transcript', ...jobs ? ['Jobs'] : [], ...readonly ? [] : ['Model / thinking', 'Stop child, nested agents and jobs']];
      const action = workspace ? await selectValue(ctx, title.replace(/\n/g, ' · '), actions.map(label => ({ value: label, label }))) : await ctx.ui.select(title, actions);
      if (action === 'Transcript') await showAgent(ctx, agents, dock, record.id, record.runId, config, readonly, jobs);
      else if (action === 'Jobs') await showAgentJobs(ctx, jobs!, record.runId, readonly);
      else if (action === 'Model / thinking') await editAgentModel(ctx, agents.manager, record.id, config());
      else if (action) {
        const outcome = await agents.manager.stop(record.id, record.runId);
        ctx.ui.notify(`${record.id} ${outcome.state} · cleanup ${outcome.cleanup}`);
      }
    } finally { release(); }
  } });
}
