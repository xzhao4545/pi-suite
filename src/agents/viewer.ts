import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dock } from '../ui/dock.ts';
import { DetailsView } from '../ui/details.ts';
import { Transcript } from '../ui/transcript.ts';
import { active } from './types.ts';
import { transcript } from './records.ts';
import { AgentsModule, summaryLine } from './index.ts';
import { editAgentModel } from './model-editor.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { ScrollView } from '../ui/scroll.ts';
import { jobActions, type ViewerDeps } from '../jobs/viewer.ts';
import { isActive as jobActive } from '../jobs/state.ts';
import { displayName as jobName, summaryLine as jobSummary } from '../jobs/index.ts';
import { browse, browseState } from '../ui/browser.ts';
import { jobDetail } from '../jobs/query.ts';

export type AgentJobViewer = { pi: ExtensionAPI; viewer: ViewerDeps };
export async function showAgentJobs(ctx: ExtensionContext, deps: AgentJobViewer, runId: string, readonly: boolean): Promise<void> {
  const release = deps.viewer.notifications.hold();
  const viewState = browseState();
  try { for (;;) {
    // Creator ancestry selects the entire execution subtree, including jobs left by
    // collected children. Task references and another run of this agent do not confer ownership.
    const current = () => deps.viewer.jobs.createdBy([runId]).filter(jobActive);
    if (!current().length) { ctx.ui.notify('No active jobs owned by this run'); return; }
    const selected = await browse(ctx, deps.viewer.dock, { title: 'Jobs owned by this run and its descendants', state: viewState,
      subscribe: refresh => deps.viewer.jobs.control().subscribe(refresh), ticking: () => current().length > 0,
      items: () => current().map(job => ({ value: job.id, label: `${jobSummary(job)} · ${jobName(job)}`,
        search: `${job.id} ${jobName(job)} ${job.state} ${job.command} ${job.cwd}`, details: () => jobDetail(job, true).join('\n') })),
    });
    if (selected === undefined) return;
    const job = current().find(job => job.id === selected);
    if (!job) continue;
    await jobActions(deps.pi, ctx, deps.viewer, job.id, readonly, job.cwd);
  } } finally { release(); }
}

export function agentControls(ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>, id: string, runId: string, readonly: boolean) {
  const get = () => agents.manager.get(id, runId);
  const canStop = () => { const run = get().run; return Boolean(!readonly && run && !run.settled && active(run.record.state) && run.record.state !== 'stopping'); };
  const canMessage = () => {
    const { record, run } = get(), scope = agents.scope(ctx);
    if (!canStop() || record.state === 'queued' || agents.manager.get(id).record.runId !== runId) return false;
    return run?.question ? agents.manager.questionVisible(record, scope) : agents.manager.visible(record, scope);
  };
  return { get, canStop, canMessage };
}

export async function performAgentAction(action: string, ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>,
  id: string, runId: string, readonly: boolean, config: () => SuiteConfig, jobs?: AgentJobViewer): Promise<void> {
  const { get, canMessage } = agentControls(ctx, agents, id, runId, readonly);
  if (action === 'jobs') await showAgentJobs(ctx, jobs!, runId, readonly);
  else if (action === 'model' && !readonly) await editAgentModel(ctx, agents.manager, id, config());
  else if (action === 'message') {
    const message = (await ctx.ui.input(get().run?.question ? 'Answer parent question' : 'Message agent'))?.trim();
    if (!message) return;
    // Input can outlive this run. Do not send a late answer to its successor or resume it.
    if (!canMessage()) { ctx.ui.notify('This run no longer accepts messages'); return; }
    const result = await agents.manager.send(id, message, agents.scope(ctx), config());
    ctx.ui.notify(`${id}: ${result.action}`);
  } else if (action === 'background' && !readonly) agents.manager.sendToBackground(id, runId);
  else if (action === 'stop' && !readonly) {
    const outcome = await agents.manager.stop(id, runId);
    ctx.ui.notify(`${id} ${outcome.state} · cleanup ${outcome.cleanup}`);
  }
}

export async function showAgent(ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>, dock: Dock, id: string, runId: string, config: () => SuiteConfig, readonly = false, jobs?: AgentJobViewer): Promise<void> {
  const release = agents.manager.retain(runId);
  let content: Transcript | undefined, reader: ScrollView | undefined;
  const { get, canStop, canMessage } = agentControls(ctx, agents, id, runId, readonly);
  try { for (;;) {
    dock.setDetail(true);
    let action: 'model' | 'message' | 'stop' | 'jobs' | undefined;
    try {
      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
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
        ], reader, canMessage() ? 'Message' : undefined, theme);
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
      if (action !== 'stop' || canStop()) await performAgentAction(action, ctx, agents, id, runId, readonly, config, jobs);
    } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
  } } finally { release(); }
}
