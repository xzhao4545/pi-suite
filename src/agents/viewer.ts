import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dock } from '../ui/dock.ts';
import type { InlineRequest } from '../ui/inline-input.ts';
import { DetailsView } from '../ui/details.ts';
import { openReading } from '../ui/reading.ts';
import { Transcript } from '../ui/transcript.ts';
import { active, type AgentRecord } from './types.ts';
import { sanitizeText } from '../runtime/text.ts';
import { transcript } from './records.ts';
import { AgentsModule } from './index.ts';
import { editAgentModel } from './model-editor.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { ScrollView } from '../ui/scroll.ts';
import { jobActions, type ViewerDeps } from '../jobs/viewer.ts';
import { isActive as jobActive } from '../jobs/state.ts';
import { displayName as jobName, summaryLine as jobSummary } from '../jobs/index.ts';
import { browse, browseState, compareActivity } from '../ui/browser.ts';
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
    const selected = await browse(ctx, deps.viewer.dock, { title: 'Subagents', page: 'Jobs', scope: 'Run subtree', state: viewState,
      selection: item => ({name: jobName(current().find(job => job.id === item.value)!), id: item.value}),
      subscribe: refresh => deps.viewer.jobs.control().subscribe(refresh), ticking: () => current().length > 0,
      items: () => current().sort((a, b) => compareActivity(a, b, jobActive)).map(job => ({ value: job.id, status: job.state, label: `${jobSummary(job)} · ${jobName(job)}`,
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

export function agentMessage(ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>, id: string, runId: string,
  readonly: boolean, config: () => SuiteConfig, sent?: () => void): InlineRequest {
  const {get, canMessage} = agentControls(ctx, agents, id, runId, readonly);
  return {prompt: get().run?.question ? 'Answer parent question: ' : `Message ${get().record.name}: `, submit: async message => {
    // The composer can outlive a run; never send an old reader's input to its successor.
    if (!canMessage()) throw new Error('This run no longer accepts messages');
    const result = await agents.manager.send(id, message, agents.scope(ctx), config());
    sent?.();
    return `${get().record.name}: ${result.action}`;
  }};
}

export async function performAgentAction(action: string, ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>,
  id: string, runId: string, readonly: boolean, config: () => SuiteConfig, jobs?: AgentJobViewer): Promise<void> {
  if (action === 'jobs') await showAgentJobs(ctx, jobs!, runId, readonly);
  else if (action === 'model' && !readonly) await editAgentModel(ctx, agents.manager, id, config(), runId);
  else if (action === 'background' && !readonly) agents.manager.sendToBackground(id, runId);
  else if (action === 'stop' && !readonly) {
    const outcome = await agents.manager.stop(id, runId);
    ctx.ui.notify(`${id} ${outcome.state} · cleanup ${outcome.cleanup}`);
  }
}

/** The name the parent gave leads; state, timing and model identify the run, the ID trails for agent_* calls. */
function transcriptTitle(record: AgentRecord): string {
  const name = sanitizeText(record.name).replace(/[\r\n\t]/g, ' ');
  const elapsed = record.elapsedMs === undefined ? '' : ` · ${(record.elapsedMs / 1000).toFixed(1)}s`;
  return `Subagents ▸ ${name} · ${record.state}${elapsed} · ${record.model} · thinking ${record.thinking} · ${record.id}`;
}

export async function showAgent(ctx: ExtensionContext, agents: Pick<AgentsModule, 'manager' | 'scope'>, dock: Dock, id: string, runId: string, config: () => SuiteConfig, readonly = false, jobs?: AgentJobViewer): Promise<void> {
  const release = agents.manager.retain(runId);
  let content: Transcript | undefined, reader: ScrollView | undefined;
  const { get, canStop, canMessage } = agentControls(ctx, agents, id, runId, readonly);
  try { for (;;) {
    dock.setDetail(true);
    let action: 'model' | 'stop' | 'jobs' | undefined;
    try {
      await openReading<void>(ctx, (tui, theme, _keys, done) => {
        content ??= new Transcript(tui, get().record.cwd, name => get().run?.renderers?.get(name));
        content.setEntries(transcript(get().record, get().run));
        const view = new DetailsView(tui, () => transcriptTitle(get().record), content, done, [
          { key: 'm', label: 'Message', available: canMessage, input: () => agentMessage(ctx, agents, id, runId, readonly, config, () => view.reader.follow()) },
          { key: 'o', label: 'Tools', run: () => { content!.toggleTools(); view.invalidate(); } },
          { key: 'h', label: 'Thinking', run: () => { content!.toggleThinking(); view.invalidate(); } },
          { key: 'j', label: 'Jobs', available: () => jobs !== undefined, run: () => { action = 'jobs'; done(); } },
          { key: 'c', label: 'Model / thinking', available: () => !readonly, run: () => { action = 'model'; done(); } },
          { label: 'Background', key: 'b', available: () => !readonly && agents.manager.canSendToBackground(id, runId), run: () => { agents.manager.sendToBackground(id, runId); } },
          { label: 'Stop subtree', key: 'x', confirm: true, available: canStop, run: () => { action = 'stop'; done(); } },
        ], reader, theme);
        if (!reader && active(get().record.state)) view.reader.follow();
        view.reader.setContent(content);
        reader = view.reader;
        let revision = transcript(get().record, get().run);
        const refresh = () => {
          const { record, run } = get(), entries = transcript(record, run);
          // Several tools can stream concurrently. Compare every immutable entry identity,
          // since an unchanged last tool result says nothing about an earlier live tail.
          if (entries.length !== revision.length || entries.some((entry, index) => entry !== revision[index])) {
            revision = entries;
            content!.setEntries(entries); view.reader.setContent(content!);
          }
          tui.requestRender();
        };
        const unsubscribe = agents.manager.subscribe(refresh);
        const dispose = view.dispose.bind(view);
        return Object.assign(view, { dispose: () => {dispose(); unsubscribe();} });
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
